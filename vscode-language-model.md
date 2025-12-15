# Language Model API

The Language Model API enables you to use the Language Model (LLM) available in VS Code in your extension. You can use the Language Model API to summarize a file, provide code suggestions, or implement a chat participant.

## Why use the Language Model API?

Using the Language Model API has several benefits:

- **Standardized access**: Access the LLM in a standardized way, regardless of the underlying model provider.
- **User choice**: Respect the user's choice of model. Users can select which model they want to use for chat and other AI features.
- **Integration**: Seamlessly integrate with other VS Code AI features.

## Use the Language Model API

To use the Language Model API, you need to:

1. Select a language model.
2. Send a request to the language model.
3. Handle the response.

### 1. Select a language model

You can get a list of available language models using `vscode.lm.selectChatModels`. You can filter the models by family, vendor, or other properties.

```typescript
const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
const model = models[0];
```

### 2. Send a request

Once you have a model, you can send a request using `model.sendRequest`. You need to provide the messages and a cancellation token.

```typescript
const messages = [
    vscode.LanguageModelChatMessage.User('Hello, how are you?')
];

const response = await model.sendRequest(messages, {}, token);
```

### 3. Handle the response

The response is a stream of fragments. You can iterate over the stream to get the text parts.

```typescript
let text = '';
for await (const fragment of response.text) {
    text += fragment;
}
console.log(text);
```

## Tool calling

The Language Model API supports tool calling. You can provide a list of tools to the model, and the model can request to call these tools.

```typescript
const tools = [
    {
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: 'The city and state, e.g. San Francisco, CA'
                },
                unit: {
                    type: 'string',
                    enum: ['celsius', 'fahrenheit']
                }
            },
            required: ['location']
        }
    }
];

const response = await model.sendRequest(messages, { tools }, token);
```

## Related content

- [Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat)
- [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)
