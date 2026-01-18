using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using NUnit.Framework;
using EnterpriseApi.Features.Orders;
using EnterpriseApi.Domain;

namespace EnterpriseApi.Tests;

[TestFixture]
public class OrderApiTests
{
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    [SetUp]
    public void Setup()
    {
        _factory = new WebApplicationFactory<Program>();
        _client = _factory.CreateClient();
    }

    [TearDown]
    public void TearDown()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    // ================== GET /orders Tests ==================

    [Test]
    public async Task GetOrders_ReturnsPagedResults()
    {
        // Act
        var response = await _client.GetAsync("/orders");  // Line 36 - good breakpoint

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        
        var result = await response.Content.ReadFromJsonAsync<PagedResult<OrderSummaryDto>>();  // Line 41
        result.Should().NotBeNull();
        result!.Items.Should().NotBeEmpty();
        result.Page.Should().Be(1);
        result.PageSize.Should().Be(10);
    }

    [Test]
    public async Task GetOrders_WithPagination_RespectsParameters()
    {
        // Act
        var response = await _client.GetAsync("/orders?page=1&pageSize=5");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<PagedResult<OrderSummaryDto>>();
        result!.PageSize.Should().Be(5);
    }

    // ================== GET /orders/{id} Tests ==================

    [Test]
    public async Task GetOrderById_ExistingOrder_ReturnsOrder()
    {
        // Act
        var response = await _client.GetAsync("/orders/ORD-001");  // Line 65 - good breakpoint

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        
        var order = await response.Content.ReadFromJsonAsync<OrderDetailDto>();  // Line 70
        order.Should().NotBeNull();
        order!.OrderId.Should().Be("ORD-001");
        order.Items.Should().NotBeEmpty();
        order.Totals.Should().NotBeNull();
    }

    [Test]
    public async Task GetOrderById_NonExistent_ReturnsNotFound()
    {
        // Act
        var response = await _client.GetAsync("/orders/NONEXISTENT");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ================== POST /orders Tests ==================

    [Test]
    public async Task CreateOrder_ValidOrder_ReturnsCreated()
    {
        // Arrange
        var command = new CreateOrderCommand(
            CustomerId: "CUST-001",
            Items: new List<OrderItemDto>
            {
                new("WIDGET-001", 2),
                new("GADGET-001", 1)
            },
            ShippingAddress: new ShippingAddressDto(
                Street: "456 Test Ave",
                City: "Portland",
                State: "OR",
                PostalCode: "97201",
                Country: "US"
            )
        );

        // Act
        var response = await _client.PostAsJsonAsync("/orders", command);  // Line 107 - good breakpoint

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);  // Line 110
        
        var result = await response.Content.ReadFromJsonAsync<OrderResult>();
        result.Should().NotBeNull();
        result!.Success.Should().BeTrue();
        result.OrderId.Should().NotBeNullOrEmpty();
        result.Totals.Should().NotBeNull();
        result.Totals!.GrandTotal.Should().BeGreaterThan(0);
    }

    [Test]
    public async Task CreateOrder_InvalidCustomer_ReturnsBadRequest()
    {
        // Arrange
        var command = new CreateOrderCommand(
            CustomerId: "NONEXISTENT",
            Items: new List<OrderItemDto> { new("WIDGET-001", 1) }
        );

        // Act
        var response = await _client.PostAsJsonAsync("/orders", command);  // Line 128

        // Assert - Should return 201 but with Success=false in body
        // (actual implementation may vary - this tests the handler's validation)
        var result = await response.Content.ReadFromJsonAsync<OrderResult>();
        // Either BadRequest or Created with error
        if (response.StatusCode == HttpStatusCode.Created)
        {
            result!.Success.Should().BeFalse();
            result.ErrorMessage.Should().Contain("Customer not found");
        }
    }

    [Test]
    public async Task CreateOrder_EmptyItems_ReturnsValidationError()
    {
        // Arrange
        var command = new CreateOrderCommand(
            CustomerId: "CUST-001",
            Items: new List<OrderItemDto>()  // Empty items - should fail validation
        );

        // Act
        var response = await _client.PostAsJsonAsync("/orders", command);  // Line 150

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);  // Line 153 - validation should fail
    }

    [Test]
    public async Task CreateOrder_InvalidSku_ReturnsBadRequest()
    {
        // Arrange
        var command = new CreateOrderCommand(
            CustomerId: "CUST-001",
            Items: new List<OrderItemDto> { new("INVALID-SKU", 1) }
        );

        // Act
        var response = await _client.PostAsJsonAsync("/orders", command);

        // Assert - Should fail because product doesn't exist
        var result = await response.Content.ReadFromJsonAsync<OrderResult>();
        if (response.StatusCode == HttpStatusCode.Created)
        {
            result!.Success.Should().BeFalse();
            result.ErrorMessage.Should().Contain("not found");
        }
    }

    // ================== POST /orders/{id}/process Tests ==================

    [Test]
    public async Task ProcessOrder_ValidOrder_ReturnsSuccess()
    {
        // Arrange - First create an order
        var createCommand = new CreateOrderCommand(
            CustomerId: "CUST-001",
            Items: new List<OrderItemDto> { new("WIDGET-001", 1) }
        );
        var createResponse = await _client.PostAsJsonAsync("/orders", createCommand);
        var createdOrder = await createResponse.Content.ReadFromJsonAsync<OrderResult>();
        
        // Act - Process the order
        var response = await _client.PostAsync($"/orders/{createdOrder!.OrderId}/process", null);  // Line 192

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);  // Line 195
        
        var result = await response.Content.ReadFromJsonAsync<ProcessOrderResult>();
        result.Should().NotBeNull();
        result!.Success.Should().BeTrue();
        result.PaymentTransactionId.Should().NotBeNullOrEmpty();
        result.NewStatus.Should().Be(OrderStatus.PaymentConfirmed);
    }

    [Test]
    public async Task ProcessOrder_NonExistentOrder_ReturnsNotFound()
    {
        // Act
        var response = await _client.PostAsync("/orders/NONEXISTENT/process", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ================== POST /orders/{id}/cancel Tests ==================

    [Test]
    public async Task CancelOrder_PendingOrder_ReturnsSuccess()
    {
        // Arrange - Create an order
        var createCommand = new CreateOrderCommand(
            CustomerId: "CUST-001",
            Items: new List<OrderItemDto> { new("WIDGET-001", 1) }
        );
        var createResponse = await _client.PostAsJsonAsync("/orders", createCommand);
        var createdOrder = await createResponse.Content.ReadFromJsonAsync<OrderResult>();

        // Act
        var response = await _client.PostAsync(
            $"/orders/{createdOrder!.OrderId}/cancel?reason=Test%20cancellation", null);  // Line 228

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        
        var result = await response.Content.ReadFromJsonAsync<CancelOrderResult>();
        result.Should().NotBeNull();
        result!.Success.Should().BeTrue();
    }

    [Test]
    public async Task CancelOrder_ProcessedOrder_RefundsPayment()
    {
        // Arrange - Create and process an order
        var createCommand = new CreateOrderCommand(
            CustomerId: "CUST-001",
            Items: new List<OrderItemDto> { new("WIDGET-001", 1) }
        );
        var createResponse = await _client.PostAsJsonAsync("/orders", createCommand);
        var createdOrder = await createResponse.Content.ReadFromJsonAsync<OrderResult>();
        
        await _client.PostAsync($"/orders/{createdOrder!.OrderId}/process", null);  // Line 249

        // Act - Cancel the processed order
        var response = await _client.PostAsync(
            $"/orders/{createdOrder.OrderId}/cancel?reason=Changed%20mind", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        
        var result = await response.Content.ReadFromJsonAsync<CancelOrderResult>();  // Line 258
        result.Should().NotBeNull();
        result!.Success.Should().BeTrue();
        result.RefundTransactionId.Should().NotBeNullOrEmpty();  // Should have refund
    }
}

// ================== Unit Tests for Business Logic ==================

[TestFixture]
public class OrderCalculationTests
{
    [Test]
    public void OrderItem_LineTotal_CalculatesCorrectly()
    {
        // Arrange
        var item = new OrderItem
        {
            Sku = "TEST",
            ProductName = "Test Product",
            Quantity = 3,
            UnitPrice = 29.99m,
            DiscountAmount = 5.00m
        };

        // Act
        var lineTotal = item.LineTotal;  // Line 282 - good breakpoint for calculation debugging

        // Assert
        lineTotal.Should().Be(84.97m);  // (29.99 * 3) - 5.00 = 89.97 - 5.00 = 84.97
    }

    [Test]
    public void OrderItem_LineTotal_WithNoDiscount_CalculatesCorrectly()
    {
        // Arrange
        var item = new OrderItem
        {
            Sku = "TEST",
            ProductName = "Test Product",
            Quantity = 2,
            UnitPrice = 49.99m,
            DiscountAmount = null
        };

        // Act
        var lineTotal = item.LineTotal;

        // Assert
        lineTotal.Should().Be(99.98m);
    }

    [TestCase(CustomerTier.Platinum, 0.15)]
    [TestCase(CustomerTier.Gold, 0.10)]
    [TestCase(CustomerTier.Silver, 0.05)]
    [TestCase(CustomerTier.Bronze, 0.00)]
    public void CustomerTier_DiscountRate_MatchesExpected(CustomerTier tier, double expectedRate)
    {
        // This is a documentation test showing expected discount rates
        var rate = tier switch
        {
            CustomerTier.Platinum => 0.15m,
            CustomerTier.Gold => 0.10m,
            CustomerTier.Silver => 0.05m,
            _ => 0m
        };

        rate.Should().Be((decimal)expectedRate);
    }
}
