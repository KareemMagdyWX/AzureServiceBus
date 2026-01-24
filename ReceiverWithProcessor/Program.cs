using Azure.Messaging.ServiceBus;

var connectionString = "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;";

await using var client = new ServiceBusClient(connectionString);

var processor = client.CreateProcessor("queue.1" , new ServiceBusProcessorOptions()
{
    AutoCompleteMessages = true
});

processor.ProcessErrorAsync += args =>
{
    Console.WriteLine(args.Exception.ToString());
    return Task.CompletedTask;
};
processor.ProcessMessageAsync += async args =>
{
    Console.WriteLine($"Received: {args.Message.Body}");
    // await args.CompleteMessageAsync(args.Message);// rmvs the message from the queue
};

await processor.StartProcessingAsync();

Console.WriteLine("CLICK ANY TO STOP");
Console.ReadKey();

await processor.StopProcessingAsync();