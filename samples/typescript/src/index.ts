/**
 * Sample TypeScript application for testing debug-run
 *
 * Run with:
 *   cd samples/typescript && npm install && npm run build && cd ../..
 *   npx debug-run samples/typescript/dist/index.js -a node -b "samples/typescript/src/index.ts:120" --pretty
 */

// ============ Configuration ============

interface AppConfig {
  environment: string;
  region: string;
  features: FeatureFlags;
}

interface FeatureFlags {
  enableDiscounts: boolean;
  enableLoyaltyPoints: boolean;
  maxOrderItems: number;
  discountThreshold: number;
}

// ============ Domain Models ============

interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface Order {
  orderId: string;
  customerName: string;
  items: OrderItem[];
}

enum LoyaltyTier {
  Bronze = "Bronze",
  Silver = "Silver",
  Gold = "Gold",
  Platinum = "Platinum",
}

interface Customer {
  id: string;
  name: string;
  email: string;
  loyaltyTier: LoyaltyTier;
  loyaltyPoints: number;
  address: Address;
}

interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

interface OrderContext {
  order: Order;
  customer: Customer;
  metadata: Record<string, unknown>;
}

// ============ Services ============

class Logger {
  log(level: string, message: string): void {
    console.log(`[${level}] ${message}`);
  }
  debug(message: string): void {
    this.log("DEBUG", message);
  }
  info(message: string): void {
    this.log("INFO", message);
  }
  warn(message: string): void {
    this.log("WARN", message);
  }
  error(message: string): void {
    this.log("ERROR", message);
  }
}

class InventoryService {
  private inventory: Map<string, number> = new Map([
    ["SKU-100", 10],
    ["SKU-101", 5],
    ["SKU-102", 2],
  ]);

  constructor(private logger: Logger) {}

  getStock(sku: string): number {
    return this.inventory.get(sku) ?? 0;
  }

  reserve(sku: string, quantity: number): void {
    const current = this.getStock(sku);
    this.inventory.set(sku, current - quantity);
    this.logger.debug(`Reserved ${quantity} of ${sku}, remaining: ${current - quantity}`);
  }
}

class PricingService {
  constructor(
    private config: AppConfig,
    private logger: Logger
  ) {}

  calculateSubtotal(order: Order): number {
    return order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

  calculateTax(subtotal: number): number {
    const taxRate = this.config.region === "us-west-2" ? 0.08 : 0.1;
    return subtotal * taxRate;
  }

  calculateDiscount(order: Order, customer: Customer): number {
    if (!this.config.features.enableDiscounts) return 0;

    const subtotal = this.calculateSubtotal(order);
    if (subtotal < this.config.features.discountThreshold) return 0;

    const tierDiscount: Record<LoyaltyTier, number> = {
      [LoyaltyTier.Platinum]: 0.15,
      [LoyaltyTier.Gold]: 0.1,
      [LoyaltyTier.Silver]: 0.05,
      [LoyaltyTier.Bronze]: 0,
    };

    return subtotal * tierDiscount[customer.loyaltyTier];
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

class OrderService {
  constructor(
    private config: AppConfig,
    private logger: Logger,
    private inventoryService: InventoryService,
    private pricingService: PricingService
  ) {}

  /**
   * Process an order - GOOD BREAKPOINT TARGET
   * Try: -b "samples/typescript/src/index.ts:155"
   */
  processOrder(context: OrderContext): string {
    const { order, customer } = context;

    // Validate order
    this.validateOrder(order);
    this.logger.debug(`Order ${order.orderId} validated`);

    // Check inventory - GOOD BREAKPOINT: loop iteration
    for (const item of order.items) {
      const stock = this.inventoryService.getStock(item.sku);
      if (stock < item.quantity) {
        this.logger.warn(`Low stock for ${item.sku}: ${stock} < ${item.quantity}`);
      }
      this.inventoryService.reserve(item.sku, item.quantity);
    }

    // Calculate totals - GOOD BREAKPOINT: multiple variables
    const subtotal = this.pricingService.calculateSubtotal(order);
    const tax = this.pricingService.calculateTax(subtotal);
    const discount = this.pricingService.calculateDiscount(order, customer);
    const loyaltyPoints = this.config.features.enableLoyaltyPoints ? Math.floor(subtotal * 10) : 0;
    const finalTotal = subtotal + tax - discount;

    const result = `Processed - Subtotal: $${subtotal.toFixed(2)}, Tax: $${tax.toFixed(2)}, Discount: $${discount.toFixed(2)}, Points: ${loyaltyPoints}, Final: $${finalTotal.toFixed(2)}`;

    this.logger.info(result);
    return result;
  }

  private validateOrder(order: Order): void {
    if (!order.orderId) {
      throw new ValidationError("Order ID is required");
    }
    if (!order.customerName) {
      throw new ValidationError("Customer name is required");
    }
    if (order.items.length === 0) {
      throw new ValidationError("Order must have at least one item");
    }
    if (order.items.length > this.config.features.maxOrderItems) {
      throw new ValidationError(`Order exceeds max items (${this.config.features.maxOrderItems})`);
    }
  }
}

// ============ Exception Demo ============

class DataAccessError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "DataAccessError";
  }
}

class NetworkError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly host?: string,
    public readonly port?: number
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

function simulateDatabaseFailure(): never {
  try {
    throw new NetworkError("Connection refused to db-server:5432", 10061, "db-server", 5432);
  } catch (err) {
    throw new DataAccessError("Failed to execute query on Orders table", err as Error);
  }
}

// ============ Main Entry Point ============

function main(): void {
  console.log("Sample TypeScript App for debug-run testing\n");

  // Setup configuration
  const config: AppConfig = {
    environment: "Development",
    region: "us-west-2",
    features: {
      enableDiscounts: true,
      enableLoyaltyPoints: true,
      maxOrderItems: 100,
      discountThreshold: 100,
    },
  };

  // Create services
  const logger = new Logger();
  const inventoryService = new InventoryService(logger);
  const pricingService = new PricingService(config, logger);
  const orderService = new OrderService(config, logger, inventoryService, pricingService);

  // Create sample data
  const customer: Customer = {
    id: "CUST-001",
    name: "Alice Johnson",
    email: "alice@example.com",
    loyaltyTier: LoyaltyTier.Gold,
    loyaltyPoints: 5420,
    address: {
      street: "123 Main St",
      city: "Seattle",
      state: "WA",
      zipCode: "98101",
      country: "US",
    },
  };

  const order1: Order = {
    orderId: "ORD-001",
    customerName: "Alice",
    items: [
      { sku: "SKU-100", name: "Widget", quantity: 2, unitPrice: 19.99 },
      { sku: "SKU-101", name: "Gadget", quantity: 1, unitPrice: 49.99 },
    ],
  };

  const order2: Order = {
    orderId: "ORD-002",
    customerName: "Bob",
    items: [
      { sku: "SKU-100", name: "Widget", quantity: 5, unitPrice: 19.99 },
      { sku: "SKU-102", name: "Gizmo", quantity: 3, unitPrice: 29.99 },
    ],
  };

  // Process orders - GOOD BREAKPOINT TARGETS
  console.log("Processing orders...\n");

  const context: OrderContext = {
    order: order1,
    customer,
    metadata: { source: "web", campaign: "summer-sale" },
  };

  // Breakpoint here to see full context: line ~280
  const result1 = orderService.processOrder(context);
  console.log(`Order ${order1.orderId}: ${result1}\n`);

  context.order = order2;
  const result2 = orderService.processOrder(context);
  console.log(`Order ${order2.orderId}: ${result2}\n`);

  // Test validation error
  const badOrder: Order = {
    orderId: "ORD-003",
    customerName: "",
    items: [],
  };

  try {
    context.order = badOrder;
    orderService.processOrder(context);
  } catch (err) {
    if (err instanceof ValidationError) {
      console.log(`Validation failed: ${err.message}\n`);
    }
  }

  // Test nested exception
  console.log("Testing nested exceptions...");
  try {
    simulateDatabaseFailure();
  } catch (err) {
    if (err instanceof DataAccessError) {
      console.log(`Caught: ${err.name} - ${err.message}`);
      if (err.cause) {
        console.log(`  Caused by: ${err.cause.name} - ${err.cause.message}`);
      }
    }
  }

  console.log("\nDone!");
}

main();
