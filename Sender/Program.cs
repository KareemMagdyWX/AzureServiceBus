using System.Text.Json;
using Azure.Messaging.ServiceBus;

namespace Sender;

class Program
{
    static async Task Main(string[] args)
    {
        var connectionString =
            "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;";

        var queueName = "queue.1";

        await using var client = new ServiceBusClient(connectionString);
        await using var sender = client.CreateSender(queueName);

        Console.WriteLine("=== Service Bus Sender ===");
        Console.WriteLine("Type a message and press Enter to send.");
        Console.WriteLine("Type 'exit' to quit.\n");

        while (true)
        {
            var input = Console.ReadLine();

            if (string.IsNullOrEmpty(input))
                continue;

            if (input.Equals("/", StringComparison.OrdinalIgnoreCase))
                break;

            try
            {
                var message = new ChatMessage
                {
                    Text = input,
                    Timestamp = DateTime.UtcNow
                    
                };

                var busMessage = new ServiceBusMessage(
                    BinaryData.FromString(JsonSerializer.Serialize(message)))
                {
                    MessageId = Guid.NewGuid().ToString(),
                    CorrelationId = Guid.NewGuid().ToString(),
                    // ScheduledEnqueueTime = DateTimeOffset.UtcNow.AddSeconds(20)
                    SessionId = "HIGH"
                };
                
                await sender.ScheduleMessageAsync(busMessage, DateTimeOffset.UtcNow.AddSeconds(20));
                Console.WriteLine($"Sent: {message.Text} at {message.Timestamp})\n");
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