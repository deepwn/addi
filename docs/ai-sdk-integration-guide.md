# AI SDK Integration Guide for Addi

## Overview

This document summarizes key concepts from the Vercel AI SDK official documentation and provides guidance on integrating AI SDK Core and AI SDK UI into the Addi VS Code extension.

## Table of Contents

1. [AI SDK Core](#ai-sdk-core)
2. [AI SDK UI](#ai-sdk-ui)
3. [Integration Strategy for VS Code Extensions](#integration-strategy-for-vs-code-extensions)
4. [Architecture Design for Playground](#architecture-design-for-playground)
5. [Migration Plan](#migration-plan)
6. [References](#references)

---

## AI SDK Core

### Key Functions

#### generateText

**Purpose**: Generate text and tool calls from a language model (non-interactive use cases)

**When to Use**:
- Non-interactive scenarios (automation tasks, batch processing)
- Agents that use tools
- Drafting emails, summarizing documents

**Basic Usage**:
```typescript
import { generateText } from 'ai';

const { text } = await generateText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: 'Write a vegetarian lasagna recipe for 4 people.',
  system: 'You are a professional writer. You write simple, clear, and concise content.',
});
```

**Result Object Properties**:
- `result.content`: Content generated in the last step
- `result.text`: Generated text
- `result.toolCalls`: Tool calls made in the last step
- `result.toolResults`: Results of tool calls
- `result.finishReason`: Reason the generation finished
- `result.usage`: Token usage
- `result.steps`: Details for all steps (multi-step execution)

**Callbacks**:
- `onFinish`: Called when generation completes
- `onError`: Called when error occurs

---

#### streamText

**Purpose**: Stream text and tool calls (interactive use cases)

**When to Use**:
- Interactive use cases (chatbots, real-time applications)
- Content streaming
- User-facing interfaces

**Basic Usage**:
```typescript
import { streamText } from 'ai';

const result = streamText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: 'Tell me a story',
});

// Use textStream as an async iterable
for await (const textPart of result.textStream) {
  console.log(textPart);
}
```

**Result Object Properties**:
- Same as `generateText` + streaming properties
- `result.textStream`: Both a `ReadableStream` and an `AsyncIterable`
- `result.toUIMessageStreamResponse()`: Creates UI Message stream response
- `result.toTextStreamResponse()`: Creates simple text stream response

**Full Stream Property**:
```typescript
for await (const part of result.fullStream) {
  switch (part.type) {
    case 'text-delta':
      console.log(part.text);
      break;
    case 'tool-call':
      console.log('Tool called:', part.toolName, part.args);
      break;
    case 'tool-result':
      console.log('Tool result:', part.result);
      break;
    case 'error':
      console.error('Error:', part.error);
      break;
  }
}
```

**Callbacks**:
- `onChunk`: Called for each chunk in the stream
- `onFinish`: Called when stream finishes
- `onError`: Called when error occurs
- `onAbort`: Called when stream is aborted

**Stream Transformation**:
```typescript
// Smooth streaming (reduces jitter)
const result = streamText({
  model,
  prompt,
  experimental_transform: smoothStream(),
});

// Custom transformation
const upperCaseTransform = <TOOLS extends ToolSet>() =>
  ({ stopStream }: { stopStream: () => void }) =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        controller.enqueue(
          chunk.type === 'text'
            ? { ...chunk, text: chunk.text.toUpperCase() }
            : chunk
        );
      },
    });

const result = streamText({
  model,
  prompt,
  experimental_transform: [firstTransform, secondTransform],
});
```

---

#### ToolLoopAgent

**Purpose**: Encapsulate LLM configuration, tools, and behavior into reusable components

**When to Use**:
- Need to reuse configurations across the application
- Maintain consistency throughout codebase
- Simplify API routes
- Need type safety for tools and outputs

**Basic Usage**:
```typescript
import { ToolLoopAgent } from 'ai';

const myAgent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.5",
  instructions: 'You are a helpful assistant.',
  tools: {
    // Your tools here
  },
});

// Generate text
const result = await myAgent.generate({
  prompt: 'What is the weather?',
});

// Stream text
const stream = myAgent.stream({
  prompt: 'Tell me a story',
});
```

**Configuration Options**:
- `model`: Language model to use
- `instructions`: System instructions for the agent
- `tools`: Tools available to the agent
- `stopWhen`: Loop control conditions (default: `stepCountIs(20)`)
- `toolChoice`: Control how agent uses tools
- `output`: Structured output schema

**Loop Control**:
```typescript
import { stepCountIs } from 'ai';

const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.5",
  stopWhen: stepCountIs(20), // Allow up to 20 steps
});
```

**Tool Choice**:
```typescript
const agent = new ToolLoopAgent({
  model: "anthropic/claude-sonnet-4.5",
  tools: {
    weather: weatherTool,
    cityAttractions: attractionsTool,
  },
  toolChoice: 'required', // Force tool use
  // or toolChoice: 'none' to disable tools
  // or toolChoice: 'auto' (default) to let model decide
  // or toolChoice: { type: 'tool', toolName: 'weather' } to force specific tool
});
```

**End-to-End Type Safety**:
```typescript
import { ToolLoopAgent, InferAgentUIMessage } from 'ai';

const myAgent = new ToolLoopAgent({
  // ... configuration
});

// Infer UIMessage type for UI components or persistence
export type MyAgentUIMessage = InferAgentUIMessage<typeof myAgent>;
```

---

### Testing

#### Mock Language Model

**Purpose**: Test code without calling actual LLM providers

**Usage**:
```typescript
import { generateText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

const result = await generateText({
  model: new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Hello, world!' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10 },
        outputTokens: { total: 20, text: 20 },
      },
      warnings: [],
    }),
  }),
  prompt: 'Hello, test!',
});
```

#### Simulate Readable Stream

**Purpose**: Simulate streaming for testing or demonstrations

**Usage**:
```typescript
import { simulateReadableStream } from 'ai';

const stream = simulateReadableStream({
  initialDelayInMs: 1000,
  chunkDelayInMs: 300,
  chunks: [
    `data: {"type":"text-delta","delta":"Hello"}\n\n`,
    `data: {"type":"text-delta","delta":" world!"}\n\n`,
    `data: [DONE]\n\n`,
  ],
});
```

---

### Error Handling

#### Regular Errors

```typescript
import { generateText } from 'ai';

try {
  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.5",
    prompt: 'Write a vegetarian lasagna recipe for 4 people.',
  });
} catch (error) {
  // Handle error
}
```

#### Streaming Errors

**Simple streams** (no error chunks):
```typescript
import { streamText } from 'ai';

try {
  const { textStream } = streamText({
    model: "anthropic/claude-sonnet-4.5",
    prompt: 'Write a story',
  });

  for await (const textPart of textStream) {
    process.stdout.write(textPart);
  }
} catch (error) {
  // Handle error
}
```

**Full streams** (with error support):
```typescript
import { streamText } from 'ai';

try {
  const { fullStream } = streamText({
    model: "anthropic/claude-sonnet-4.5",
    prompt: 'Write a story',
  });

  for await (const part of fullStream) {
    switch (part.type) {
      case 'error':
        console.error('Error:', part.error);
        break;
      case 'abort':
        console.log('Stream was aborted');
        break;
    }
  }
} catch (error) {
  // Handle error
}
```

#### Stream Aborts

```typescript
const { textStream } = streamText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: 'Write a story',
  onAbort: ({ steps }) => {
    // Update stored messages or perform cleanup
    console.log('Stream aborted after', steps.length, 'steps');
  },
  onFinish: ({ steps, totalUsage }) => {
    // This is called on normal completion
    console.log('Stream completed normally');
  },
});

for await (const textPart of textStream) {
  process.stdout.write(textPart);
}
```

---

## AI SDK UI

### Overview

AI SDK UI is designed to help build interactive chat, completion, and assistant applications. It provides framework-agnostic tooling for integrating AI functionalities into applications.

### Framework Support

| Framework | Chat | Completion | Structured Object |
|-----------|-------|------------|-------------------|
| React (`@ai-sdk/react`) | ✅ | ✅ | ✅ |
| Vue.js (`@ai-sdk/vue`) | ✅ | ✅ | ✅ |
| Svelte (`@ai-sdk/svelte`) | ✅ | ✅ | ✅ |
| Angular (`@ai-sdk/angular`) | ✅ | ✅ | ✅ |
| SolidJS (community) | Partial | Partial | Partial |

### Key Hooks and Functions

#### useChat

**Purpose**: Hook to interact with language models in a chat interface

**Usage in React**:
```typescript
'use client';
import { useChat } from '@ai-sdk/react';

export function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      {messages.map(message => (
        <div key={message.id}>
          {message.role}: {message.content}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

**For VS Code Extensions**:
Since VS Code extensions don't use React components directly, we need to adapt this pattern:
```typescript
// Instead of useChat hook, use streamText directly and manage state manually
import { streamText } from 'ai';

class PlaygroundManager {
  private messages: UIMessage[] = [];

  async sendMessage(userMessage: string) {
    const result = streamText({
      model: aiModel,
      messages: await convertToModelMessages(this.messages),
    });

    // Add user message
    this.messages.push({
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: userMessage }],
    });

    // Stream response
    for await (const uiMessage of readUIMessageStream({
      stream: result.toUIMessageStream(),
      originalMessages: this.messages,
    })) {
      this.messages.push(uiMessage);
      this.updateUI(uiMessage);
    }
  }
}
```

#### useCompletion

**Purpose**: Hook for completion interface (single prompt/response)

**Usage**:
```typescript
import { useCompletion } from '@ai-sdk/react';

const { completion, complete, isLoading } = useCompletion({
  api: '/api/completion',
});
```

#### useObject

**Purpose**: Hook for consuming streamed JSON objects

**Usage**:
```typescript
import { useObject } from '@ai-sdk/react';

const { object } = useObject({
  api: '/api/object',
});
```

---

### UIMessage and Streaming

#### UIMessage Type

**Purpose**: Standardized message type for UI components

**Structure**:
```typescript
interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; args: any }
    | { type: 'tool-result'; toolCallId: string; result: any }
  >;
  metadata?: {
    createdAt?: number;
    model?: string;
    totalTokens?: number;
    // Custom metadata
  };
}
```

#### convertToModelMessages

**Purpose**: Convert UI messages to model messages for AI SDK Core

**Usage**:
```typescript
import { convertToModelMessages, streamText } from 'ai';

const result = streamText({
  model: "anthropic/claude-sonnet-4.5",
  messages: await convertToModelMessages(uiMessages),
});
```

#### readUIMessageStream

**Purpose**: Transform a stream of UIMessageChunk objects into an AsyncIterableStream of UIMessage objects

**Basic Usage**:
```typescript
import { readUIMessageStream, streamText } from 'ai';

const result = streamText({
  model: "anthropic/claude-sonnet-4.5",
  prompt: 'Write a short story about a robot.',
});

for await (const uiMessage of readUIMessageStream({
  stream: result.toUIMessageStream(),
})) {
  console.log('Current message state:', uiMessage);
}
```

**Tool Calls Integration**:
```typescript
import { readUIMessageStream, streamText, tool } from 'ai';
import { z } from 'zod';

const result = streamText({
  model: "anthropic/claude-sonnet-4.5",
  tools: {
    weather: tool({
      description: 'Get weather in a location',
      inputSchema: z.object({
        location: z.string().describe('The location to get weather for'),
      }),
      execute: ({ location }) => ({
        location,
        temperature: 72 + Math.floor(Math.random() * 21) - 10,
      }),
    }),
  },
  prompt: 'What is weather in Tokyo?',
});

for await (const uiMessage of readUIMessageStream({
  stream: result.toUIMessageStream(),
})) {
  // Handle different part types
  uiMessage.parts.forEach(part => {
    switch (part.type) {
      case 'text':
        console.log('Text:', part.text);
        break;
      case 'tool-call':
        console.log('Tool called:', part.toolName, 'with args:', part.args);
        break;
      case 'tool-result':
        console.log('Tool result:', part.result);
        break;
    }
  });
}
```

**Resuming Conversations**:
```typescript
import { readUIMessageStream, streamText } from 'ai';

async function resumeConversation(lastMessage: UIMessage) {
  const result = streamText({
    model: "anthropic/claude-sonnet-4.5",
    messages: [
      { role: 'user', content: 'Continue our previous conversation.' },
    ],
  });

  // Resume from last message
  for await (const uiMessage of readUIMessageStream({
    stream: result.toUIMessageStream(),
    message: lastMessage, // Resume from this message
  })) {
    console.log('Resumed message:', uiMessage);
  }
}
```

#### createUIMessageStream

**Purpose**: Create a UI message stream to stream additional data to the client

**Usage**:
```typescript
import { createUIMessageStream } from 'ai';

const stream = createUIMessageStream();
stream.append({
  type: 'text-delta',
  delta: 'Hello',
});
```

---

### Message Metadata

**Purpose**: Attach custom information to messages at message level

**When to Use**:
- Timestamps: When messages were created or completed
- Model Information: Which AI model was used
- Token Usage: Track costs and usage limits
- User Context: User IDs, session information
- Performance Metrics: Generation time, time to first token

**Defining Metadata Types**:
```typescript
import { UIMessage } from 'ai';
import { z } from 'zod';

// Define your metadata schema
export const messageMetadataSchema = z.object({
  createdAt: z.number().optional(),
  model: z.string().optional(),
  totalTokens: z.number().optional(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

// Create a typed UIMessage
export type MyUIMessage = UIMessage<MessageMetadata>;
```

**Sending Metadata from Server**:
```typescript
import { convertToModelMessages, streamText } from 'ai';
import type { MyUIMessage } from '@/types';

export async function POST(req: Request) {
  const { messages }: { messages: MyUIMessage[] } = await req.json();

  const result = streamText({
    model: "anthropic/claude-sonnet-4.5",
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages, // Pass this in for type-safe return objects
    messageMetadata: ({ part }) => {
      // Send metadata when streaming starts
      if (part.type === 'start') {
        return {
          createdAt: Date.now(),
          model: 'your-model-id',
        };
      }

      // Send additional metadata when streaming completes
      if (part.type === 'finish') {
        return {
          totalTokens: part.totalUsage.totalTokens,
        };
      }
    },
  });
}
```

**Accessing Metadata on Client**:
```typescript
'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { MyUIMessage } from '@/types';

export default function Chat() {
  const { messages } = useChat<MyUIMessage>({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
  });

  return (
    <div>
      {messages.map(message => (
        <div key={message.id}>
          <div>
            {message.role === 'user' ? 'User: ' : 'AI: '}
            {message.metadata?.createdAt && (
              <span className="text-sm text-gray-500">
                {new Date(message.metadata.createdAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Render message content */}
          {message.parts.map((part, index) =>
            part.type === 'text' ? <div key={index}>{part.text}</div> : null,
          )}

          {/* Display additional metadata */}
          {message.metadata?.totalTokens && (
            <div className="text-xs text-gray-400">
              {message.metadata.totalTokens} tokens
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## Integration Strategy for VS Code Extensions

### Challenge: AI SDK UI is Framework-Specific

AI SDK UI provides hooks for React, Vue, Svelte, Angular, but VS Code extensions use TypeScript/JavaScript without a UI framework.

### Solution: Direct AI SDK Core Usage

Since we cannot use AI SDK UI hooks directly in VS Code extensions, we should:
1. Use AI SDK Core functions directly (`streamText`, `generateText`)
2. Manually implement state management similar to `useChat`
3. Use AI SDK UI types (`UIMessage`) for type safety
4. Implement streaming logic using `readUIMessageStream`

### Recommended Architecture

```typescript
// Instead of custom ChatMessage type, use AI SDK's UIMessage
import { UIMessage, convertToModelMessages, readUIMessageStream, streamText } from 'ai';

export interface PlaygroundMetadata {
  createdAt: number;
  modelSid: string;
  temperature: number;
  topP?: number;
  totalTokens?: number;
}

export type PlaygroundUIMessage = UIMessage<PlaygroundMetadata>;

export class PlaygroundManager {
  private messages: PlaygroundUIMessage[] = [];
  private webview: vscode.WebviewPanel;

  async sendMessage(userPrompt: string): Promise<void> {
    // 1. Add user message to history
    const userMessage: PlaygroundUIMessage = {
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: userPrompt }],
      metadata: {
        createdAt: Date.now(),
        modelSid: this.modelSid,
      },
    };

    this.messages.push(userMessage);
    this.postMessageToWebview({ type: 'message', message: userMessage });

    // 2. Stream AI response using AI SDK Core
    const result = streamText({
      model: this.aiModel,
      messages: await convertToModelMessages(this.messages),
      temperature: this.temperature,
      topP: this.topP,
      maxOutputTokens: this.maxOutputTokens,
      tools: this.getTools(), // Use AI SDK tool format
      onFinish: ({ usage, finishReason }) => {
        logger.info('Stream completed', { usage, finishReason });
      },
      onError: ({ error }) => {
        logger.error('Stream error', { error });
        this.postMessageToWebview({
          type: 'error',
          message: error.message,
        });
      },
      onAbort: ({ steps }) => {
        logger.info('Stream aborted', { stepCount: steps.length });
      },
    });

    // 3. Process stream using AI SDK UI utilities
    for await (const aiMessage of readUIMessageStream({
      stream: result.toUIMessageStream(),
      originalMessages: this.messages,
    })) {
      // 4. Add AI response with metadata
      this.messages.push(aiMessage);
      this.postMessageToWebview({ type: 'message', message: aiMessage });
    }
  }
}
```

---

## Architecture Design for Playground

### Current Architecture (Before)

```
User Input
    ↓
Playground (Custom ChatMessage[])
    ↓
createChatMessages() → Convert to VS Code LanguageModelChatMessage[]
    ↓
chatModel.sendRequest() → VS Code LanguageModel API
    ↓
Response Stream (vscode.ChatResponseStream)
    ↓
Process Markdown & Append to History (Custom ChatMessage[])
```

**Problems**:
- Uses custom `ChatMessage` type
- Uses VS Code `LanguageModelChatMessage` API
- Custom conversion logic
- Not aligned with AI SDK patterns

### New Architecture (After)

```
User Input
    ↓
Playground (AI SDK UIMessage[])
    ↓
streamText() → AI SDK Core
    ↓
Provider (OpenAI, Anthropic, etc.)
    ↓
Full Stream (Text, Tool Calls, Reasoning, etc.)
    ↓
readUIMessageStream() → Convert to UIMessage
    ↓
Update UI (Webview) & Append to History (UIMessage[])
```

**Benefits**:
- Uses AI SDK `UIMessage` type
- Direct AI SDK Core usage
- No custom conversion logic
- Aligned with AI SDK patterns
- Better tool calling support
- Built-in streaming support

### Component Design

#### 1. Message Store

```typescript
import { UIMessage } from 'ai';

export interface PlaygroundMetadata {
  createdAt: number;
  modelSid: string;
  temperature: number;
  topP?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
}

export type PlaygroundUIMessage = UIMessage<PlaygroundMetadata>;

export interface MessageStore {
  getMessages(): PlaygroundUIMessage[];
  addMessage(message: PlaygroundUIMessage): void;
  clearMessages(): void;
  updateMessage(id: string, updates: Partial<PlaygroundUIMessage>): void;
}

export class InMemoryMessageStore implements MessageStore {
  private messages: Map<string, PlaygroundUIMessage> = new Map();
  private messageOrder: string[] = [];

  getMessages(): PlaygroundUIMessage[] {
    return this.messageOrder
      .map(id => this.messages.get(id))
      .filter((m): m is PlaygroundUIMessage => m !== undefined);
  }

  addMessage(message: PlaygroundUIMessage): void {
    this.messages.set(message.id, message);
    this.messageOrder.push(message.id);
  }

  clearMessages(): void {
    this.messages.clear();
    this.messageOrder = [];
  }

  updateMessage(id: string, updates: Partial<PlaygroundUIMessage>): void {
    const existing = this.messages.get(id);
    if (existing) {
      this.messages.set(id, { ...existing, ...updates });
    }
  }
}
```

#### 2. Playground Service

```typescript
import { streamText, convertToModelMessages, readUIMessageStream, tool } from 'ai';
import { LanguageModel } from 'ai';

export class PlaygroundService {
  constructor(
    private messageStore: MessageStore,
    private model: LanguageModel,
    private tools: Record<string, any> = {},
  ) {}

  async sendMessage(
    userPrompt: string,
    options: {
      temperature?: number;
      topP?: number;
      maxOutputTokens?: number;
    } = {}
  ): Promise<void> {
    // 1. Add user message
    const userMessage: PlaygroundUIMessage = {
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: userPrompt }],
      metadata: {
        createdAt: Date.now(),
        temperature: options.temperature ?? 0.7,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
      },
    };

    this.messageStore.addMessage(userMessage);
    this.emit('message', userMessage);

    // 2. Convert to model messages
    const history = this.messageStore.getMessages();
    const modelMessages = await convertToModelMessages(history);

    // 3. Stream response
    const result = streamText({
      model: this.model,
      messages: modelMessages,
      temperature: options.temperature,
      topP: options.topP,
      maxOutputTokens: options.maxOutputTokens,
      tools: this.tools,
      onFinish: ({ usage, finishReason }) => {
        // Update last message with metadata
        const lastMessage = history[history.length - 1];
        if (lastMessage) {
          this.messageStore.updateMessage(lastMessage.id, {
            metadata: {
              ...lastMessage.metadata,
              totalTokens: usage.totalTokens,
              finishReason: finishReason,
            },
          });
          this.emit('messageUpdated', lastMessage);
        }
      },
    });

    // 4. Process stream
    let currentAssistantMessage: PlaygroundUIMessage | null = null;

    for await (const aiMessage of readUIMessageStream({
      stream: result.toUIMessageStream(),
      originalMessages: history,
    })) {
      if (aiMessage.role === 'assistant') {
        if (!currentAssistantMessage) {
          currentAssistantMessage = aiMessage;
          this.messageStore.addMessage(aiMessage);
        } else {
          // Update existing message (streaming update)
          currentAssistantMessage.content = aiMessage.content;
        }
        this.emit('message', aiMessage);
      }
    }
  }

  private emit(event: string, data: any) {
    // Event emission logic
  }
}
```

#### 3. Webview Adapter

```typescript
import * as vscode from 'vscode';
import type { PlaygroundUIMessage } from './types';

export class PlaygroundWebviewAdapter {
  constructor(private webview: vscode.WebviewPanel) {}

  renderMessage(message: PlaygroundUIMessage): void {
    this.webview.webview.postMessage({
      type: 'message',
      message: this.formatMessageForWebview(message),
    });
  }

  private formatMessageForWebview(message: PlaygroundUIMessage): any {
    return {
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata,
    };
  }

  onMessage(listener: (data: any) => void): vscode.Disposable {
    return this.webview.webview.onDidReceiveMessage(listener);
  }
}
```

#### 4. Frontend (Webview)

```typescript
// In playground.html (JavaScript)
let messages = [];

window.addEventListener('message', (event) => {
  const { type, message } = event.data;

  if (type === 'message') {
    messages.push(message);
    renderMessage(message);
  }
});

function renderMessage(message) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `message ${message.role}`;

  // Render parts (text, tool-calls, etc.)
  message.parts.forEach(part => {
    if (part.type === 'text') {
      div.innerHTML += `<div class="text">${part.text}</div>`;
    } else if (part.type === 'tool-call') {
      div.innerHTML += `<div class="tool-call">
        <strong>Tool:</strong> ${part.toolName}<br>
        <strong>Args:</strong> ${JSON.stringify(part.args)}
      </div>`;
    } else if (part.type === 'tool-result') {
      div.innerHTML += `<div class="tool-result">
        <strong>Result:</strong> ${JSON.stringify(part.result)}
      </div>`;
    }
  });

  // Render metadata
  if (message.metadata) {
    div.innerHTML += `<div class="metadata">
      <small>${new Date(message.metadata.createdAt).toLocaleTimeString()}</small>
      ${message.metadata.totalTokens ? `<small>${message.metadata.totalTokens} tokens</small>` : ''}
    </div>`;
  }

  container.appendChild(div);
}
```

---

## Migration Plan

### Phase 1: Update Type System

1. **Remove custom `ChatMessage` type**
   - Replace with `UIMessage<PlaygroundMetadata>`
   - Update all usages

2. **Add AI SDK dependencies**
   ```bash
   npm install ai @ai-sdk/react
   ```

3. **Create type definitions**
   ```typescript
   // src/playground/types.ts
   import { UIMessage } from 'ai';

   export interface PlaygroundMetadata {
     createdAt: number;
     modelSid: string;
     // ... other metadata
   }

   export type PlaygroundUIMessage = UIMessage<PlaygroundMetadata>;
   ```

### Phase 2: Implement AI SDK Core Integration

1. **Replace VS Code LanguageModel API**
   - Remove `chatModel.sendRequest()`
   - Add AI SDK `streamText()`

2. **Implement message conversion**
   ```typescript
   import { convertToModelMessages } from 'ai';

   const modelMessages = await convertToModelMessages(uiMessages);
   ```

3. **Implement stream processing**
   ```typescript
   import { readUIMessageStream } from 'ai';

   for await (const uiMessage of readUIMessageStream({
     stream: result.toUIMessageStream(),
     originalMessages: messages,
   })) {
     // Process message
   }
   ```

### Phase 3: Update Webview

1. **Remove custom markdown rendering**
   - AI SDK streams plain text
   - Let frontend handle markdown

2. **Update message rendering**
   - Render `UIMessage.parts` array
   - Support text, tool-calls, tool-results

3. **Add metadata display**
   - Show timestamps, token usage, etc.

### Phase 4: Testing

1. **Unit tests with mocks**
   ```typescript
   import { MockLanguageModelV3 } from 'ai/test';

   const result = streamText({
     model: new MockLanguageModelV3({ ... }),
     prompt: 'Test',
   });
   ```

2. **Integration tests**
   - Test streaming
   - Test tool calling
   - Test error handling

### Phase 5: Cleanup

1. **Remove unused code**
   - `createChatMessages()` method
   - Custom `ChatMessage` type
   - VS Code API conversion logic

2. **Update documentation**
   - Update PROJECT_DESIGN.md
   - Add migration guide
   - Update README

---

## Middleware System

Addi implements a middleware system for processing AI model messages and responses. This is particularly useful for handling unexpected model behaviors like hallucinated tool calls.

### Middleware Architecture

```typescript
interface LLMCallContext {
  provider: Provider;
  modelId: string;
  model: Model;
}

interface MiddlewareResult {
  messages: ModelMessage[];
}

interface ResponseProcessor {
  processResponsePart(
    part: TextDeltaPart | ToolCallPart | ToolResultPart,
    context: LLMCallContext
  ): ProcessingResult;
}
```

### ToolCallCompatibilityMiddleware

**Purpose**: Detect and handle hallucinated tool calls in model output

**Features**:
- Pattern-based content filtering
- Configurable retry/stop strategies
- Streaming response processing
- Per-model configuration

**Usage**:
```typescript
const middleware = new ToolCallCompatibilityMiddleware();

// Process messages before sending to model
const result = await middleware.processMessages(messages, context);

// Process streaming response
const processedPart = middleware.processResponsePart(delta, context);
if (processedPart._addiAction === 'retry') {
  // Trigger retry logic
}
```

### ScrubSettings Integration

**Model Configuration**:
```typescript
interface ModelCapabilities {
  imageInput?: boolean;
  toolCalling?: boolean | number;
  scrubSettings?: {
    enabled: boolean;
    patterns: string[];
    strategy: 'stop' | 'retry';
    toolNameGroup?: number;
  };
}
```

**Example Configuration**:
```typescript
const model = {
  id: 'gpt-4',
  capabilities: {
    scrubSettings: {
      enabled: true,
      patterns: [
        '<\\s*tool_call[^>]*>.*?<\\s*/\\s*tool_call\\s*>',
        'DEBUG: .*',
      ],
      strategy: 'retry',
    },
  },
};
```

---

## Key Benefits

### 1. Type Safety
- Use AI SDK's `UIMessage` type
- Full type inference with `InferAgentUIMessage`
- Consistent with AI SDK ecosystem

### 2. Reduced Complexity
- No custom conversion logic
- Direct AI SDK Core usage
- Aligned with AI SDK patterns

### 3. Better Tool Calling
- Built-in tool calling support
- Automatic tool execution
- Multi-step tool calling

### 4. Improved Streaming
- Native streaming support
- Stream transformations
- Error handling built-in

### 5. Better Testing
- Mock language models
- Stream simulation
- Deterministic testing

### 6. Metadata Support
- Message-level metadata
- Timestamps, token usage, etc.
- Custom metadata types

---

## References

- [AI SDK Core Overview](https://ai-sdk.dev/docs/ai-sdk-core/overview)
- [Generating Text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
- [Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [Error Handling](https://ai-sdk.dev/docs/ai-sdk-core/error-handling)
- [Testing](https://ai-sdk.dev/docs/ai-sdk-core/testing)
- [Building Agents](https://ai-sdk.dev/docs/agents/building-agents)
- [AI SDK UI Overview](https://ai-sdk.dev/docs/ai-sdk-ui/overview)
- [Chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)
- [Reading UIMessage Streams](https://ai-sdk.dev/docs/ai-sdk-ui/reading-ui-message-streams)
- [Message Metadata](https://ai-sdk.dev/docs/ai-sdk-ui/message-metadata)
- [AI SDK Core Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core)
- [AI SDK UI Reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui)
