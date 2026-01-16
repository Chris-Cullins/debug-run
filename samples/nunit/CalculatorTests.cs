using NUnit.Framework;

namespace SampleTests;

/// <summary>
/// A simple calculator class to test
/// </summary>
public class Calculator
{
    public int Add(int a, int b)
    {
        var result = a + b;
        return result;
    }

    public int Subtract(int a, int b)
    {
        var result = a - b;
        return result;
    }

    public int Multiply(int a, int b)
    {
        var result = a * b;
        return result;
    }

    public double Divide(int a, int b)
    {
        if (b == 0)
            throw new DivideByZeroException("Cannot divide by zero");
        
        var result = (double)a / b;
        return result;
    }
}

[TestFixture]
public class CalculatorTests
{
    private Calculator _calculator = null!;

    [SetUp]
    public void Setup()
    {
        _calculator = new Calculator();
    }

    [Test]
    public void Add_TwoPositiveNumbers_ReturnsSum()
    {
        // Arrange
        var a = 5;
        var b = 3;

        // Act
        var result = _calculator.Add(a, b);

        // Assert
        Assert.That(result, Is.EqualTo(8));
    }

    [Test]
    public void Add_NegativeNumbers_ReturnsCorrectSum()
    {
        // Arrange
        var a = -5;
        var b = -3;

        // Act
        var result = _calculator.Add(a, b);

        // Assert
        Assert.That(result, Is.EqualTo(-8));
    }

    [Test]
    public void Subtract_TwoNumbers_ReturnsDifference()
    {
        // Arrange
        var a = 10;
        var b = 4;

        // Act
        var result = _calculator.Subtract(a, b);

        // Assert
        Assert.That(result, Is.EqualTo(6));
    }

    [Test]
    public void Multiply_TwoNumbers_ReturnsProduct()
    {
        // Arrange
        var a = 6;
        var b = 7;

        // Act
        var result = _calculator.Multiply(a, b);

        // Assert
        Assert.That(result, Is.EqualTo(42));
    }

    [Test]
    public void Divide_ValidNumbers_ReturnsQuotient()
    {
        // Arrange
        var a = 10;
        var b = 2;

        // Act
        var result = _calculator.Divide(a, b);

        // Assert
        Assert.That(result, Is.EqualTo(5.0));
    }

    [Test]
    public void Divide_ByZero_ThrowsException()
    {
        // Arrange
        var a = 10;
        var b = 0;

        // Act & Assert
        Assert.Throws<DivideByZeroException>(() => _calculator.Divide(a, b));
    }

    [TestCase(1, 1, 2)]
    [TestCase(5, 5, 10)]
    [TestCase(100, 200, 300)]
    public void Add_ParameterizedTests_ReturnsExpectedSum(int a, int b, int expected)
    {
        var result = _calculator.Add(a, b);
        Assert.That(result, Is.EqualTo(expected));
    }
}
