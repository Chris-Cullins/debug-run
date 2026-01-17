//! Sample Rust application for testing debug-run
//!
//! Build with:
//!   cd samples/rust && cargo build
//!
//! Run with:
//!   npx debug-run ./samples/rust/target/debug/sample_app \
//!     -a rust \
//!     -b "samples/rust/src/main.rs:150" \
//!     --pretty \
//!     -t 30s
//!
//! Good breakpoint locations:
//!   - Line 150: Inside process_order, after calculations
//!   - Line 100: In calculate_discount, after discount calculation
//!   - Line 200: In main, before processing first order

use std::collections::HashMap;

// ============ Configuration ============

#[derive(Debug, Clone)]
struct FeatureFlags {
    enable_discounts: bool,
    enable_loyalty_points: bool,
    max_order_items: usize,
    discount_threshold: f64,
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            enable_discounts: true,
            enable_loyalty_points: true,
            max_order_items: 100,
            discount_threshold: 100.0,
        }
    }
}

#[derive(Debug, Clone)]
struct AppConfig {
    environment: String,
    region: String,
    features: FeatureFlags,
}

// ============ Domain Models ============

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoyaltyTier {
    Bronze,
    Silver,
    Gold,
    Platinum,
}

#[derive(Debug, Clone)]
struct Address {
    street: String,
    city: String,
    state: String,
    zip_code: String,
    country: String,
}

#[derive(Debug, Clone)]
struct Customer {
    id: String,
    name: String,
    email: String,
    loyalty_tier: LoyaltyTier,
    loyalty_points: u32,
    address: Address,
}

#[derive(Debug, Clone)]
struct OrderItem {
    sku: String,
    name: String,
    quantity: u32,
    unit_price: f64,
}

#[derive(Debug, Clone)]
struct Order {
    order_id: String,
    customer_name: String,
    items: Vec<OrderItem>,
}

// ============ Services ============

struct Logger;

impl Logger {
    fn log(&self, level: &str, message: &str) {
        println!("[{}] {}", level, message);
    }

    fn debug(&self, message: &str) {
        self.log("DEBUG", message);
    }

    fn info(&self, message: &str) {
        self.log("INFO", message);
    }

    fn warn(&self, message: &str) {
        self.log("WARN", message);
    }
}

struct InventoryService {
    inventory: HashMap<String, u32>,
}

impl InventoryService {
    fn new() -> Self {
        let mut inventory = HashMap::new();
        inventory.insert("SKU-100".to_string(), 10);
        inventory.insert("SKU-101".to_string(), 5);
        inventory.insert("SKU-102".to_string(), 2);
        Self { inventory }
    }

    fn get_stock(&self, sku: &str) -> u32 {
        *self.inventory.get(sku).unwrap_or(&0)
    }

    fn reserve(&mut self, sku: &str, quantity: u32, logger: &Logger) {
        let current = self.get_stock(sku);
        self.inventory.insert(sku.to_string(), current.saturating_sub(quantity));
        logger.debug(&format!(
            "Reserved {} of {}, remaining: {}",
            quantity,
            sku,
            current.saturating_sub(quantity)
        ));
    }
}

struct PricingService {
    config: AppConfig,
}

impl PricingService {
    fn new(config: AppConfig) -> Self {
        Self { config }
    }

    fn calculate_subtotal(&self, order: &Order) -> f64 {
        order
            .items
            .iter()
            .map(|item| item.quantity as f64 * item.unit_price)
            .sum()
    }

    fn calculate_tax(&self, subtotal: f64) -> f64 {
        let tax_rate = if self.config.region == "us-west-2" {
            0.08
        } else {
            0.10
        };
        subtotal * tax_rate
    }

    /// Calculate discount based on loyalty tier - GOOD BREAKPOINT TARGET
    fn calculate_discount(&self, order: &Order, customer: &Customer) -> f64 {
        if !self.config.features.enable_discounts {
            return 0.0;
        }

        let subtotal = self.calculate_subtotal(order);
        if subtotal < self.config.features.discount_threshold {
            return 0.0;
        }

        // Good breakpoint here - line ~175
        let discount_rate = match customer.loyalty_tier {
            LoyaltyTier::Platinum => 0.15,
            LoyaltyTier::Gold => 0.10,
            LoyaltyTier::Silver => 0.05,
            LoyaltyTier::Bronze => 0.0,
        };

        let discount = subtotal * discount_rate;
        discount
    }
}

#[derive(Debug)]
struct ValidationError(String);

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ValidationError: {}", self.0)
    }
}

impl std::error::Error for ValidationError {}

struct OrderService {
    config: AppConfig,
    logger: Logger,
    inventory: InventoryService,
    pricing: PricingService,
}

impl OrderService {
    fn new(config: AppConfig) -> Self {
        Self {
            pricing: PricingService::new(config.clone()),
            config,
            logger: Logger,
            inventory: InventoryService::new(),
        }
    }

    /// Process an order - GOOD BREAKPOINT TARGET
    /// Try: -b "samples/rust/src/main.rs:220"
    fn process_order(
        &mut self,
        order: &Order,
        customer: &Customer,
    ) -> Result<String, ValidationError> {
        // Validate order
        self.validate_order(order)?;
        self.logger.debug(&format!("Order {} validated", order.order_id));

        // Check inventory - GOOD BREAKPOINT: loop iteration
        for item in &order.items {
            let stock = self.inventory.get_stock(&item.sku);
            if stock < item.quantity {
                self.logger.warn(&format!(
                    "Low stock for {}: {} < {}",
                    item.sku, stock, item.quantity
                ));
            }
            self.inventory.reserve(&item.sku, item.quantity, &self.logger);
        }

        // Calculate totals - GOOD BREAKPOINT: multiple variables
        let subtotal = self.pricing.calculate_subtotal(order);
        let tax = self.pricing.calculate_tax(subtotal);
        let discount = self.pricing.calculate_discount(order, customer);

        // Line ~245 - Good breakpoint for seeing all calculated values
        let loyalty_points = if self.config.features.enable_loyalty_points {
            (subtotal * 10.0) as u32
        } else {
            0
        };
        let final_total = subtotal + tax - discount;

        let result = format!(
            "Processed - Subtotal: ${:.2}, Tax: ${:.2}, Discount: ${:.2}, Points: {}, Final: ${:.2}",
            subtotal, tax, discount, loyalty_points, final_total
        );
        self.logger.info(&result);
        Ok(result)
    }

    fn validate_order(&self, order: &Order) -> Result<(), ValidationError> {
        if order.order_id.is_empty() {
            return Err(ValidationError("Order ID is required".to_string()));
        }
        if order.customer_name.is_empty() {
            return Err(ValidationError("Customer name is required".to_string()));
        }
        if order.items.is_empty() {
            return Err(ValidationError(
                "Order must have at least one item".to_string(),
            ));
        }
        if order.items.len() > self.config.features.max_order_items {
            return Err(ValidationError(format!(
                "Order exceeds max items ({})",
                self.config.features.max_order_items
            )));
        }
        Ok(())
    }
}

// ============ Exception Demo ============

#[derive(Debug)]
struct NetworkError {
    message: String,
    code: i32,
    host: Option<String>,
    port: Option<u16>,
}

impl std::fmt::Display for NetworkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "NetworkError: {} (code: {})", self.message, self.code)
    }
}

impl std::error::Error for NetworkError {}

#[derive(Debug)]
struct DataAccessError {
    message: String,
    source: Option<Box<dyn std::error::Error>>,
}

impl std::fmt::Display for DataAccessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DataAccessError: {}", self.message)
    }
}

impl std::error::Error for DataAccessError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source.as_ref().map(|e| e.as_ref())
    }
}

fn simulate_database_failure() -> Result<(), DataAccessError> {
    let network_err = NetworkError {
        message: "Connection refused to db-server:5432".to_string(),
        code: 10061,
        host: Some("db-server".to_string()),
        port: Some(5432),
    };

    Err(DataAccessError {
        message: "Failed to execute query on Orders table".to_string(),
        source: Some(Box::new(network_err)),
    })
}

// ============ Main Entry Point ============

fn main() {
    println!("Sample Rust App for debug-run testing\n");

    // Setup configuration
    let config = AppConfig {
        environment: "Development".to_string(),
        region: "us-west-2".to_string(),
        features: FeatureFlags {
            enable_discounts: true,
            enable_loyalty_points: true,
            max_order_items: 100,
            discount_threshold: 100.0,
        },
    };

    // Create order service
    let mut order_service = OrderService::new(config);

    // Create sample data
    let customer = Customer {
        id: "CUST-001".to_string(),
        name: "Alice Johnson".to_string(),
        email: "alice@example.com".to_string(),
        loyalty_tier: LoyaltyTier::Gold,
        loyalty_points: 5420,
        address: Address {
            street: "123 Main St".to_string(),
            city: "Seattle".to_string(),
            state: "WA".to_string(),
            zip_code: "98101".to_string(),
            country: "US".to_string(),
        },
    };

    let order1 = Order {
        order_id: "ORD-001".to_string(),
        customer_name: "Alice".to_string(),
        items: vec![
            OrderItem {
                sku: "SKU-100".to_string(),
                name: "Widget".to_string(),
                quantity: 2,
                unit_price: 19.99,
            },
            OrderItem {
                sku: "SKU-101".to_string(),
                name: "Gadget".to_string(),
                quantity: 1,
                unit_price: 49.99,
            },
        ],
    };

    let order2 = Order {
        order_id: "ORD-002".to_string(),
        customer_name: "Bob".to_string(),
        items: vec![
            OrderItem {
                sku: "SKU-100".to_string(),
                name: "Widget".to_string(),
                quantity: 5,
                unit_price: 19.99,
            },
            OrderItem {
                sku: "SKU-102".to_string(),
                name: "Gizmo".to_string(),
                quantity: 3,
                unit_price: 29.99,
            },
        ],
    };

    // Process orders - GOOD BREAKPOINT TARGETS
    println!("Processing orders...\n");

    // Breakpoint here to see full context: line ~390
    match order_service.process_order(&order1, &customer) {
        Ok(result) => println!("Order {}: {}\n", order1.order_id, result),
        Err(e) => println!("Order {} failed: {}\n", order1.order_id, e),
    }

    match order_service.process_order(&order2, &customer) {
        Ok(result) => println!("Order {}: {}\n", order2.order_id, result),
        Err(e) => println!("Order {} failed: {}\n", order2.order_id, e),
    }

    // Test validation error
    let bad_order = Order {
        order_id: "ORD-003".to_string(),
        customer_name: String::new(),
        items: vec![],
    };

    match order_service.process_order(&bad_order, &customer) {
        Ok(result) => println!("Order {}: {}\n", bad_order.order_id, result),
        Err(e) => println!("Validation failed: {}\n", e),
    }

    // Test nested exception
    println!("Testing nested exceptions...");
    match simulate_database_failure() {
        Ok(_) => println!("Unexpected success"),
        Err(e) => {
            println!("Caught: {} - {}", std::any::type_name_of_val(&e), e);
            if let Some(source) = e.source.as_ref() {
                println!("  Caused by: {}", source);
            }
        }
    }

    println!("\nDone!");
}
