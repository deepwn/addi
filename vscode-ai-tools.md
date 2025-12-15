# Language Model Tool API

Language model tools enable you to extend the functionality of a large language model (LLM) in chat with domain-specific capabilities. To process a user's chat prompt, [agents](https://code.visualstudio.com/docs/copilot/chat/copilot-chat) in VS Code can automatically invoke these tools to perform specialized tasks as part of the conversation.

By contributing a language model tool in your VS Code extension, you can extend the agentic coding workflow while also providing deep integration with the editor. Extension tools are one of three types of tools available in VS Code, alongside [built-in tools and MCP tools](https://code.visualstudio.com/docs/copilot/chat/chat-tools#_types-of-tools).

In this extension guide, you learn how to create a language model tool by using the Language Model Tools API and how to implement tool calling in a chat extension.

## What is tool calling in an LLM?

A language model tool is a function that can be invoked as part of a language model request. For example, you might have a function that retrieves information from a database, performs some calculation, or calls an online API. When you contribute a tool in a VS Code extension, agent mode can then invoke the tool based on the context of the conversation.

The LLM never actually executes the tool itself, instead the LLM generates the parameters that are used to call your tool. It's important to clearly describe the tool's purpose, functionality, and input parameters so that the tool can be invoked in the right context.

The following diagram shows the tool-calling flow in agent mode in VS Code.

![Tool calling flow](https://code.visualstudio.com/assets/api/extension-guides/ai/tools/copilot-tool-calling-flow.png)

## Create a language model tool

Implementing a language model tool consists of two main parts:

1. Define the tool's configuration in the `package.json` file of your extension.
2. Implement the tool in your extension code by using the [Language Model API reference](https://code.visualstudio.com/api/references/vscode-api#lm).

### 1. Static configuration in package.json

The first step to define a language model tool in your extension is to define it in the `package.json` file of your extension. This configuration includes the tool name, description, input schema, and other metadata:

1. Add an entry for your tool in the `contributes.languageModelTools` section of your extension's `package.json` file.
2. Give the tool a unique name (format `{verb}_{noun}`).
3. If the tool can be used with agents or referenced in a chat prompt with `#`, add properties like `canBeReferencedInPrompt`, `toolReferenceName`, `icon`, `userDescription`.
4. Add a detailed description in `modelDescription`.
5. If the tool takes input parameters, add an `inputSchema` property that describes the tool's input parameters.
6. Add a `when` clause to control when the tool is available.

```json
"contributes": {
    "languageModelTools": [
        {
            "name": "chat-tools-sample_tabCount",
            "displayName": "Tab Count",
            "modelDescription": "Counts the number of open tabs. Returns the count as a number.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tabGroup": {
                        "type": "number",
                        "description": "The tab group to count tabs in."
                    }
                }
            },
            "canBeReferencedInPrompt": true,
            "toolReferenceName": "tabCount"
        }
    ]
}
```

### 2. Tool implementation

Implement the language model tool by using the [Language Model API](https://code.visualstudio.com/api/references/vscode-api#lm).

1. On activation of the extension, register the tool with `vscode.lm.registerTool`.
2. Create a class that implements the `vscode.LanguageModelTool` interface.
3. Add tool confirmation messages in the `prepareInvocation` method.
4. Define an interface that describes the tool input parameters.
5. Implement the `invoke` method.

```typescript
export function registerChatTools(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.lm.registerTool('chat-tools-sample_tabCount', new TabCountTool())
  );
}

class TabCountTool implements vscode.LanguageModelTool<ITabCountParameters> {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<ITabCountParameters>, _token: vscode.CancellationToken) {
        // Implementation...
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Result...`)]);
    }
}
```

## Tool-calling flow

When a user sends a chat prompt, the following steps occur:

1. Copilot determines the list of available tools based on the user's configuration.
2. Copilot sends the request to the LLM and provides it with the prompt, chat context, and the list of tool definitions to consider.
3. The LLM generates a response, which might include one or more requests to invoke a tool.
4. If needed, Copilot invokes the suggested tool(s) with the parameter values provided by the LLM.
5. If there are errors or follow-up tool requests, Copilot iterates over the tool-calling flow until all tool requests are resolved.
6. Copilot returns the final response to the user.

## Guidelines and conventions

- **Naming**: `{verb}_{noun}` for tools, `{noun}` for parameters.
- **Descriptions**: Detailed descriptions for tools and parameters are crucial for the LLM to understand when and how to use them.
- **User confirmation**: Provide clear confirmation messages.
- **Error handling**: Throw meaningful errors that help the LLM recover.
