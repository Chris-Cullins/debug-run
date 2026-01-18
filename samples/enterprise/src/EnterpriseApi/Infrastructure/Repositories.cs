using EnterpriseApi.Domain;

namespace EnterpriseApi.Infrastructure;

// ================== Repository Interfaces ==================

public interface IOrderRepository
{
    Task<Order?> GetByIdAsync(string id);
    Task<IEnumerable<Order>> GetAllAsync(int page, int pageSize);
    Task<Order> CreateAsync(Order order);
    Task<Order> UpdateAsync(Order order);
    Task<int> GetTotalCountAsync();
}

public interface IProductRepository
{
    Task<Product?> GetBySkuAsync(string sku);
    Task<IEnumerable<Product>> GetAllAsync();
    Task<IEnumerable<Product>> GetBySkusAsync(IEnumerable<string> skus);
}

public interface ICustomerRepository
{
    Task<Customer?> GetByIdAsync(string id);
    Task<Customer?> GetByEmailAsync(string email);
    Task UpdateLoyaltyPointsAsync(string customerId, int pointsDelta);
}

// ================== In-Memory Implementations ==================

public class InMemoryOrderRepository : IOrderRepository
{
    private readonly Dictionary<string, Order> _orders = new();
    private int _nextId = 1;
    private readonly object _lock = new();

    public InMemoryOrderRepository()
    {
        // Seed with sample orders
        var order1 = new Order
        {
            Id = "ORD-001",
            CustomerId = "CUST-001",
            Status = OrderStatus.Pending,
            CreatedAt = DateTime.UtcNow.AddDays(-2),
            Items = new List<OrderItem>
            {
                new() { Sku = "WIDGET-001", ProductName = "Standard Widget", Quantity = 2, UnitPrice = 29.99m },
                new() { Sku = "GADGET-001", ProductName = "Smart Gadget", Quantity = 1, UnitPrice = 99.99m }
            },
            ShippingAddress = new ShippingAddress
            {
                Street = "123 Main St",
                City = "Seattle",
                State = "WA",
                PostalCode = "98101",
                Country = "US"
            },
            Totals = new OrderTotals
            {
                Subtotal = 159.97m,
                DiscountTotal = 0,
                TaxAmount = 14.40m,
                ShippingCost = 5.99m,
                GrandTotal = 180.36m
            }
        };
        _orders[order1.Id] = order1;
        _nextId = 2;
    }

    public Task<Order?> GetByIdAsync(string id)
    {
        return Task.FromResult(_orders.GetValueOrDefault(id));
    }

    public Task<IEnumerable<Order>> GetAllAsync(int page, int pageSize)
    {
        var orders = _orders.Values
            .OrderByDescending(o => o.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize);
        return Task.FromResult(orders);
    }

    public Task<Order> CreateAsync(Order order)
    {
        lock (_lock)
        {
            order.Id = $"ORD-{_nextId++:D3}";
            order.CreatedAt = DateTime.UtcNow;
            _orders[order.Id] = order;
            return Task.FromResult(order);
        }
    }

    public Task<Order> UpdateAsync(Order order)
    {
        order.UpdatedAt = DateTime.UtcNow;
        _orders[order.Id] = order;
        return Task.FromResult(order);
    }

    public Task<int> GetTotalCountAsync()
    {
        return Task.FromResult(_orders.Count);
    }
}

public class InMemoryProductRepository : IProductRepository
{
    private readonly Dictionary<string, Product> _products = new()
    {
        ["WIDGET-001"] = new Product
        {
            Sku = "WIDGET-001",
            Name = "Standard Widget",
            Description = "A reliable widget for everyday use",
            Price = 29.99m,
            Category = "Widgets",
            StockQuantity = 100,
            IsActive = true,
            Dimensions = new ProductDimensions { WeightKg = 0.5m, LengthCm = 10, WidthCm = 8, HeightCm = 5 },
            Tags = new List<string> { "popular", "bestseller" }
        },
        ["WIDGET-002"] = new Product
        {
            Sku = "WIDGET-002",
            Name = "Premium Widget",
            Description = "Top-tier widget with advanced features",
            Price = 59.99m,
            Category = "Widgets",
            StockQuantity = 50,
            IsActive = true,
            Tags = new List<string> { "premium" }
        },
        ["GADGET-001"] = new Product
        {
            Sku = "GADGET-001",
            Name = "Smart Gadget",
            Description = "IoT-enabled gadget with app control",
            Price = 99.99m,
            Category = "Gadgets",
            StockQuantity = 30,
            IsActive = true,
            Tags = new List<string> { "smart", "iot" }
        },
        ["GIZMO-001"] = new Product
        {
            Sku = "GIZMO-001",
            Name = "Compact Gizmo",
            Description = "Space-saving gizmo for small spaces",
            Price = 19.99m,
            Category = "Gizmos",
            StockQuantity = 200,
            IsActive = true
        },
        ["GIZMO-002"] = new Product
        {
            Sku = "GIZMO-002",
            Name = "Deluxe Gizmo",
            Description = "Full-featured gizmo with all the bells and whistles",
            Price = 149.99m,
            Category = "Gizmos",
            StockQuantity = 15,
            IsActive = true,
            Tags = new List<string> { "deluxe", "featured" }
        }
    };

    public Task<Product?> GetBySkuAsync(string sku)
    {
        return Task.FromResult(_products.GetValueOrDefault(sku));
    }

    public Task<IEnumerable<Product>> GetAllAsync()
    {
        return Task.FromResult<IEnumerable<Product>>(_products.Values.ToList());
    }

    public Task<IEnumerable<Product>> GetBySkusAsync(IEnumerable<string> skus)
    {
        var products = skus
            .Select(sku => _products.GetValueOrDefault(sku))
            .Where(p => p is not null)
            .Cast<Product>()
            .ToList();
        return Task.FromResult<IEnumerable<Product>>(products);
    }
}

public class InMemoryCustomerRepository : ICustomerRepository
{
    private readonly Dictionary<string, Customer> _customers = new()
    {
        ["CUST-001"] = new Customer
        {
            Id = "CUST-001",
            Email = "alice@example.com",
            FirstName = "Alice",
            LastName = "Johnson",
            Tier = CustomerTier.Gold,
            LoyaltyPoints = 5420,
            CreatedAt = DateTime.UtcNow.AddYears(-2),
            DefaultShippingAddress = new ShippingAddress
            {
                Street = "123 Main St",
                City = "Seattle",
                State = "WA",
                PostalCode = "98101",
                Country = "US"
            },
            PaymentMethods = new List<PaymentMethod>
            {
                new() { Id = "pm_001", Type = "card", Last4 = "4242", Brand = "Visa", IsDefault = true },
                new() { Id = "pm_002", Type = "paypal", Last4 = "****", IsDefault = false }
            },
            Preferences = new CustomerPreferences
            {
                PreferredCurrency = "USD",
                PreferredLanguage = "en",
                EmailNotifications = true,
                SmsNotifications = false
            }
        },
        ["CUST-002"] = new Customer
        {
            Id = "CUST-002",
            Email = "bob@example.com",
            FirstName = "Bob",
            LastName = "Smith",
            Tier = CustomerTier.Silver,
            LoyaltyPoints = 1250,
            CreatedAt = DateTime.UtcNow.AddMonths(-6),
            DefaultShippingAddress = new ShippingAddress
            {
                Street = "456 Oak Ave",
                City = "Portland",
                State = "OR",
                PostalCode = "97201",
                Country = "US"
            },
            PaymentMethods = new List<PaymentMethod>
            {
                new() { Id = "pm_003", Type = "card", Last4 = "1234", Brand = "Mastercard", IsDefault = true }
            }
        },
        ["CUST-003"] = new Customer
        {
            Id = "CUST-003",
            Email = "charlie@example.com",
            FirstName = "Charlie",
            LastName = "Brown",
            Tier = CustomerTier.Platinum,
            LoyaltyPoints = 25000,
            CreatedAt = DateTime.UtcNow.AddYears(-5)
        }
    };

    public Task<Customer?> GetByIdAsync(string id)
    {
        return Task.FromResult(_customers.GetValueOrDefault(id));
    }

    public Task<Customer?> GetByEmailAsync(string email)
    {
        var customer = _customers.Values.FirstOrDefault(c => 
            c.Email.Equals(email, StringComparison.OrdinalIgnoreCase));
        return Task.FromResult(customer);
    }

    public Task UpdateLoyaltyPointsAsync(string customerId, int pointsDelta)
    {
        if (_customers.TryGetValue(customerId, out var customer))
        {
            customer.LoyaltyPoints += pointsDelta;
        }
        return Task.CompletedTask;
    }
}
