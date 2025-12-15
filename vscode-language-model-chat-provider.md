# Language Model Chat Provider API

The Language Model Chat Provider API enables you to contribute a language model to VS Code. This allows extensions to use your language model in their chat participants or other features.

## Why implement a language model chat provider?

Implementing a language model chat provider allows you to:

- **Bring your own model**: Integrate your custom or proprietary language models into VS Code.
- **Enable other extensions**: Allow other extensions to use your model for their AI features.
- **Provide specialized capabilities**: Offer models that are fine-tuned for specific domains or tasks.

## Implement a language model chat provider

To implement a language model chat provider, you need to:

1. Register the provider in `package.json`.
2. Implement the `LanguageModelChat` interface.
3. Register the provider in your extension's activation function.

### 1. Register the provider

In your `package.json`, add the `languageModelChatProviders` contribution point:

```json
"contributes": {
    "languageModelChatProviders": [
        {
            "id": "my-provider",
            "name": "My Provider"
        }
    ]
}
```

### 2. Implement the LanguageModelChat interface

Create a class that implements `vscode.LanguageModelChatProvider`. This interface requires you to implement the `provideLanguageModelResponse` method.

```typescript
import * as vscode from 'vscode';

export class MyLanguageModelProvider implements vscode.LanguageModelChatProvider {
    async provideLanguageModelResponse(
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
        extensionId: string,
        progress: vscode.Progress<vscode.LanguageModelChatResponseFragment>,
        token: vscode.CancellationToken
    ): Promise<any> {
        // Implementation goes here
    }
}
```

### 3. Register the provider

In your extension's `activate` function, register the provider:

```typescript
export function activate(context: vscode.ExtensionContext) {
    const provider = new MyLanguageModelProvider();
    context.subscriptions.push(vscode.chat.registerLanguageModelChatProvider('my-provider', provider));
}
```

## Handling requests

When `provideLanguageModelResponse` is called, you receive:

- `messages`: An array of chat messages representing the conversation history.
- `options`: Options for the request, such as model parameters.
- `extensionId`: The ID of the extension making the request.
- `progress`: A progress object to report response fragments.
- `token`: A cancellation token to handle request cancellation.

You should process the messages and stream the response back using the `progress` object.

```typescript
async provideLanguageModelResponse(
    messages: vscode.LanguageModelChatMessage[],
    options: vscode.LanguageModelChatRequestOptions,
    extensionId: string,
    progress: vscode.Progress<vscode.LanguageModelChatResponseFragment>,
    token: vscode.CancellationToken
): Promise<any> {
    // Convert messages to your model's format
    const prompt = this.convertToModelFormat(messages);

    // Call your model API
    const response = await this.callModelApi(prompt, options, token);

    // Stream the response
    for await (const chunk of response) {
        if (token.isCancellationRequested) {
            break;
        }
        progress.report({ index: 0, part: new vscode.LanguageModelTextPart(chunk) });
    }
}
```

## Related content

- [Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat)
