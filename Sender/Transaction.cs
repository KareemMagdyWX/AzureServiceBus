namespace Sender;

public class Transaction
{
    public string Id { get; set; } =  Guid.NewGuid().ToString();
    public decimal Amount { get; set; } = Decimal.Zero;
    
}