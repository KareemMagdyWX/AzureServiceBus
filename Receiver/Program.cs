using System.Text.Json;
using Azure.Messaging.ServiceBus;

namespace Receiver;

class Program
{
    static async Task Main(string[] args)
    {
        var connectionString =
            "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;";

        var queueName = "queue.1";

        var client = new ServiceBusClient(connectionString);
        var receiver = client.CreateReceiver(queueName);

        Console.WriteLine("Receiver ....\n");

        while (true)
        {
            var message = await receiver.ReceiveMessageAsync(TimeSpan.FromSeconds(5));

            
            if (message == null) continue;
            
           
            var chatMessage = JsonSerializer.Deserialize<ChatMessage>(message.Body.ToString());
                
            Console.WriteLine($"Received: {message.SequenceNumber} - {chatMessage?.Text} at {DateTime.UtcNow}\n");
                
            await receiver.CompleteMessageAsync(message);
        }
    }
}

public class ChatMessage
{
    public string Text { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
}