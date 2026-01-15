// Sample application for testing debug-run
// Run with: debug-run ./bin/Debug/net9.0/SampleApp.dll -a netcoredbg -b "Program.cs:25"

var orderService = new OrderService();

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

// Process orders - good breakpoint targets
Console.WriteLine("Processing orders...");

var result1 = orderService.ProcessOrder(order1);  // Breakpoint here: Program.cs:23
Console.WriteLine($"Order {order1.OrderId}: {result1}");

var result2 = orderService.ProcessOrder(order2);  // Or here: Program.cs:26
Console.WriteLine($"Order {order2.OrderId}: {result2}");

// Try an order that will fail validation
var badOrder = new Order("ORD-003", "", new List<OrderItem>());
try
{
    orderService.ProcessOrder(badOrder);  // Exception breakpoint target
}
catch (ValidationException ex)
{
    Console.WriteLine($"Validation failed: {ex.Message}");
}

Console.WriteLine("Done!");

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

public class OrderService
{
    private readonly Dictionary<string, int> _inventory = new()
    {
        ["SKU-100"] = 10,
        ["SKU-101"] = 5,
        ["SKU-102"] = 2,  // Low stock - will cause issues
    };

    public string ProcessOrder(Order order)
    {
        // Validate order - good place to inspect 'order' variable
        ValidateOrder(order);

        // Check inventory
        foreach (var item in order.Items)
        {
            CheckInventory(item);  // Breakpoint: see inventory state
        }

        // Calculate totals - inspect calculation
        var subtotal = order.Subtotal;
        var tax = order.Tax;
        var total = order.Total;

        // Apply discount for large orders
        var discount = 0m;
        if (total > 100)
        {
            discount = total * 0.1m;  // 10% discount
        }

        var finalTotal = total - discount;

        return $"Processed - Subtotal: ${subtotal:F2}, Tax: ${tax:F2}, Discount: ${discount:F2}, Final: ${finalTotal:F2}";
    }

    private void ValidateOrder(Order order)
    {
        if (string.IsNullOrEmpty(order.OrderId))
            throw new ValidationException("Order ID is required");

        if (string.IsNullOrEmpty(order.CustomerName))
            throw new ValidationException("Customer name is required");

        if (order.Items.Count == 0)
            throw new ValidationException("Order must have at least one item");
    }

    private void CheckInventory(OrderItem item)
    {
        if (!_inventory.TryGetValue(item.Sku, out var available))
        {
            throw new ValidationException($"Unknown product: {item.Sku}");
        }

        if (available < item.Quantity)
        {
            // This will trigger for SKU-102 with quantity 3 but only 2 available
            Console.WriteLine($"Warning: Low stock for {item.Sku} - requested {item.Quantity}, available {available}");
        }

        // Reserve inventory
        _inventory[item.Sku] = available - item.Quantity;
    }
}

public class ValidationException : Exception
{
    public ValidationException(string message) : base(message) { }
}
