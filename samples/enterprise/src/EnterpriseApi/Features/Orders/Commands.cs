using EnterpriseApi.Domain;
using EnterpriseApi.Infrastructure;
using FluentValidation;
using MediatR;

namespace EnterpriseApi.Features.Orders;

// ================== Create Order ==================

public record CreateOrderCommand(
    string CustomerId,
    List<OrderItemDto> Items,
    ShippingAddressDto? ShippingAddress = null
) : IRequest<OrderResult>;

public record OrderItemDto(string Sku, int Quantity);

public record ShippingAddressDto(
    string Street,
    string City,
    string State,
    string PostalCode,
    string Country
);

public class CreateOrderCommandValidator : AbstractValidator<CreateOrderCommand>
{
    public CreateOrderCommandValidator()
    {
        RuleFor(x => x.CustomerId)
            .NotEmpty().WithMessage("Customer ID is required")
            .MaximumLength(50);

        RuleFor(x => x.Items)
            .NotEmpty().WithMessage("Order must have at least one item")
            .Must(items => items.Count <= 100).WithMessage("Order cannot have more than 100 items");

        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.Sku).NotEmpty().WithMessage("SKU is required");
            item.RuleFor(i => i.Quantity)
                .GreaterThan(0).WithMessage("Quantity must be positive")
                .LessThanOrEqualTo(1000).WithMessage("Quantity cannot exceed 1000");
        });
    }
}

public class CreateOrderCommandHandler : IRequestHandler<CreateOrderCommand, OrderResult>
{
    private readonly IOrderRepository _orderRepo;
    private readonly IProductRepository _productRepo;
    private readonly ICustomerRepository _customerRepo;
    private readonly IInventoryService _inventoryService;
    private readonly IPricingService _pricingService;
    private readonly IDiscountService _discountService;
    private readonly ITaxService _taxService;
    private readonly IAuditLogger _auditLogger;

    public CreateOrderCommandHandler(
        IOrderRepository orderRepo,
        IProductRepository productRepo,
        ICustomerRepository customerRepo,
        IInventoryService inventoryService,
        IPricingService pricingService,
        IDiscountService discountService,
        ITaxService taxService,
        IAuditLogger auditLogger)
    {
        _orderRepo = orderRepo;
        _productRepo = productRepo;
        _customerRepo = customerRepo;
        _inventoryService = inventoryService;
        _pricingService = pricingService;
        _discountService = discountService;
        _taxService = taxService;
        _auditLogger = auditLogger;
    }

    public async Task<OrderResult> Handle(CreateOrderCommand request, CancellationToken cancellationToken)
    {
        // Step 1: Validate customer exists
        var customer = await _customerRepo.GetByIdAsync(request.CustomerId);  // Line 77 - good breakpoint
        if (customer is null)
        {
            return new OrderResult { Success = false, ErrorMessage = "Customer not found" };
        }

        // Step 2: Validate products exist and get pricing
        var skus = request.Items.Select(i => i.Sku).ToList();
        var products = (await _productRepo.GetBySkusAsync(skus)).ToDictionary(p => p.Sku);  // Line 85
        
        var missingSkus = skus.Where(s => !products.ContainsKey(s)).ToList();
        if (missingSkus.Any())
        {
            return new OrderResult 
            { 
                Success = false, 
                ErrorMessage = $"Products not found: {string.Join(", ", missingSkus)}" 
            };
        }

        // Step 3: Check inventory availability
        var inventoryCheck = await _inventoryService.CheckBulkAvailabilityAsync(
            request.Items.Select(i => (i.Sku, i.Quantity)));  // Line 97
        
        var outOfStock = request.Items
            .Where(i => inventoryCheck.GetValueOrDefault(i.Sku, 0) < i.Quantity)
            .ToList();
        
        if (outOfStock.Any())
        {
            return new OrderResult
            {
                Success = false,
                ErrorMessage = $"Insufficient inventory for: {string.Join(", ", outOfStock.Select(i => i.Sku))}"
            };
        }

        // Step 4: Build order with pricing
        var orderItems = request.Items.Select(i =>
        {
            var product = products[i.Sku];
            return new OrderItem
            {
                Sku = i.Sku,
                ProductName = product.Name,
                Quantity = i.Quantity,
                UnitPrice = product.Price
            };
        }).ToList();

        var order = new Order
        {
            CustomerId = request.CustomerId,
            Items = orderItems,
            Status = OrderStatus.Pending,
            ShippingAddress = request.ShippingAddress is not null 
                ? new ShippingAddress
                {
                    Street = request.ShippingAddress.Street,
                    City = request.ShippingAddress.City,
                    State = request.ShippingAddress.State,
                    PostalCode = request.ShippingAddress.PostalCode,
                    Country = request.ShippingAddress.Country
                }
                : customer.DefaultShippingAddress,
            Events = new List<OrderEvent>
            {
                new() { EventType = "Created", Timestamp = DateTime.UtcNow, Description = "Order created" }
            }
        };

        // Step 5: Calculate totals
        var subtotal = await _pricingService.CalculateSubtotalAsync(orderItems);  // Line 145
        var discount = await _discountService.CalculateOrderDiscountAsync(order, customer);
        var taxableAmount = subtotal - discount;
        var tax = order.ShippingAddress is not null 
            ? await _taxService.CalculateTaxAsync(taxableAmount, order.ShippingAddress)
            : 0m;
        var shippingCost = CalculateShippingCost(orderItems);

        order.Totals = new OrderTotals
        {
            Subtotal = subtotal,
            DiscountTotal = discount,
            TaxAmount = tax,
            ShippingCost = shippingCost,
            GrandTotal = subtotal - discount + tax + shippingCost  // Line 158 - verify calculation
        };

        // Step 6: Save order
        order = await _orderRepo.CreateAsync(order);  // Line 162

        // Step 7: Reserve inventory
        await _inventoryService.ReserveInventoryAsync(order.Id, orderItems);

        // Step 8: Audit log
        await _auditLogger.LogAsync("OrderCreated", "Order", order.Id, new { CustomerId = customer.Id, Total = order.Totals.GrandTotal });

        return new OrderResult
        {
            OrderId = order.Id,
            Status = order.Status,
            Totals = order.Totals,
            Success = true
        };
    }

    private decimal CalculateShippingCost(List<OrderItem> items)
    {
        var itemCount = items.Sum(i => i.Quantity);
        return itemCount switch
        {
            <= 5 => 5.99m,
            <= 10 => 7.99m,
            <= 20 => 9.99m,
            _ => 14.99m
        };
    }
}

// ================== Process Order ==================

public record ProcessOrderCommand(string OrderId) : IRequest<ProcessOrderResult>;

public class ProcessOrderCommandHandler : IRequestHandler<ProcessOrderCommand, ProcessOrderResult>
{
    private readonly IOrderRepository _orderRepo;
    private readonly ICustomerRepository _customerRepo;
    private readonly IPaymentGateway _paymentGateway;
    private readonly INotificationService _notificationService;
    private readonly IAuditLogger _auditLogger;

    public ProcessOrderCommandHandler(
        IOrderRepository orderRepo,
        ICustomerRepository customerRepo,
        IPaymentGateway paymentGateway,
        INotificationService notificationService,
        IAuditLogger auditLogger)
    {
        _orderRepo = orderRepo;
        _customerRepo = customerRepo;
        _paymentGateway = paymentGateway;
        _notificationService = notificationService;
        _auditLogger = auditLogger;
    }

    public async Task<ProcessOrderResult> Handle(ProcessOrderCommand request, CancellationToken cancellationToken)
    {
        // Step 1: Get order
        var order = await _orderRepo.GetByIdAsync(request.OrderId);  // Line 213 - start of process flow
        if (order is null)
        {
            return new ProcessOrderResult { Success = false, ErrorMessage = "Order not found" };
        }

        // Step 2: Validate order can be processed
        if (order.Status != OrderStatus.Pending && order.Status != OrderStatus.Validated)
        {
            return new ProcessOrderResult 
            { 
                Success = false, 
                ErrorMessage = $"Order cannot be processed in status: {order.Status}" 
            };
        }

        // Step 3: Get customer for payment
        var customer = await _customerRepo.GetByIdAsync(order.CustomerId);  // Line 228
        if (customer is null)
        {
            return new ProcessOrderResult { Success = false, ErrorMessage = "Customer not found" };
        }

        // Step 4: Process payment
        var defaultPayment = customer.PaymentMethods.FirstOrDefault(p => p.IsDefault)
            ?? customer.PaymentMethods.FirstOrDefault();
        
        if (defaultPayment is null)
        {
            return new ProcessOrderResult { Success = false, ErrorMessage = "No payment method available" };
        }

        order.Status = OrderStatus.PaymentProcessing;
        order.Events.Add(new OrderEvent 
        { 
            EventType = "PaymentInitiated", 
            Timestamp = DateTime.UtcNow, 
            Description = "Payment processing started" 
        });
        await _orderRepo.UpdateAsync(order);

        var paymentResult = await _paymentGateway.ProcessPaymentAsync(new PaymentRequest  // Line 252
        {
            CustomerId = customer.Id,
            PaymentMethodId = defaultPayment.Id,
            Amount = order.Totals!.GrandTotal,
            OrderId = order.Id,
            Metadata = new Dictionary<string, string> { ["order_id"] = order.Id }
        });

        if (!paymentResult.Success)  // Line 261 - check payment result
        {
            order.Status = OrderStatus.Pending;  // Revert status
            order.Events.Add(new OrderEvent 
            { 
                EventType = "PaymentFailed", 
                Timestamp = DateTime.UtcNow, 
                Description = $"Payment failed: {paymentResult.ErrorMessage}" 
            });
            await _orderRepo.UpdateAsync(order);

            return new ProcessOrderResult 
            { 
                Success = false, 
                ErrorMessage = $"Payment failed: {paymentResult.ErrorMessage}",
                OrderId = order.Id
            };
        }

        // Step 5: Update order with payment info
        order.Status = OrderStatus.PaymentConfirmed;
        order.Payment = new PaymentInfo
        {
            TransactionId = paymentResult.TransactionId!,
            Status = "Confirmed",
            Amount = order.Totals.GrandTotal,
            ProcessedAt = DateTime.UtcNow
        };
        order.BillingInfo = new BillingInfo
        {
            PaymentMethodId = defaultPayment.Id,
            CardLast4 = defaultPayment.Last4,
            CardBrand = defaultPayment.Brand ?? "Unknown"
        };
        order.Events.Add(new OrderEvent 
        { 
            EventType = "PaymentConfirmed", 
            Timestamp = DateTime.UtcNow, 
            Description = $"Payment confirmed: {paymentResult.TransactionId}" 
        });
        
        await _orderRepo.UpdateAsync(order);  // Line 300

        // Step 6: Award loyalty points
        var pointsEarned = (int)(order.Totals.GrandTotal * 10);  // 10 points per dollar
        await _customerRepo.UpdateLoyaltyPointsAsync(customer.Id, pointsEarned);

        // Step 7: Send confirmation
        await _notificationService.SendOrderConfirmationAsync(order, customer);

        // Step 8: Audit
        await _auditLogger.LogAsync("OrderProcessed", "Order", order.Id, new 
        { 
            TransactionId = paymentResult.TransactionId,
            Amount = order.Totals.GrandTotal,
            PointsEarned = pointsEarned
        });

        return new ProcessOrderResult
        {
            OrderId = order.Id,
            Success = true,
            PaymentTransactionId = paymentResult.TransactionId,
            NewStatus = order.Status
        };
    }
}

// ================== Cancel Order ==================

public record CancelOrderCommand(string OrderId, string Reason) : IRequest<CancelOrderResult>;

public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, CancelOrderResult>
{
    private readonly IOrderRepository _orderRepo;
    private readonly ICustomerRepository _customerRepo;
    private readonly IInventoryService _inventoryService;
    private readonly IPaymentGateway _paymentGateway;
    private readonly INotificationService _notificationService;
    private readonly IAuditLogger _auditLogger;

    public CancelOrderCommandHandler(
        IOrderRepository orderRepo,
        ICustomerRepository customerRepo,
        IInventoryService inventoryService,
        IPaymentGateway paymentGateway,
        INotificationService notificationService,
        IAuditLogger auditLogger)
    {
        _orderRepo = orderRepo;
        _customerRepo = customerRepo;
        _inventoryService = inventoryService;
        _paymentGateway = paymentGateway;
        _notificationService = notificationService;
        _auditLogger = auditLogger;
    }

    public async Task<CancelOrderResult> Handle(CancelOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await _orderRepo.GetByIdAsync(request.OrderId);
        if (order is null)
        {
            return new CancelOrderResult { Success = false, ErrorMessage = "Order not found" };
        }

        // Can only cancel pending or confirmed orders (not shipped/delivered)
        if (order.Status >= OrderStatus.Shipped)
        {
            return new CancelOrderResult 
            { 
                Success = false, 
                ErrorMessage = $"Cannot cancel order in status: {order.Status}" 
            };
        }

        var customer = await _customerRepo.GetByIdAsync(order.CustomerId);

        // If payment was made, process refund
        string? refundTxnId = null;
        if (order.Payment is not null)
        {
            var refundResult = await _paymentGateway.ProcessRefundAsync(
                order.Payment.TransactionId, 
                order.Payment.Amount);
            
            if (!refundResult.Success)
            {
                return new CancelOrderResult 
                { 
                    Success = false, 
                    ErrorMessage = $"Refund failed: {refundResult.ErrorMessage}" 
                };
            }
            refundTxnId = refundResult.RefundTransactionId;
        }

        // Release reserved inventory
        await _inventoryService.ReleaseInventoryAsync(order.Id);

        // Update order status
        order.Status = OrderStatus.Cancelled;
        order.Events.Add(new OrderEvent
        {
            EventType = "Cancelled",
            Timestamp = DateTime.UtcNow,
            Description = $"Order cancelled. Reason: {request.Reason}"
        });
        await _orderRepo.UpdateAsync(order);

        // Notify customer
        if (customer is not null)
        {
            await _notificationService.SendOrderCancelledAsync(order, customer, request.Reason);
        }

        // Audit
        await _auditLogger.LogAsync("OrderCancelled", "Order", order.Id, new 
        { 
            Reason = request.Reason,
            RefundTransactionId = refundTxnId
        });

        return new CancelOrderResult
        {
            OrderId = order.Id,
            Success = true,
            RefundTransactionId = refundTxnId
        };
    }
}
