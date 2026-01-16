// Sample application for testing debug-run
// Run with: debug-run ./bin/Debug/net9.0/SampleApp.dll -a netcoredbg -b "Program.cs:25"

// Enterprise-style setup with many reference types
var config = new AppConfiguration
{
    Environment = "Development",
    Region = "us-west-2",
    Features = new FeatureFlags
    {
        EnableDiscounts = true,
        EnableLoyaltyPoints = true,
        EnableEmailNotifications = false,
        EnableSmsNotifications = false,
        MaxOrderItems = 100,
        DiscountThreshold = 100m
    },
    ConnectionStrings = new ConnectionStrings
    {
        Database = "Server=localhost;Database=Orders;",
        Cache = "localhost:6379",
        MessageQueue = "amqp://localhost:5672"
    },
    Logging = new LoggingConfiguration
    {
        MinLevel = "Debug",
        OutputPath = "/var/log/app",
        EnableConsole = true,
        EnableFile = true
    }
};

var logger = new Logger(config.Logging);
var metrics = new MetricsCollector("OrderService", config.Region);
var cache = new CacheService(config.ConnectionStrings.Cache, logger);
var eventBus = new EventBus(config.ConnectionStrings.MessageQueue, logger);

var customerRepo = new CustomerRepository(logger);
var productRepo = new ProductRepository(logger);
var orderRepo = new OrderRepository(logger);
var inventoryRepo = new InventoryRepository(logger);

var pricingService = new PricingService(config.Features, logger);
var taxService = new TaxService(config.Region, logger);
var discountService = new DiscountService(config.Features, pricingService, logger);
var loyaltyService = new LoyaltyService(config.Features, customerRepo, logger);
var notificationService = new NotificationService(config.Features, eventBus, logger);
var validationService = new ValidationService(config, logger);
var auditService = new AuditService(logger, metrics);

var orderService = new OrderService(
    config,
    logger,
    metrics,
    cache,
    customerRepo,
    productRepo,
    orderRepo,
    inventoryRepo,
    pricingService,
    taxService,
    discountService,
    loyaltyService,
    notificationService,
    validationService,
    auditService
);

// Create some sample orders
var order1 = new Order("ORD-001", "Alice", new List<OrderItem>
{
    new("SKU-100", "Widget", 2, 19.99m),
    new("SKU-101", "Gadget", 1, 49.99m),
});

var order2 = new Order("ORD-002", "Bob", new List<OrderItem>
{
    new("SKU-100", "Widget", 5, 19.99m),
    new("SKU-102", "Gizmo", 3, 29.99m),
});

// Create a customer context with lots of reference data
var customer = new Customer
{
    Id = "CUST-001",
    Name = "Alice Johnson",
    Email = "alice@example.com",
    LoyaltyTier = LoyaltyTier.Gold,
    LoyaltyPoints = 5420,
    Address = new Address
    {
        Street = "123 Main St",
        City = "Seattle",
        State = "WA",
        ZipCode = "98101",
        Country = "US"
    },
    Preferences = new CustomerPreferences
    {
        PreferredCurrency = "USD",
        PreferredLanguage = "en-US",
        EmailOptIn = true,
        SmsOptIn = false
    },
    PaymentMethods = new List<PaymentMethod>
    {
        new PaymentMethod { Type = PaymentType.CreditCard, Last4 = "4242", IsDefault = true },
        new PaymentMethod { Type = PaymentType.PayPal, Last4 = "****", IsDefault = false }
    }
};

var context = new OrderContext
{
    Order = order1,
    Customer = customer,
    Session = new SessionInfo
    {
        SessionId = Guid.NewGuid().ToString(),
        StartedAt = DateTime.UtcNow,
        IpAddress = "192.168.1.100",
        UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    },
    Metadata = new Dictionary<string, object>
    {
        ["source"] = "web",
        ["campaign"] = "summer-sale",
        ["referrer"] = "google"
    }
};

// Process orders - good breakpoint targets
Console.WriteLine("Processing orders...");

var result1 = orderService.ProcessOrder(context);  // Breakpoint here: Program.cs:121
Console.WriteLine($"Order {order1.OrderId}: {result1}");

context.Order = order2;
var result2 = orderService.ProcessOrder(context);  // Or here
Console.WriteLine($"Order {order2.OrderId}: {result2}");

// Try an order that will fail validation
var badOrder = new Order("ORD-003", "", new List<OrderItem>());
context.Order = badOrder;
try
{
    orderService.ProcessOrder(context);  // Exception breakpoint target
}
catch (ValidationException ex)
{
    Console.WriteLine($"Validation failed: {ex.Message}");
}

Console.WriteLine("Done!");

// ============ Configuration Classes ============

public class AppConfiguration
{
    public string Environment { get; set; } = "";
    public string Region { get; set; } = "";
    public FeatureFlags Features { get; set; } = new();
    public ConnectionStrings ConnectionStrings { get; set; } = new();
    public LoggingConfiguration Logging { get; set; } = new();
}

public class FeatureFlags
{
    public bool EnableDiscounts { get; set; }
    public bool EnableLoyaltyPoints { get; set; }
    public bool EnableEmailNotifications { get; set; }
    public bool EnableSmsNotifications { get; set; }
    public int MaxOrderItems { get; set; }
    public decimal DiscountThreshold { get; set; }
}

public class ConnectionStrings
{
    public string Database { get; set; } = "";
    public string Cache { get; set; } = "";
    public string MessageQueue { get; set; } = "";
}

public class LoggingConfiguration
{
    public string MinLevel { get; set; } = "";
    public string OutputPath { get; set; } = "";
    public bool EnableConsole { get; set; }
    public bool EnableFile { get; set; }
}

// ============ Domain Classes ============

public record OrderItem(string Sku, string Name, int Quantity, decimal UnitPrice)
{
    public decimal Total => Quantity * UnitPrice;
}

public record Order(string OrderId, string CustomerName, List<OrderItem> Items)
{
    public decimal Subtotal => Items.Sum(i => i.Total);
    public decimal Tax => Subtotal * 0.08m;
    public decimal Total => Subtotal + Tax;
}

public enum LoyaltyTier { Bronze, Silver, Gold, Platinum }
public enum PaymentType { CreditCard, DebitCard, PayPal, BankTransfer }

public class Customer
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public LoyaltyTier LoyaltyTier { get; set; }
    public int LoyaltyPoints { get; set; }
    public Address Address { get; set; } = new();
    public CustomerPreferences Preferences { get; set; } = new();
    public List<PaymentMethod> PaymentMethods { get; set; } = new();
}

public class Address
{
    public string Street { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public string ZipCode { get; set; } = "";
    public string Country { get; set; } = "";
}

public class CustomerPreferences
{
    public string PreferredCurrency { get; set; } = "";
    public string PreferredLanguage { get; set; } = "";
    public bool EmailOptIn { get; set; }
    public bool SmsOptIn { get; set; }
}

public class PaymentMethod
{
    public PaymentType Type { get; set; }
    public string Last4 { get; set; } = "";
    public bool IsDefault { get; set; }
}

public class OrderContext
{
    public Order Order { get; set; } = null!;
    public Customer Customer { get; set; } = null!;
    public SessionInfo Session { get; set; } = new();
    public Dictionary<string, object> Metadata { get; set; } = new();
}

public class SessionInfo
{
    public string SessionId { get; set; } = "";
    public DateTime StartedAt { get; set; }
    public string IpAddress { get; set; } = "";
    public string UserAgent { get; set; } = "";
}

// ============ Infrastructure Services ============

public class Logger
{
    private readonly LoggingConfiguration _config;
    public Logger(LoggingConfiguration config) => _config = config;
    public void Log(string level, string message) { if (_config.EnableConsole) Console.WriteLine($"[{level}] {message}"); }
    public void Debug(string message) => Log("DEBUG", message);
    public void Info(string message) => Log("INFO", message);
    public void Warn(string message) => Log("WARN", message);
    public void Error(string message) => Log("ERROR", message);
}

public class MetricsCollector
{
    private readonly string _serviceName;
    private readonly string _region;
    private readonly Dictionary<string, long> _counters = new();
    private readonly Dictionary<string, double> _gauges = new();
    
    public MetricsCollector(string serviceName, string region)
    {
        _serviceName = serviceName;
        _region = region;
    }
    
    public void Increment(string metric) => _counters[metric] = _counters.GetValueOrDefault(metric) + 1;
    public void Gauge(string metric, double value) => _gauges[metric] = value;
}

public class CacheService
{
    private readonly string _connectionString;
    private readonly Logger _logger;
    private readonly Dictionary<string, object> _localCache = new();
    
    public CacheService(string connectionString, Logger logger)
    {
        _connectionString = connectionString;
        _logger = logger;
    }
    
    public T? Get<T>(string key) => _localCache.TryGetValue(key, out var val) ? (T)val : default;
    public void Set<T>(string key, T value) => _localCache[key] = value!;
}

public class EventBus
{
    private readonly string _connectionString;
    private readonly Logger _logger;
    private readonly List<object> _publishedEvents = new();
    
    public EventBus(string connectionString, Logger logger)
    {
        _connectionString = connectionString;
        _logger = logger;
    }
    
    public void Publish<T>(T evt) => _publishedEvents.Add(evt!);
}

// ============ Repository Classes ============

public class CustomerRepository
{
    private readonly Logger _logger;
    private readonly Dictionary<string, Customer> _customers = new();
    
    public CustomerRepository(Logger logger) => _logger = logger;
    public Customer? GetById(string id) => _customers.GetValueOrDefault(id);
    public void Save(Customer customer) => _customers[customer.Id] = customer;
}

public class ProductRepository
{
    private readonly Logger _logger;
    private readonly Dictionary<string, Product> _products = new();
    
    public ProductRepository(Logger logger) => _logger = logger;
    public Product? GetBySku(string sku) => _products.GetValueOrDefault(sku);
}

public class Product
{
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public string Category { get; set; } = "";
}

public class OrderRepository
{
    private readonly Logger _logger;
    private readonly Dictionary<string, Order> _orders = new();
    
    public OrderRepository(Logger logger) => _logger = logger;
    public Order? GetById(string id) => _orders.GetValueOrDefault(id);
    public void Save(Order order) => _orders[order.OrderId] = order;
}

public class InventoryRepository
{
    private readonly Logger _logger;
    private readonly Dictionary<string, int> _inventory = new()
    {
        ["SKU-100"] = 10,
        ["SKU-101"] = 5,
        ["SKU-102"] = 2,
    };
    
    public InventoryRepository(Logger logger) => _logger = logger;
    public int GetStock(string sku) => _inventory.GetValueOrDefault(sku);
    public void Reserve(string sku, int quantity) => _inventory[sku] = _inventory.GetValueOrDefault(sku) - quantity;
}

// ============ Business Services ============

public class PricingService
{
    private readonly FeatureFlags _features;
    private readonly Logger _logger;
    
    public PricingService(FeatureFlags features, Logger logger)
    {
        _features = features;
        _logger = logger;
    }
    
    public decimal CalculatePrice(Order order) => order.Total;
}

public class TaxService
{
    private readonly string _region;
    private readonly Logger _logger;
    private readonly Dictionary<string, decimal> _taxRates = new()
    {
        ["us-west-2"] = 0.08m,
        ["us-east-1"] = 0.07m,
        ["eu-west-1"] = 0.20m
    };
    
    public TaxService(string region, Logger logger)
    {
        _region = region;
        _logger = logger;
    }
    
    public decimal CalculateTax(decimal amount) => amount * _taxRates.GetValueOrDefault(_region, 0.1m);
}

public class DiscountService
{
    private readonly FeatureFlags _features;
    private readonly PricingService _pricingService;
    private readonly Logger _logger;
    
    public DiscountService(FeatureFlags features, PricingService pricingService, Logger logger)
    {
        _features = features;
        _pricingService = pricingService;
        _logger = logger;
    }
    
    public decimal CalculateDiscount(Order order, Customer customer)
    {
        if (!_features.EnableDiscounts) return 0;
        if (order.Total < _features.DiscountThreshold) return 0;
        
        var tierDiscount = customer.LoyaltyTier switch
        {
            LoyaltyTier.Platinum => 0.15m,
            LoyaltyTier.Gold => 0.10m,
            LoyaltyTier.Silver => 0.05m,
            _ => 0m
        };
        
        return order.Total * tierDiscount;
    }
}

public class LoyaltyService
{
    private readonly FeatureFlags _features;
    private readonly CustomerRepository _customerRepo;
    private readonly Logger _logger;
    
    public LoyaltyService(FeatureFlags features, CustomerRepository customerRepo, Logger logger)
    {
        _features = features;
        _customerRepo = customerRepo;
        _logger = logger;
    }
    
    public int CalculatePoints(decimal amount) => _features.EnableLoyaltyPoints ? (int)(amount * 10) : 0;
}

public class NotificationService
{
    private readonly FeatureFlags _features;
    private readonly EventBus _eventBus;
    private readonly Logger _logger;
    
    public NotificationService(FeatureFlags features, EventBus eventBus, Logger logger)
    {
        _features = features;
        _eventBus = eventBus;
        _logger = logger;
    }
    
    public void SendOrderConfirmation(Order order, Customer customer)
    {
        if (_features.EnableEmailNotifications)
            _eventBus.Publish(new { Type = "email", To = customer.Email, Subject = $"Order {order.OrderId} confirmed" });
    }
}

public class ValidationService
{
    private readonly AppConfiguration _config;
    private readonly Logger _logger;
    
    public ValidationService(AppConfiguration config, Logger logger)
    {
        _config = config;
        _logger = logger;
    }
    
    public void ValidateOrder(Order order)
    {
        if (string.IsNullOrEmpty(order.OrderId))
            throw new ValidationException("Order ID is required");
        if (string.IsNullOrEmpty(order.CustomerName))
            throw new ValidationException("Customer name is required");
        if (order.Items.Count == 0)
            throw new ValidationException("Order must have at least one item");
        if (order.Items.Count > _config.Features.MaxOrderItems)
            throw new ValidationException($"Order exceeds max items ({_config.Features.MaxOrderItems})");
    }
}

public class AuditService
{
    private readonly Logger _logger;
    private readonly MetricsCollector _metrics;
    private readonly List<AuditEntry> _auditLog = new();
    
    public AuditService(Logger logger, MetricsCollector metrics)
    {
        _logger = logger;
        _metrics = metrics;
    }
    
    public void LogOrderProcessed(Order order, string result)
    {
        _auditLog.Add(new AuditEntry { OrderId = order.OrderId, Action = "processed", Result = result, Timestamp = DateTime.UtcNow });
        _metrics.Increment("orders_processed");
    }
}

public class AuditEntry
{
    public string OrderId { get; set; } = "";
    public string Action { get; set; } = "";
    public string Result { get; set; } = "";
    public DateTime Timestamp { get; set; }
}

// ============ Main Order Service ============

public class OrderService
{
    private readonly AppConfiguration _config;
    private readonly Logger _logger;
    private readonly MetricsCollector _metrics;
    private readonly CacheService _cache;
    private readonly CustomerRepository _customerRepo;
    private readonly ProductRepository _productRepo;
    private readonly OrderRepository _orderRepo;
    private readonly InventoryRepository _inventoryRepo;
    private readonly PricingService _pricingService;
    private readonly TaxService _taxService;
    private readonly DiscountService _discountService;
    private readonly LoyaltyService _loyaltyService;
    private readonly NotificationService _notificationService;
    private readonly ValidationService _validationService;
    private readonly AuditService _auditService;

    public OrderService(
        AppConfiguration config,
        Logger logger,
        MetricsCollector metrics,
        CacheService cache,
        CustomerRepository customerRepo,
        ProductRepository productRepo,
        OrderRepository orderRepo,
        InventoryRepository inventoryRepo,
        PricingService pricingService,
        TaxService taxService,
        DiscountService discountService,
        LoyaltyService loyaltyService,
        NotificationService notificationService,
        ValidationService validationService,
        AuditService auditService)
    {
        _config = config;
        _logger = logger;
        _metrics = metrics;
        _cache = cache;
        _customerRepo = customerRepo;
        _productRepo = productRepo;
        _orderRepo = orderRepo;
        _inventoryRepo = inventoryRepo;
        _pricingService = pricingService;
        _taxService = taxService;
        _discountService = discountService;
        _loyaltyService = loyaltyService;
        _notificationService = notificationService;
        _validationService = validationService;
        _auditService = auditService;
    }

    public string ProcessOrder(OrderContext context)
    {
        var order = context.Order;
        var customer = context.Customer;
        
        // Validate order - GOOD BREAKPOINT: lots of services in scope
        _validationService.ValidateOrder(order);
        _logger.Debug($"Order {order.OrderId} validated");

        // Check inventory
        foreach (var item in order.Items)
        {
            var stock = _inventoryRepo.GetStock(item.Sku);
            if (stock < item.Quantity)
            {
                _logger.Warn($"Low stock for {item.Sku}: {stock} < {item.Quantity}");
            }
            _inventoryRepo.Reserve(item.Sku, item.Quantity);
        }

        // Calculate totals
        var subtotal = order.Subtotal;
        var tax = _taxService.CalculateTax(subtotal);
        var discount = _discountService.CalculateDiscount(order, customer);
        var loyaltyPoints = _loyaltyService.CalculatePoints(subtotal);
        var finalTotal = subtotal + tax - discount;

        // Save and notify
        _orderRepo.Save(order);
        _notificationService.SendOrderConfirmation(order, customer);
        
        var result = $"Processed - Subtotal: ${subtotal:F2}, Tax: ${tax:F2}, Discount: ${discount:F2}, Points: {loyaltyPoints}, Final: ${finalTotal:F2}";
        _auditService.LogOrderProcessed(order, result);
        
        return result;
    }
}

public class ValidationException : Exception
{
    public ValidationException(string message) : base(message) { }
}
