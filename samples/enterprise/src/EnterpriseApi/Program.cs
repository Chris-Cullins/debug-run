using EnterpriseApi.Domain;
using EnterpriseApi.Features.Orders;
using EnterpriseApi.Infrastructure;
using EnterpriseApi.Middleware;
using FluentValidation;
using MediatR;

var builder = WebApplication.CreateBuilder(args);

// Register MediatR
builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(typeof(Program).Assembly));

// Register validators
builder.Services.AddValidatorsFromAssembly(typeof(Program).Assembly);

// Register infrastructure services
builder.Services.AddSingleton<IOrderRepository, InMemoryOrderRepository>();
builder.Services.AddSingleton<IProductRepository, InMemoryProductRepository>();
builder.Services.AddSingleton<ICustomerRepository, InMemoryCustomerRepository>();
builder.Services.AddSingleton<IInventoryService, InventoryService>();
builder.Services.AddSingleton<IPricingService, PricingService>();
builder.Services.AddSingleton<IDiscountService, DiscountService>();
builder.Services.AddSingleton<ITaxService, TaxService>();
builder.Services.AddSingleton<IPaymentGateway, MockPaymentGateway>();
builder.Services.AddSingleton<INotificationService, NotificationService>();
builder.Services.AddSingleton<IAuditLogger, AuditLogger>();

// Register pipeline behaviors
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
builder.Services.AddTransient(typeof(IPipelineBehavior<,>), typeof(LoggingBehavior<,>));

var app = builder.Build();

Console.WriteLine($"EnterpriseApi starting... PID: {Environment.ProcessId}");

// ================== Orders API ==================

// GET /orders - List all orders with pagination
app.MapGet("/orders", async (IMediator mediator, int? page, int? pageSize) =>
{
    var query = new GetOrdersQuery(page ?? 1, pageSize ?? 10);  // Line 38 - good breakpoint
    var result = await mediator.Send(query);
    return Results.Ok(result);
});

// GET /orders/{id} - Get order by ID
app.MapGet("/orders/{id}", async (string id, IMediator mediator) =>
{
    var query = new GetOrderByIdQuery(id);  // Line 45 - good breakpoint
    var result = await mediator.Send(query);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

// POST /orders - Create a new order
app.MapPost("/orders", async (CreateOrderCommand command, IMediator mediator) =>
{
    try
    {
        var result = await mediator.Send(command);  // Line 54 - good breakpoint for complex flow
        return Results.Created($"/orders/{result.OrderId}", result);
    }
    catch (ValidationException ex)
    {
        return Results.BadRequest(new { errors = ex.Errors.Select(e => e.ErrorMessage) });
    }
});

// POST /orders/{id}/process - Process/fulfill an order
app.MapPost("/orders/{id}/process", async (string id, IMediator mediator) =>
{
    var command = new ProcessOrderCommand(id);  // Line 65 - good for tracing order processing
    var result = await mediator.Send(command);
    return result.Success 
        ? Results.Ok(result) 
        : Results.BadRequest(new { error = result.ErrorMessage });
});

// POST /orders/{id}/cancel - Cancel an order
app.MapPost("/orders/{id}/cancel", async (string id, string? reason, IMediator mediator) =>
{
    var command = new CancelOrderCommand(id, reason ?? "Customer requested");  // Line 75
    var result = await mediator.Send(command);
    return result.Success ? Results.Ok(result) : Results.BadRequest(new { error = result.ErrorMessage });
});

// ================== Products API ==================

app.MapGet("/products", async (IProductRepository repo) =>
{
    var products = await repo.GetAllAsync();
    return Results.Ok(products);
});

app.MapGet("/products/{sku}", async (string sku, IProductRepository repo) =>
{
    var product = await repo.GetBySkuAsync(sku);
    return product is null ? Results.NotFound() : Results.Ok(product);
});

// ================== Customers API ==================

app.MapGet("/customers/{id}", async (string id, ICustomerRepository repo) =>
{
    var customer = await repo.GetByIdAsync(id);
    return customer is null ? Results.NotFound() : Results.Ok(customer);
});

app.Run();

// Make Program class accessible for test project
public partial class Program { }
