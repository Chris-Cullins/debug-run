using EnterpriseApi.Domain;

namespace EnterpriseApi.Infrastructure;

// ================== Service Interfaces ==================

public interface IInventoryService
{
    Task<bool> CheckAvailabilityAsync(string sku, int quantity);
    Task<Dictionary<string, int>> CheckBulkAvailabilityAsync(IEnumerable<(string Sku, int Quantity)> items);
    Task ReserveInventoryAsync(string orderId, IEnumerable<OrderItem> items);
    Task ReleaseInventoryAsync(string orderId);
}

public interface IPricingService
{
    Task<decimal> CalculateLineTotalAsync(string sku, int quantity);
    Task<decimal> CalculateSubtotalAsync(IEnumerable<OrderItem> items);
}

public interface IDiscountService
{
    Task<decimal> CalculateOrderDiscountAsync(Order order, Customer customer);
    Task<decimal> CalculateItemDiscountAsync(OrderItem item, Customer customer);
    Task<(decimal DiscountAmount, string? PromoCode)> ApplyPromotionsAsync(Order order);
}

public interface ITaxService
{
    Task<decimal> CalculateTaxAsync(decimal subtotal, ShippingAddress address);
    Task<decimal> GetTaxRateAsync(string state, string country);
}

public interface IPaymentGateway
{
    Task<PaymentResult> ProcessPaymentAsync(PaymentRequest request);
    Task<RefundResult> ProcessRefundAsync(string transactionId, decimal amount);
}

public interface INotificationService
{
    Task SendOrderConfirmationAsync(Order order, Customer customer);
    Task SendOrderShippedAsync(Order order, Customer customer);
    Task SendOrderCancelledAsync(Order order, Customer customer, string reason);
}

public interface IAuditLogger
{
    Task LogAsync(string action, string entityType, string entityId, object? data = null);
}

// ================== Data Transfer Objects ==================

public class PaymentRequest
{
    public string CustomerId { get; set; } = "";
    public string PaymentMethodId { get; set; } = "";
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "USD";
    public string OrderId { get; set; } = "";
    public Dictionary<string, string> Metadata { get; set; } = new();
}

public class PaymentResult
{
    public bool Success { get; set; }
    public string? TransactionId { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
}

public class RefundResult
{
    public bool Success { get; set; }
    public string? RefundTransactionId { get; set; }
    public string? ErrorMessage { get; set; }
}

// ================== Service Implementations ==================

public class InventoryService : IInventoryService
{
    private readonly Dictionary<string, InventoryItem> _inventory = new()
    {
        ["WIDGET-001"] = new InventoryItem { Sku = "WIDGET-001", Available = 100, Reserved = 0, WarehouseLocation = "A1-01" },
        ["WIDGET-002"] = new InventoryItem { Sku = "WIDGET-002", Available = 50, Reserved = 5, WarehouseLocation = "A1-02" },
        ["GADGET-001"] = new InventoryItem { Sku = "GADGET-001", Available = 30, Reserved = 3, WarehouseLocation = "B2-01" },
        ["GIZMO-001"] = new InventoryItem { Sku = "GIZMO-001", Available = 200, Reserved = 10, WarehouseLocation = "C3-01" },
        ["GIZMO-002"] = new InventoryItem { Sku = "GIZMO-002", Available = 15, Reserved = 2, WarehouseLocation = "C3-02" },
    };

    private readonly Dictionary<string, List<(string Sku, int Qty)>> _reservations = new();

    public Task<bool> CheckAvailabilityAsync(string sku, int quantity)
    {
        if (!_inventory.TryGetValue(sku, out var item))
            return Task.FromResult(false);
        
        return Task.FromResult(item.Available >= quantity);
    }

    public Task<Dictionary<string, int>> CheckBulkAvailabilityAsync(IEnumerable<(string Sku, int Quantity)> items)
    {
        var result = new Dictionary<string, int>();
        foreach (var (sku, quantity) in items)
        {
            if (_inventory.TryGetValue(sku, out var item))
            {
                result[sku] = Math.Min(item.Available, quantity);
            }
            else
            {
                result[sku] = 0;
            }
        }
        return Task.FromResult(result);
    }

    public Task ReserveInventoryAsync(string orderId, IEnumerable<OrderItem> items)
    {
        var reservations = new List<(string Sku, int Qty)>();
        
        foreach (var item in items)
        {
            if (_inventory.TryGetValue(item.Sku, out var inv))
            {
                inv.Available -= item.Quantity;
                inv.Reserved += item.Quantity;
                reservations.Add((item.Sku, item.Quantity));
            }
        }
        
        _reservations[orderId] = reservations;
        return Task.CompletedTask;
    }

    public Task ReleaseInventoryAsync(string orderId)
    {
        if (_reservations.TryGetValue(orderId, out var reservations))
        {
            foreach (var (sku, qty) in reservations)
            {
                if (_inventory.TryGetValue(sku, out var inv))
                {
                    inv.Available += qty;
                    inv.Reserved -= qty;
                }
            }
            _reservations.Remove(orderId);
        }
        return Task.CompletedTask;
    }
}

public class PricingService : IPricingService
{
    private readonly IProductRepository _productRepo;

    public PricingService(IProductRepository productRepo)
    {
        _productRepo = productRepo;
    }

    public async Task<decimal> CalculateLineTotalAsync(string sku, int quantity)
    {
        var product = await _productRepo.GetBySkuAsync(sku);
        if (product is null) return 0;
        return product.Price * quantity;
    }

    public Task<decimal> CalculateSubtotalAsync(IEnumerable<OrderItem> items)
    {
        var subtotal = items.Sum(i => i.LineTotal);
        return Task.FromResult(subtotal);
    }
}

public class DiscountService : IDiscountService
{
    private readonly ILogger<DiscountService> _logger;

    public DiscountService(ILogger<DiscountService> logger)
    {
        _logger = logger;
    }

    public Task<decimal> CalculateOrderDiscountAsync(Order order, Customer customer)
    {
        // Tier-based discount
        var tierDiscount = customer.Tier switch
        {
            CustomerTier.Platinum => 0.15m,
            CustomerTier.Gold => 0.10m,
            CustomerTier.Silver => 0.05m,
            _ => 0m
        };

        var subtotal = order.Items.Sum(i => i.LineTotal);
        var discount = subtotal * tierDiscount;
        
        _logger.LogDebug("Customer {CustomerId} (tier: {Tier}) gets {Discount:P} discount: ${Amount:F2}",
            customer.Id, customer.Tier, tierDiscount, discount);

        return Task.FromResult(discount);
    }

    public Task<decimal> CalculateItemDiscountAsync(OrderItem item, Customer customer)
    {
        // Could implement item-specific promotions here
        return Task.FromResult(0m);
    }

    public Task<(decimal DiscountAmount, string? PromoCode)> ApplyPromotionsAsync(Order order)
    {
        // Placeholder for promo code logic
        return Task.FromResult((0m, (string?)null));
    }
}

public class TaxService : ITaxService
{
    private readonly Dictionary<string, decimal> _taxRates = new()
    {
        ["WA-US"] = 0.101m,  // Washington state
        ["OR-US"] = 0.0m,    // Oregon - no sales tax
        ["CA-US"] = 0.0925m, // California
        ["TX-US"] = 0.0825m, // Texas
        ["NY-US"] = 0.08m,   // New York
        ["DEFAULT"] = 0.07m
    };

    public Task<decimal> CalculateTaxAsync(decimal subtotal, ShippingAddress address)
    {
        var rate = GetTaxRateSync(address.State, address.Country);
        return Task.FromResult(subtotal * rate);
    }

    public Task<decimal> GetTaxRateAsync(string state, string country)
    {
        return Task.FromResult(GetTaxRateSync(state, country));
    }

    private decimal GetTaxRateSync(string state, string country)
    {
        var key = $"{state}-{country}";
        return _taxRates.GetValueOrDefault(key, _taxRates["DEFAULT"]);
    }
}

public class MockPaymentGateway : IPaymentGateway
{
    private readonly ILogger<MockPaymentGateway> _logger;
    private int _transactionCounter = 1000;

    public MockPaymentGateway(ILogger<MockPaymentGateway> logger)
    {
        _logger = logger;
    }

    public Task<PaymentResult> ProcessPaymentAsync(PaymentRequest request)
    {
        _logger.LogInformation("Processing payment for order {OrderId}: ${Amount:F2}",
            request.OrderId, request.Amount);

        // Simulate payment processing
        var txnId = $"TXN-{Interlocked.Increment(ref _transactionCounter)}";
        
        // Simulate occasional failures for testing
        if (request.Amount > 10000)
        {
            return Task.FromResult(new PaymentResult
            {
                Success = false,
                ErrorCode = "AMOUNT_TOO_LARGE",
                ErrorMessage = "Amount exceeds single transaction limit"
            });
        }

        return Task.FromResult(new PaymentResult
        {
            Success = true,
            TransactionId = txnId
        });
    }

    public Task<RefundResult> ProcessRefundAsync(string transactionId, decimal amount)
    {
        _logger.LogInformation("Processing refund for transaction {TransactionId}: ${Amount:F2}",
            transactionId, amount);

        return Task.FromResult(new RefundResult
        {
            Success = true,
            RefundTransactionId = $"REF-{Interlocked.Increment(ref _transactionCounter)}"
        });
    }
}

public class NotificationService : INotificationService
{
    private readonly ILogger<NotificationService> _logger;

    public NotificationService(ILogger<NotificationService> logger)
    {
        _logger = logger;
    }

    public Task SendOrderConfirmationAsync(Order order, Customer customer)
    {
        _logger.LogInformation("Sending order confirmation for {OrderId} to {Email}",
            order.Id, customer.Email);
        // In real app, would queue email/SMS
        return Task.CompletedTask;
    }

    public Task SendOrderShippedAsync(Order order, Customer customer)
    {
        _logger.LogInformation("Sending shipping notification for {OrderId} to {Email}",
            order.Id, customer.Email);
        return Task.CompletedTask;
    }

    public Task SendOrderCancelledAsync(Order order, Customer customer, string reason)
    {
        _logger.LogInformation("Sending cancellation notification for {OrderId} to {Email}. Reason: {Reason}",
            order.Id, customer.Email, reason);
        return Task.CompletedTask;
    }
}

public class AuditLogger : IAuditLogger
{
    private readonly ILogger<AuditLogger> _logger;
    private readonly List<AuditEntry> _entries = new();

    public AuditLogger(ILogger<AuditLogger> logger)
    {
        _logger = logger;
    }

    public Task LogAsync(string action, string entityType, string entityId, object? data = null)
    {
        var entry = new AuditEntry
        {
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Timestamp = DateTime.UtcNow,
            Data = data
        };
        
        _entries.Add(entry);
        _logger.LogInformation("AUDIT: {Action} {EntityType} {EntityId}", action, entityType, entityId);
        
        return Task.CompletedTask;
    }
}

public class AuditEntry
{
    public string Action { get; set; } = "";
    public string EntityType { get; set; } = "";
    public string EntityId { get; set; } = "";
    public DateTime Timestamp { get; set; }
    public object? Data { get; set; }
}
