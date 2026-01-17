"""
Sample Python application for testing debug-run

Run with:
  npx debug-run samples/python/sample_app.py -a python -b "samples/python/sample_app.py:120" --pretty -t 30s

Good breakpoint locations:
  - Line 120: Inside process_order method, after calculation setup
  - Line 85: In calculate_discount, after discount calculation
  - Line 160: In main, before processing first order
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import traceback


# ============ Configuration ============

@dataclass
class FeatureFlags:
    enable_discounts: bool = True
    enable_loyalty_points: bool = True
    max_order_items: int = 100
    discount_threshold: float = 100.0


@dataclass
class AppConfig:
    environment: str = "Development"
    region: str = "us-west-2"
    features: FeatureFlags = field(default_factory=FeatureFlags)


# ============ Domain Models ============

class LoyaltyTier(Enum):
    BRONZE = "Bronze"
    SILVER = "Silver"
    GOLD = "Gold"
    PLATINUM = "Platinum"


@dataclass
class Address:
    street: str
    city: str
    state: str
    zip_code: str
    country: str


@dataclass
class Customer:
    id: str
    name: str
    email: str
    loyalty_tier: LoyaltyTier
    loyalty_points: int
    address: Address


@dataclass
class OrderItem:
    sku: str
    name: str
    quantity: int
    unit_price: float


@dataclass
class Order:
    order_id: str
    customer_name: str
    items: list[OrderItem]


# ============ Services ============

class Logger:
    def log(self, level: str, message: str) -> None:
        print(f"[{level}] {message}")

    def debug(self, message: str) -> None:
        self.log("DEBUG", message)

    def info(self, message: str) -> None:
        self.log("INFO", message)

    def warn(self, message: str) -> None:
        self.log("WARN", message)

    def error(self, message: str) -> None:
        self.log("ERROR", message)


class InventoryService:
    def __init__(self, logger: Logger):
        self._logger = logger
        self._inventory: dict[str, int] = {
            "SKU-100": 10,
            "SKU-101": 5,
            "SKU-102": 2,
        }

    def get_stock(self, sku: str) -> int:
        return self._inventory.get(sku, 0)

    def reserve(self, sku: str, quantity: int) -> None:
        current = self.get_stock(sku)
        self._inventory[sku] = current - quantity
        self._logger.debug(f"Reserved {quantity} of {sku}, remaining: {current - quantity}")


class PricingService:
    def __init__(self, config: AppConfig, logger: Logger):
        self._config = config
        self._logger = logger

    def calculate_subtotal(self, order: Order) -> float:
        return sum(item.quantity * item.unit_price for item in order.items)

    def calculate_tax(self, subtotal: float) -> float:
        tax_rate = 0.08 if self._config.region == "us-west-2" else 0.10
        return subtotal * tax_rate

    def calculate_discount(self, order: Order, customer: Customer) -> float:
        """Calculate discount based on loyalty tier - GOOD BREAKPOINT TARGET"""
        if not self._config.features.enable_discounts:
            return 0.0

        subtotal = self.calculate_subtotal(order)
        if subtotal < self._config.features.discount_threshold:
            return 0.0

        tier_discounts = {
            LoyaltyTier.PLATINUM: 0.15,
            LoyaltyTier.GOLD: 0.10,
            LoyaltyTier.SILVER: 0.05,
            LoyaltyTier.BRONZE: 0.0,
        }

        # Good breakpoint here - line ~140
        discount_rate = tier_discounts.get(customer.loyalty_tier, 0.0)
        discount = subtotal * discount_rate
        return discount


class ValidationError(Exception):
    """Raised when order validation fails"""
    pass


class OrderService:
    def __init__(
        self,
        config: AppConfig,
        logger: Logger,
        inventory_service: InventoryService,
        pricing_service: PricingService,
    ):
        self._config = config
        self._logger = logger
        self._inventory = inventory_service
        self._pricing = pricing_service

    def process_order(self, order: Order, customer: Customer) -> str:
        """
        Process an order - GOOD BREAKPOINT TARGET
        Try: -b "samples/python/sample_app.py:170"
        """
        # Validate order
        self._validate_order(order)
        self._logger.debug(f"Order {order.order_id} validated")

        # Check inventory - GOOD BREAKPOINT: loop iteration
        for item in order.items:
            stock = self._inventory.get_stock(item.sku)
            if stock < item.quantity:
                self._logger.warn(f"Low stock for {item.sku}: {stock} < {item.quantity}")
            self._inventory.reserve(item.sku, item.quantity)

        # Calculate totals - GOOD BREAKPOINT: multiple variables
        subtotal = self._pricing.calculate_subtotal(order)
        tax = self._pricing.calculate_tax(subtotal)
        discount = self._pricing.calculate_discount(order, customer)

        # Line 185 - Good breakpoint for seeing all calculated values
        loyalty_points = int(subtotal * 10) if self._config.features.enable_loyalty_points else 0
        final_total = subtotal + tax - discount

        result = (
            f"Processed - Subtotal: ${subtotal:.2f}, Tax: ${tax:.2f}, "
            f"Discount: ${discount:.2f}, Points: {loyalty_points}, Final: ${final_total:.2f}"
        )
        self._logger.info(result)
        return result

    def _validate_order(self, order: Order) -> None:
        if not order.order_id:
            raise ValidationError("Order ID is required")
        if not order.customer_name:
            raise ValidationError("Customer name is required")
        if not order.items:
            raise ValidationError("Order must have at least one item")
        if len(order.items) > self._config.features.max_order_items:
            raise ValidationError(f"Order exceeds max items ({self._config.features.max_order_items})")


# ============ Exception Demo ============

class NetworkError(Exception):
    """Simulates a network failure"""
    def __init__(self, message: str, code: int, host: Optional[str] = None, port: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.host = host
        self.port = port


class DataAccessError(Exception):
    """Wraps database-related errors"""
    def __init__(self, message: str, cause: Optional[Exception] = None):
        super().__init__(message)
        self.__cause__ = cause


def simulate_database_failure():
    """Simulates a nested exception scenario"""
    try:
        raise NetworkError("Connection refused to db-server:5432", 10061, "db-server", 5432)
    except NetworkError as e:
        raise DataAccessError("Failed to execute query on Orders table") from e


# ============ Main Entry Point ============

def main():
    print("Sample Python App for debug-run testing\n")

    # Setup configuration
    config = AppConfig(
        environment="Development",
        region="us-west-2",
        features=FeatureFlags(
            enable_discounts=True,
            enable_loyalty_points=True,
            max_order_items=100,
            discount_threshold=100.0,
        ),
    )

    # Create services
    logger = Logger()
    inventory_service = InventoryService(logger)
    pricing_service = PricingService(config, logger)
    order_service = OrderService(config, logger, inventory_service, pricing_service)

    # Create sample data
    customer = Customer(
        id="CUST-001",
        name="Alice Johnson",
        email="alice@example.com",
        loyalty_tier=LoyaltyTier.GOLD,
        loyalty_points=5420,
        address=Address(
            street="123 Main St",
            city="Seattle",
            state="WA",
            zip_code="98101",
            country="US",
        ),
    )

    order1 = Order(
        order_id="ORD-001",
        customer_name="Alice",
        items=[
            OrderItem(sku="SKU-100", name="Widget", quantity=2, unit_price=19.99),
            OrderItem(sku="SKU-101", name="Gadget", quantity=1, unit_price=49.99),
        ],
    )

    order2 = Order(
        order_id="ORD-002",
        customer_name="Bob",
        items=[
            OrderItem(sku="SKU-100", name="Widget", quantity=5, unit_price=19.99),
            OrderItem(sku="SKU-102", name="Gizmo", quantity=3, unit_price=29.99),
        ],
    )

    # Process orders - GOOD BREAKPOINT TARGETS
    print("Processing orders...\n")

    # Breakpoint here to see full context: line ~285
    result1 = order_service.process_order(order1, customer)
    print(f"Order {order1.order_id}: {result1}\n")

    result2 = order_service.process_order(order2, customer)
    print(f"Order {order2.order_id}: {result2}\n")

    # Test validation error
    bad_order = Order(
        order_id="ORD-003",
        customer_name="",
        items=[],
    )

    try:
        order_service.process_order(bad_order, customer)
    except ValidationError as e:
        print(f"Validation failed: {e}\n")

    # Test nested exception
    print("Testing nested exceptions...")
    try:
        simulate_database_failure()
    except DataAccessError as e:
        print(f"Caught: {type(e).__name__} - {e}")
        if e.__cause__:
            print(f"  Caused by: {type(e.__cause__).__name__} - {e.__cause__}")

    print("\nDone!")


if __name__ == "__main__":
    main()
