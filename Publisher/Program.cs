using System.Text.Json;
using Azure.Messaging.ServiceBus;

namespace Publisher;

class Program
{
    static async Task Main(string[] args)
    {
        var connectionString =
            "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;";

        var queueName = "topic.1"; 

        await using var client = new ServiceBusClient(connectionString);
        await using var sender = client.CreateSender(queueName);

        Console.WriteLine("=== Service Bus Sender ===");

        while (true)
        {
            var input = Console.ReadLine();

            if (string.IsNullOrEmpty(input))
                continue;

            if (input.Equals("/", StringComparison.OrdinalIgnoreCase))
                break;

            try
            {
                var message = new Transaction()
                {
                    Id = Guid.NewGuid().ToString(),
                    Amount = decimal.Parse(input),
                    
                };
                

                var busMessage = new ServiceBusMessage(
                    BinaryData.FromString(JsonSerializer.Serialize(message)))
                {
                    MessageId = Guid.NewGuid().ToString(), // that will be used to detect duplication within duplication window
                    CorrelationId = Guid.NewGuid().ToString(),
                    ApplicationProperties =
                    {
                        ["Priority"] = message.Amount > 1000 ? "High" : "Low",
                    },
                    // ScheduledEnqueueTime = DateTimeOffset.UtcNow.AddSeconds(20)
                    // SessionId = "HIGH" // can be used for priority
                };

                await sender.ScheduleMessageAsync(busMessage, DateTimeOffset.UtcNow.AddSeconds(0));
                Console.WriteLine($"Sent: {message.Amount} at {DateTime.UtcNow})\n");
            }
            catch (Exception ex)
            {
            }
        }
    }
}

public class ChatMessage
{
    public string Text { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
}

public class Transaction

{
    public string Id { get; set; } =  Guid.NewGuid().ToString();
    public decimal Amount { get; set; } = Decimal.Zero;
    
}