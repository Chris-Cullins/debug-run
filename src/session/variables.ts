/**
 * Variable Inspection
 *
 * Handles fetching and expanding variables from the debug adapter.
 */

import type { IDapClient } from '../dap/client-interface.js';
import type { Variable as DapVariable } from '../dap/protocol.js';
import type { VariableValue, VariableChange } from '../output/events.js';

/**
 * Property names that provide no debugging value and waste tokens.
 * These are typically reflection metadata, compiler-generated properties, etc.
 */
const BLOCKED_PROPERTIES = new Set([
  // C# record EqualityContract and related reflection noise
  'EqualityContract',
  'CustomAttributes',
  'DeclaredConstructors',
  'DeclaredEvents',
  'DeclaredFields',
  'DeclaredMembers',
  'DeclaredMethods',
  'DeclaredNestedTypes',
  'DeclaredProperties',
  'DeclaringMethod',
  'DeclaringType',
  'GenericParameterAttributes',
  'GenericParameterPosition',
  'GenericTypeArguments',
  'ImplementedInterfaces',
  'MemberType',
  'MetadataToken',
  'ReflectedType',
  'TypeHandle',
  'UnderlyingSystemType',
  // Common noise
  '[More]',
  'Raw View',
  'Static members',
  'Non-Public members',
]);

/**
 * Type patterns that should not be expanded (regex patterns).
 * These types contain reflection/internal data that wastes tokens.
 */
const BLOCKED_TYPE_PATTERNS = [
  /^System\.Reflection\./,
  /^System\.RuntimeType$/,
  /^System\.Type\s*\{/,
  /\{System\.RuntimeType\}$/,
  /^System\.Reflection\.Assembly/,
  /^System\.Guid$/,
];

/**
 * Types that are typically "infrastructure" services that don't need full expansion.
 * In enterprise apps, these appear repeatedly and clutter output.
 * We'll show them in a compact format: just type + key identifying info.
 */
const SERVICE_TYPE_PATTERNS = [
  // Logging
  /Logger$/,
  /ILogger/,
  /LoggingConfiguration$/,
  // Caching
  /Cache$/,
  /CacheService$/,
  /ICacheService/,
  // Messaging
  /EventBus$/,
  /MessageQueue$/,
  /IEventBus/,
  // Metrics
  /MetricsCollector$/,
  /IMetrics/,
  // Generic service/repository patterns
  /Repository$/,
  /Service$/,
  /Provider$/,
  /Factory$/,
  /Manager$/,
  /Handler$/,
];

export interface VariableInspectorOptions {
  /** Maximum depth for recursive variable expansion (default: 2) */
  maxDepth?: number;
  /** Maximum number of items to fetch from collections (default: 20) */
  maxCollectionItems?: number;
  /** Timeout for variable fetching in ms (default: 5000) */
  timeout?: number;
  /**
   * Deduplicate repeated object instances by content hash (default: true)
   * When enabled, if the same object content is encountered multiple times,
   * subsequent occurrences show "[see: path.to.first.occurrence]" instead of full expansion.
   */
  deduplicateByContent?: boolean;
  /**
   * Compact mode for service-like types (default: true)
   * When enabled, types matching SERVICE_TYPE_PATTERNS are shown in a compact format
   * with only their type and key identifying information.
   */
  compactServices?: boolean;
  /**
   * Omit properties that are null/undefined (default: false)
   * When enabled, null properties are not included in output, reducing noise.
   */
  omitNullProperties?: boolean;
}

export class VariableInspector {
  private client: IDapClient;
  private options: Required<VariableInspectorOptions>;

  constructor(client: IDapClient, options: VariableInspectorOptions = {}) {
    this.client = client;
    this.options = {
      maxDepth: options.maxDepth ?? 2,
      maxCollectionItems: options.maxCollectionItems ?? 20,
      timeout: options.timeout ?? 5000,
      deduplicateByContent: options.deduplicateByContent ?? true,
      compactServices: options.compactServices ?? true,
      omitNullProperties: options.omitNullProperties ?? true,
    };
  }

  /**
   * Get all local variables for a stack frame
   */
  async getLocals(frameId: number): Promise<Record<string, VariableValue>> {
    const result: Record<string, VariableValue> = {};
    // Track visited variablesReferences to detect circular references
    const visited = new Set<number>();
    // Track content hashes to detect duplicate object content -> maps hash to "path.to.first.occurrence"
    const contentHashes = new Map<string, string>();

    try {
      const scopesResponse = await this.client.scopes({ frameId });

      for (const scope of scopesResponse.scopes) {
        // Only get Locals and Arguments scopes
        // Different adapters use different naming conventions:
        // - netcoredbg/vsdbg: "Locals", "Arguments"
        // - js-debug (node): "Local: functionName", "Block", "Closure"
        // - debugpy: "Locals", "Arguments"
        // - lldb: "Local Variables", "Arguments"
        const scopeLower = scope.name.toLowerCase();
        if (
          scopeLower === 'locals' ||
          scopeLower === 'local' ||
          scopeLower.startsWith('local:') ||
          scopeLower.startsWith('local ') ||
          scopeLower === 'arguments' ||
          scopeLower === 'block' ||
          scopeLower === 'closure'
        ) {
          const vars = await this.client.variables({
            variablesReference: scope.variablesReference,
            count: this.options.maxCollectionItems,
          });

          for (const v of vars.variables) {
            result[v.name] = await this.expandVariable(
              v,
              this.options.maxDepth,
              visited,
              contentHashes,
              v.name
            );
          }
        }
      }
    } catch (error) {
      // Return empty if we can't get variables
      console.error('Failed to get locals:', error);
    }

    return result;
  }

  /**
   * Expand a single variable to the specified depth
   * @param v The variable to expand
   * @param depth Maximum expansion depth
   * @param visited Set of already-visited variablesReferences to detect circular references
   * @param contentHashes Map of content hashes to paths (for deduplication)
   * @param currentPath Path to this variable (e.g., "order.Items[0]")
   */
  async expandVariable(
    v: DapVariable,
    depth: number = 2,
    visited: Set<number> = new Set(),
    contentHashes: Map<string, string> = new Map(),
    currentPath: string = ''
  ): Promise<VariableValue> {
    const variable: VariableValue = {
      type: v.type || 'unknown',
      value: this.parseValue(v.value, v.type),
      expandable: v.variablesReference > 0,
      variablesReference: v.variablesReference > 0 ? v.variablesReference : undefined,
    };

    // Don't expand blocked types (reflection metadata, etc.)
    if (this.isBlockedType(v.type)) {
      variable.expandable = false;
      variable.variablesReference = undefined;
      return variable;
    }

    // Check if this is a service-like type that should be shown in compact form
    if (this.options.compactServices && this.isServiceType(v.type) && v.variablesReference > 0) {
      // For service types, just show type name and mark as compact
      variable.value = `{${v.type}}`;
      variable.expandable = false;
      variable.variablesReference = undefined;
      return variable;
    }

    // Auto-expand objects to the specified depth
    if (v.variablesReference > 0 && depth > 0) {
      // Check for circular reference
      if (visited.has(v.variablesReference)) {
        variable.value = '[Circular Reference]';
        variable.circular = true;
        return variable;
      }

      // Mark this reference as visited
      visited.add(v.variablesReference);

      try {
        const children = await this.client.variables({
          variablesReference: v.variablesReference,
          count: this.options.maxCollectionItems,
        });

        // Filter out blocked properties
        let filteredChildren = children.variables.filter(
          (child) => !this.isBlockedProperty(child.name)
        );

        // Optionally filter out null properties
        if (this.options.omitNullProperties) {
          filteredChildren = filteredChildren.filter((child) => !this.isNullValue(child.value));
        }

        // Check if this is a collection/array
        if (this.isCollection(v.type, filteredChildren)) {
          variable.value = {
            type: v.type || 'collection',
            count: this.getCollectionCount(v, filteredChildren.length),
            items: await this.expandCollection(
              filteredChildren,
              depth - 1,
              visited,
              contentHashes,
              currentPath
            ),
          };
        } else {
          // Regular object - check for content-based deduplication
          const obj: Record<string, VariableValue> = {};
          for (const child of filteredChildren) {
            const childPath = currentPath ? `${currentPath}.${child.name}` : child.name;
            obj[child.name] = await this.expandVariable(
              child,
              depth - 1,
              visited,
              contentHashes,
              childPath
            );
          }

          // Content-based deduplication for objects
          if (this.options.deduplicateByContent && Object.keys(obj).length > 0) {
            const contentHash = this.computeContentHash(v.type, obj);
            const existingPath = contentHashes.get(contentHash);

            if (existingPath) {
              // This content was seen before - reference the original
              variable.value = `[see: ${existingPath}]`;
              variable.expandable = false;
              variable.variablesReference = undefined;
              variable.deduplicated = true;
              return variable;
            }

            // First occurrence - record it
            contentHashes.set(contentHash, currentPath);
          }

          variable.value = obj;
        }
      } catch {
        // Keep the string value if expansion fails
      }
    }

    return variable;
  }

  /**
   * Evaluate expressions in the context of a stack frame
   */
  async evaluateExpressions(
    frameId: number,
    expressions: string[]
  ): Promise<Record<string, { result: string; type?: string; error?: string }>> {
    const results: Record<string, { result: string; type?: string; error?: string }> = {};

    for (const expression of expressions) {
      try {
        const response = await this.client.evaluate({
          expression,
          frameId,
          context: 'watch',
        });

        results[expression] = {
          result: response.result,
          type: response.type,
        };
      } catch (error) {
        results[expression] = {
          result: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return results;
  }

  /**
   * Check if a property name should be skipped (reflection noise, etc.)
   */
  private isBlockedProperty(name: string): boolean {
    return BLOCKED_PROPERTIES.has(name);
  }

  /**
   * Check if a type should not be expanded (reflection types, etc.)
   */
  private isBlockedType(type: string | undefined): boolean {
    if (!type) return false;
    return BLOCKED_TYPE_PATTERNS.some((pattern) => pattern.test(type));
  }

  /**
   * Check if a type is a service-like type that should be shown in compact form
   */
  private isServiceType(type: string | undefined): boolean {
    if (!type) return false;
    return SERVICE_TYPE_PATTERNS.some((pattern) => pattern.test(type));
  }

  /**
   * Check if a value represents null/undefined
   */
  private isNullValue(value: string): boolean {
    const lower = value.toLowerCase();
    return lower === 'null' || lower === 'none' || lower === 'undefined' || lower === 'nil';
  }

  /**
   * Compute a content hash for an expanded object to detect duplicates.
   * This creates a simple hash based on type + property names + values.
   */
  private computeContentHash(type: string | undefined, obj: Record<string, VariableValue>): string {
    // Simple hash: type + sorted property names + their types and primitive values
    const parts: string[] = [type || ''];
    const sortedKeys = Object.keys(obj).sort();

    for (const key of sortedKeys) {
      const val = obj[key];
      parts.push(`${key}:${val.type}`);
      // Include primitive values in hash, but not nested objects (to avoid deep comparison)
      if (typeof val.value !== 'object' || val.value === null) {
        parts.push(String(val.value));
      }
    }

    return parts.join('|');
  }

  /**
   * Parse a value string into an appropriate JS type
   */
  private parseValue(value: string, type?: string): unknown {
    if (value === 'null' || value === 'None') return null;
    if (value === 'undefined') return undefined;
    if (value === 'true' || value === 'True') return true;
    if (value === 'false' || value === 'False') return false;

    // Try to parse numbers
    if (type?.includes('int') || type?.includes('Int') || type === 'number') {
      const num = parseInt(value, 10);
      if (!isNaN(num)) return num;
    }

    if (type?.includes('float') || type?.includes('double') || type?.includes('decimal')) {
      const num = parseFloat(value);
      if (!isNaN(num)) return num;
    }

    // Remove quotes from strings
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1);
    }

    return value;
  }

  /**
   * Check if a variable represents a collection
   */
  private isCollection(type: string | undefined, _children: DapVariable[]): boolean {
    if (!type) return false;

    const collectionTypes = [
      'List',
      'Array',
      'Set',
      'Dictionary',
      'Map',
      'Collection',
      '[]',
      'list',
      'dict',
      'set',
      'tuple',
    ];

    return collectionTypes.some((t) => type.includes(t));
  }

  /**
   * Get the count of items in a collection
   */
  private getCollectionCount(v: DapVariable, fetchedCount: number): number {
    // Try to get count from named/indexed variables
    if (v.indexedVariables !== undefined) return v.indexedVariables;
    if (v.namedVariables !== undefined) return v.namedVariables;

    // Parse count from value string (e.g., "Count = 5")
    const countMatch = v.value.match(/Count\s*[=:]\s*(\d+)/i);
    if (countMatch) return parseInt(countMatch[1], 10);

    // Parse from type (e.g., "List<int>[5]")
    const bracketMatch = v.value.match(/\[(\d+)\]/);
    if (bracketMatch) return parseInt(bracketMatch[1], 10);

    return fetchedCount;
  }

  /**
   * Expand collection items
   */
  private async expandCollection(
    items: DapVariable[],
    depth: number,
    visited: Set<number>,
    contentHashes: Map<string, string>,
    currentPath: string
  ): Promise<VariableValue[]> {
    const result: VariableValue[] = [];

    let index = 0;
    for (const item of items.slice(0, this.options.maxCollectionItems)) {
      const itemPath = `${currentPath}[${index}]`;
      result.push(await this.expandVariable(item, depth, visited, contentHashes, itemPath));
      index++;
    }

    return result;
  }

  /**
   * Compare two variable snapshots and return changes.
   *
   * For token efficiency, modified variables only include the new value.
   * LLMs typically only need current state, not the previous value.
   * Deleted variables include oldValue so the LLM knows what was removed.
   */
  diffVariables(
    prev: Record<string, VariableValue>,
    curr: Record<string, VariableValue>
  ): VariableChange[] {
    const changes: VariableChange[] = [];

    // Check for deleted or modified variables
    for (const [name, oldVal] of Object.entries(prev)) {
      if (!(name in curr)) {
        // For deletions, include oldValue so LLM knows what was removed
        changes.push({ name, changeType: 'deleted', oldValue: oldVal });
      } else if (!this.valuesEqual(oldVal, curr[name])) {
        // For modifications, only include newValue (token efficiency)
        changes.push({
          name,
          changeType: 'modified',
          newValue: curr[name],
        });
      }
    }

    // Check for created variables
    for (const [name, newVal] of Object.entries(curr)) {
      if (!(name in prev)) {
        changes.push({ name, changeType: 'created', newValue: newVal });
      }
    }

    return changes;
  }

  /**
   * Deep equality check for VariableValue
   */
  valuesEqual(a: VariableValue, b: VariableValue): boolean {
    // Quick check: same type?
    if (a.type !== b.type) return false;

    // For primitives, compare value directly
    if (typeof a.value !== 'object' || a.value === null) {
      return a.value === b.value;
    }

    // For objects/arrays, use JSON serialization
    // (acceptable for debugging output - not perf critical)
    return JSON.stringify(a.value) === JSON.stringify(b.value);
  }
}
