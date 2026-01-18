using EnterpriseApi.Domain;
using EnterpriseApi.Infrastructure;
using MediatR;

namespace EnterpriseApi.Features.Orders;

// ================== Get Orders (Paginated) ==================

public record GetOrdersQuery(int Page, int PageSize) : IRequest<PagedResult<OrderSummaryDto>>;

public record OrderSummaryDto(
    string OrderId,
    string CustomerId,
    OrderStatus Status,
    int ItemCount,
    decimal GrandTotal,
    DateTime CreatedAt
);

public record PagedResult<T>(
    IEnumerable<T> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages
);

public class GetOrdersQueryHandler : IRequestHandler<GetOrdersQuery, PagedResult<OrderSummaryDto>>
{
    private readonly IOrderRepository _orderRepo;

    public GetOrdersQueryHandler(IOrderRepository orderRepo)
    {
        _orderRepo = orderRepo;
    }

    public async Task<PagedResult<OrderSummaryDto>> Handle(GetOrdersQuery request, CancellationToken cancellationToken)
    {
        var orders = await _orderRepo.GetAllAsync(request.Page, request.PageSize);
        var totalCount = await _orderRepo.GetTotalCountAsync();

        var items = orders.Select(o => new OrderSummaryDto(
            o.Id,
            o.CustomerId,
            o.Status,
            o.Items.Sum(i => i.Quantity),
            o.Totals?.GrandTotal ?? 0,
            o.CreatedAt
        ));

        return new PagedResult<OrderSummaryDto>(
            items,
            request.Page,
            request.PageSize,
            totalCount,
            (int)Math.Ceiling(totalCount / (double)request.PageSize)
        );
    }
}

// ================== Get Order By ID ==================

public record GetOrderByIdQuery(string OrderId) : IRequest<OrderDetailDto?>;

public record OrderDetailDto(
    string OrderId,
    string CustomerId,
    OrderStatus Status,
    List<OrderItemDetailDto> Items,
    ShippingAddressDto? ShippingAddress,
    OrderTotalsDto? Totals,
    PaymentInfoDto? Payment,
    List<OrderEventDto> Events,
    DateTime CreatedAt,
    DateTime? UpdatedAt
);

public record OrderItemDetailDto(
    string Sku,
    string ProductName,
    int Quantity,
    decimal UnitPrice,
    decimal? DiscountAmount,
    decimal LineTotal
);

public record OrderTotalsDto(
    decimal Subtotal,
    decimal DiscountTotal,
    decimal TaxAmount,
    decimal ShippingCost,
    decimal GrandTotal
);

public record PaymentInfoDto(
    string TransactionId,
    string Status,
    decimal Amount,
    DateTime ProcessedAt
);

public record OrderEventDto(
    string EventType,
    DateTime Timestamp,
    string Description
);

public class GetOrderByIdQueryHandler : IRequestHandler<GetOrderByIdQuery, OrderDetailDto?>
{
    private readonly IOrderRepository _orderRepo;

    public GetOrderByIdQueryHandler(IOrderRepository orderRepo)
    {
        _orderRepo = orderRepo;
    }

    public async Task<OrderDetailDto?> Handle(GetOrderByIdQuery request, CancellationToken cancellationToken)
    {
        var order = await _orderRepo.GetByIdAsync(request.OrderId);  // Line 103 - good breakpoint
        if (order is null) return null;

        return new OrderDetailDto(
            order.Id,
            order.CustomerId,
            order.Status,
            order.Items.Select(i => new OrderItemDetailDto(
                i.Sku,
                i.ProductName,
                i.Quantity,
                i.UnitPrice,
                i.DiscountAmount,
                i.LineTotal
            )).ToList(),
            order.ShippingAddress is not null 
                ? new ShippingAddressDto(
                    order.ShippingAddress.Street,
                    order.ShippingAddress.City,
                    order.ShippingAddress.State,
                    order.ShippingAddress.PostalCode,
                    order.ShippingAddress.Country)
                : null,
            order.Totals is not null
                ? new OrderTotalsDto(
                    order.Totals.Subtotal,
                    order.Totals.DiscountTotal,
                    order.Totals.TaxAmount,
                    order.Totals.ShippingCost,
                    order.Totals.GrandTotal)
                : null,
            order.Payment is not null
                ? new PaymentInfoDto(
                    order.Payment.TransactionId,
                    order.Payment.Status,
                    order.Payment.Amount,
                    order.Payment.ProcessedAt)
                : null,
            order.Events.Select(e => new OrderEventDto(
                e.EventType,
                e.Timestamp,
                e.Description
            )).ToList(),
            order.CreatedAt,
            order.UpdatedAt
        );
    }
}
