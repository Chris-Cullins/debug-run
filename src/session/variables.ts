/**
 * Variable Inspection
 *
 * Handles fetching and expanding variables from the debug adapter.
 */

import type { DapClient } from "../dap/client.js";
import type { Variable as DapVariable } from "../dap/protocol.js";
import type { VariableValue } from "../output/events.js";

export interface VariableInspectorOptions {
  /** Maximum depth for recursive variable expansion (default: 2) */
  maxDepth?: number;
  /** Maximum number of items to fetch from collections (default: 20) */
  maxCollectionItems?: number;
  /** Timeout for variable fetching in ms (default: 5000) */
  timeout?: number;
}

export class VariableInspector {
  private client: DapClient;
  private options: Required<VariableInspectorOptions>;

  constructor(client: DapClient, options: VariableInspectorOptions = {}) {
    this.client = client;
    this.options = {
      maxDepth: options.maxDepth ?? 2,
      maxCollectionItems: options.maxCollectionItems ?? 20,
      timeout: options.timeout ?? 5000,
    };
  }

  /**
   * Get all local variables for a stack frame
   */
  async getLocals(frameId: number): Promise<Record<string, VariableValue>> {
    const result: Record<string, VariableValue> = {};

    try {
      const scopesResponse = await this.client.scopes({ frameId });

      for (const scope of scopesResponse.scopes) {
        // Only get Locals and Arguments scopes
        if (scope.name === "Locals" || scope.name === "Arguments" || scope.name === "Local") {
          const vars = await this.client.variables({
            variablesReference: scope.variablesReference,
            count: this.options.maxCollectionItems,
          });

          for (const v of vars.variables) {
            result[v.name] = await this.expandVariable(v, this.options.maxDepth);
          }
        }
      }
    } catch (error) {
      // Return empty if we can't get variables
      console.error("Failed to get locals:", error);
    }

    return result;
  }

  /**
   * Expand a single variable to the specified depth
   */
  async expandVariable(v: DapVariable, depth: number = 2): Promise<VariableValue> {
    const variable: VariableValue = {
      type: v.type || "unknown",
      value: this.parseValue(v.value, v.type),
      expandable: v.variablesReference > 0,
      variablesReference: v.variablesReference > 0 ? v.variablesReference : undefined,
    };

    // Auto-expand objects to the specified depth
    if (v.variablesReference > 0 && depth > 0) {
      try {
        const children = await this.client.variables({
          variablesReference: v.variablesReference,
          count: this.options.maxCollectionItems,
        });

        // Check if this is a collection/array
        if (this.isCollection(v.type, children.variables)) {
          variable.value = {
            type: v.type || "collection",
            count: this.getCollectionCount(v, children.variables.length),
            items: await this.expandCollection(children.variables, depth - 1),
          };
        } else {
          // Regular object
          const obj: Record<string, VariableValue> = {};
          for (const child of children.variables) {
            obj[child.name] = await this.expandVariable(child, depth - 1);
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
          context: "watch",
        });

        results[expression] = {
          result: response.result,
          type: response.type,
        };
      } catch (error) {
        results[expression] = {
          result: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return results;
  }

  /**
   * Parse a value string into an appropriate JS type
   */
  private parseValue(value: string, type?: string): unknown {
    if (value === "null" || value === "None") return null;
    if (value === "undefined") return undefined;
    if (value === "true" || value === "True") return true;
    if (value === "false" || value === "False") return false;

    // Try to parse numbers
    if (type?.includes("int") || type?.includes("Int") || type === "number") {
      const num = parseInt(value, 10);
      if (!isNaN(num)) return num;
    }

    if (type?.includes("float") || type?.includes("double") || type?.includes("decimal")) {
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
      "List",
      "Array",
      "Set",
      "Dictionary",
      "Map",
      "Collection",
      "[]",
      "list",
      "dict",
      "set",
      "tuple",
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
    depth: number
  ): Promise<VariableValue[]> {
    const result: VariableValue[] = [];

    for (const item of items.slice(0, this.options.maxCollectionItems)) {
      result.push(await this.expandVariable(item, depth));
    }

    return result;
  }
}
