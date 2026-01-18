using FluentValidation;
using MediatR;

namespace EnterpriseApi.Middleware;

// ================== Validation Pipeline Behavior ==================

public class ValidationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : IRequest<TResponse>
{
    private readonly IEnumerable<IValidator<TRequest>> _validators;

    public ValidationBehavior(IEnumerable<IValidator<TRequest>> validators)
    {
        _validators = validators;
    }

    public async Task<TResponse> Handle(
        TRequest request, 
        RequestHandlerDelegate<TResponse> next, 
        CancellationToken cancellationToken)
    {
        if (!_validators.Any())
        {
            return await next();
        }

        var context = new ValidationContext<TRequest>(request);
        
        var validationResults = await Task.WhenAll(
            _validators.Select(v => v.ValidateAsync(context, cancellationToken)));

        var failures = validationResults
            .SelectMany(r => r.Errors)
            .Where(f => f is not null)
            .ToList();

        if (failures.Count != 0)
        {
            throw new ValidationException(failures);  // Line 38 - good breakpoint for validation errors
        }

        return await next();
    }
}

// ================== Logging Pipeline Behavior ==================

public class LoggingBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : IRequest<TResponse>
{
    private readonly ILogger<LoggingBehavior<TRequest, TResponse>> _logger;

    public LoggingBehavior(ILogger<LoggingBehavior<TRequest, TResponse>> logger)
    {
        _logger = logger;
    }

    public async Task<TResponse> Handle(
        TRequest request, 
        RequestHandlerDelegate<TResponse> next, 
        CancellationToken cancellationToken)
    {
        var requestName = typeof(TRequest).Name;
        var startTime = DateTime.UtcNow;

        _logger.LogInformation("Handling {RequestName}", requestName);  // Line 62

        try
        {
            var response = await next();  // Line 66 - execution of handler
            
            var elapsed = DateTime.UtcNow - startTime;
            _logger.LogInformation("Handled {RequestName} in {ElapsedMs}ms", 
                requestName, elapsed.TotalMilliseconds);

            return response;
        }
        catch (Exception ex)
        {
            var elapsed = DateTime.UtcNow - startTime;
            _logger.LogError(ex, "Error handling {RequestName} after {ElapsedMs}ms", 
                requestName, elapsed.TotalMilliseconds);
            throw;
        }
    }
}
