namespace EnterpriseApi.Domain;

// ================== Orders ==================

public enum OrderStatus
{
    Pending,
    Validated,
    PaymentProcessing,
    PaymentConfirmed,
    Fulfilling,
    Shipped,
    Delivered,
    Cancelled
}

public class Order
{
    public string Id { get; set; } = "";
    public string CustomerId { get; set; } = "";
    public List<OrderItem> Items { get; set; } = new();
    public OrderStatus Status { get; set; } = OrderStatus.Pending;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public ShippingAddress? ShippingAddress { get; set; }
    public BillingInfo? BillingInfo { get; set; }
    public OrderTotals? Totals { get; set; }
    public PaymentInfo? Payment { get; set; }
    public List<OrderEvent> Events { get; set; } = new();
    public Dictionary<string, string> Metadata { get; set; } = new();
}

public class OrderItem
{
    public string Sku { get; set; } = "";
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal? DiscountAmount { get; set; }
    public decimal LineTotal => (UnitPrice * Quantity) - (DiscountAmount ?? 0);
}

public class OrderTotals
{
    public decimal Subtotal { get; set; }
    public decimal DiscountTotal { get; set; }
    public decimal TaxAmount { get; set; }
    public decimal ShippingCost { get; set; }
    public decimal GrandTotal { get; set; }
}

public class ShippingAddress
{
    public string Street { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public string PostalCode { get; set; } = "";
    public string Country { get; set; } = "";
}

public class BillingInfo
{
    public string PaymentMethodId { get; set; } = "";
    public string CardLast4 { get; set; } = "";
    public string CardBrand { get; set; } = "";
}

public class PaymentInfo
{
    public string TransactionId { get; set; } = "";
    public string Status { get; set; } = "";
    public decimal Amount { get; set; }
    public DateTime ProcessedAt { get; set; }
}

public class OrderEvent
{
    public string EventType { get; set; } = "";
    public DateTime Timestamp { get; set; }
    public string Description { get; set; } = "";
    public string? UserId { get; set; }
}

// ================== Products ==================

public class Product
{
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal Price { get; set; }
    public string Category { get; set; } = "";
    public int StockQuantity { get; set; }
    public bool IsActive { get; set; } = true;
    public ProductDimensions? Dimensions { get; set; }
    public List<string> Tags { get; set; } = new();
}

public class ProductDimensions
{
    public decimal WeightKg { get; set; }
    public decimal LengthCm { get; set; }
    public decimal WidthCm { get; set; }
    public decimal HeightCm { get; set; }
}

// ================== Customers ==================

public enum CustomerTier { Bronze, Silver, Gold, Platinum }

public class Customer
{
    public string Id { get; set; } = "";
    public string Email { get; set; } = "";
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public CustomerTier Tier { get; set; } = CustomerTier.Bronze;
    public int LoyaltyPoints { get; set; }
    public DateTime CreatedAt { get; set; }
    public ShippingAddress? DefaultShippingAddress { get; set; }
    public List<PaymentMethod> PaymentMethods { get; set; } = new();
    public CustomerPreferences? Preferences { get; set; }
}

public class PaymentMethod
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "";  // "card", "paypal", etc.
    public string Last4 { get; set; } = "";
    public string? Brand { get; set; }
    public bool IsDefault { get; set; }
}

public class CustomerPreferences
{
    public string PreferredCurrency { get; set; } = "USD";
    public string PreferredLanguage { get; set; } = "en";
    public bool EmailNotifications { get; set; } = true;
    public bool SmsNotifications { get; set; } = false;
}

// ================== Inventory ==================

public class InventoryItem
{
    public string Sku { get; set; } = "";
    public int Available { get; set; }
    public int Reserved { get; set; }
    public int OnHand => Available + Reserved;
    public string WarehouseLocation { get; set; } = "";
}

// ================== Results ==================

public class OrderResult
{
    public string OrderId { get; set; } = "";
    public OrderStatus Status { get; set; }
    public OrderTotals? Totals { get; set; }
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
}

public class ProcessOrderResult
{
    public string OrderId { get; set; } = "";
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public string? PaymentTransactionId { get; set; }
    public OrderStatus NewStatus { get; set; }
}

public class CancelOrderResult
{
    public string OrderId { get; set; } = "";
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public string? RefundTransactionId { get; set; }
}
