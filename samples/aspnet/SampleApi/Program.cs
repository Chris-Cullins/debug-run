// Simple ASP.NET Web API for testing debug-run attach mode
// Run with: dotnet run
// Then attach with: debug-run --attach --pid <PID> -a vsdbg -b "Program.cs:35"

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<OrderService>();

var app = builder.Build();

// Simple health check
app.MapGet("/", () => "SampleApi is running!");

// Get all orders
app.MapGet("/orders", (OrderService svc) =>
{
    var orders = svc.GetAllOrders();  // Good breakpoint: line 15
    return orders;
});

// Get order by ID
app.MapGet("/orders/{id}", (string id, OrderService svc) =>
{
    var order = svc.GetOrder(id);  // Good breakpoint: line 22
    if (order is null)
        return Results.NotFound($"Order {id} not found");
    return Results.Ok(order);
});

// Create a new order
app.MapPost("/orders", (CreateOrderRequest request, OrderService svc) =>
{
    var order = svc.CreateOrder(request.CustomerName, request.Items);  // Good breakpoint: line 31
    return Results.Created($"/orders/{order.Id}", order);
});

// Process an order (calculate totals, validate)
app.MapPost("/orders/{id}/process", (string id, OrderService svc) =>
{
    var result = svc.ProcessOrder(id);  // Good breakpoint: line 38
    if (result is null)
        return Results.NotFound($"Order {id} not found");
    return Results.Ok(result);
});

Console.WriteLine($"SampleApi starting... PID: {Environment.ProcessId}");
app.Run();

// ============ Models ============

public record OrderItem(string ProductId, string Name, int Quantity, decimal UnitPrice)
{
    public decimal Total => Quantity * UnitPrice;
}

public record Order(string Id, string CustomerName, List<OrderItem> Items, DateTime CreatedAt)
{
    public decimal Subtotal => Items.Sum(i => i.Total);
    public decimal Tax => Subtotal * 0.08m;
    public decimal Total => Subtotal + Tax;
}

public record CreateOrderRequest(string CustomerName, List<OrderItem> Items);

public record ProcessedOrder(Order Order, decimal Discount, decimal FinalTotal, string Status);

// ============ Service ============

public class OrderService
{
    private readonly Dictionary<string, Order> _orders = new();
    private int _nextId = 1;

    public OrderService()
    {
        // Seed with sample data
        CreateOrder("Alice", new List<OrderItem>
        {
            new("PROD-001", "Widget", 2, 19.99m),
            new("PROD-002", "Gadget", 1, 49.99m)
        });
        CreateOrder("Bob", new List<OrderItem>
        {
            new("PROD-001", "Widget", 5, 19.99m),
            new("PROD-003", "Gizmo", 3, 29.99m)
        });
    }

    public List<Order> GetAllOrders()
    {
        return _orders.Values.ToList();
    }

    public Order? GetOrder(string id)
    {
        return _orders.GetValueOrDefault(id);
    }

    public Order CreateOrder(string customerName, List<OrderItem> items)
    {
        var id = $"ORD-{_nextId++:D3}";
        var order = new Order(id, customerName, items, DateTime.UtcNow);
        _orders[id] = order;
        return order;
    }

    public ProcessedOrder? ProcessOrder(string id)
    {
        var order = GetOrder(id);
        if (order is null) return null;

        // Calculate discount (10% for orders over $100)
        var discount = 0m;
        if (order.Total > 100)  // Good breakpoint: line 104
        {
            discount = order.Total * 0.10m;
        }

        var finalTotal = order.Total - discount;
        var status = finalTotal > 200 ? "Premium" : "Standard";

        return new ProcessedOrder(order, discount, finalTotal, status);  // Good breakpoint: line 112
    }
}
