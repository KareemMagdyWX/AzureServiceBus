using System.Text.Json;
using Azure.Messaging.ServiceBus;

var connectionString =
    "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;";

await using var client = new ServiceBusClient(connectionString);

var processor = client.CreateProcessor("queue.1" , new ServiceBusProcessorOptions
{
    AutoCompleteMessages = true
}

);

processor.ProcessErrorAsync += args =>
{
    Console.WriteLine(args.Exception.ToString());
    return Task.CompletedTask;
};
processor.ProcessMessageAsync += args =>
{
    var chatMessage = JsonSerializer.Deserialize<ChatMessage>(args.Message.Body.ToString());
    
    Console.WriteLine($"Received: {chatMessage?.Text} at {chatMessage?.Timestamp}");
    return Task.CompletedTask;
    // await args.CompleteMessageAsync(args.Message);// rmvs the message from the queue
};

await processor.StartProcessingAsync();

Console.WriteLine("CLICK ANY TO STOP");
Console.ReadKey();

await processor.StopProcessingAsync();

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