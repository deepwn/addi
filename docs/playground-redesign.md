# Playground Architecture Redesign

## Overview

This document describes the redesign of the Addi Playground to use AI SDK Core and AI SDK UI completely, eliminating custom intermediate layers and making the implementation fully compliant with AI SDK technical specifications.

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [Problems with Current Architecture](#problems-with-current-architecture)
3. [New Architecture Design](#new-architecture-design)
4. [Component Design](#component-design)
5. [Data Flow](#data-flow)
6. [VS Code API Compatibility](#vs-code-api-compatibility)
7. [Migration Strategy](#migration-strategy)
8. [Benefits](#benefits)

---

## Current Architecture Analysis

### Current Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Extension                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                                                │
│  │   Webview    │                                                │
│  │  (Frontend)  │                                                │
│  └──────┬───────┘                                                │
│         │                                                        │
│         │ sendMessage()                                          │
│         ↓                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         PlaygroundManager (playground.ts)                 │  │
│  │                                                           │  │
│  │  - messages: ChatMessage[] (Custom Type)                 │  │
│  │  - sendMessage()                                          │  │
│  │  - createChatMessages() → Convert to VS Code messages    │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                           │
│                      │ chatModel.sendRequest()                   │
│                      ↓                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   VS Code LanguageModel API (vscode.lm)                  │  │
│  │                                                           │  │
│  │  - vscode.LanguageModelChatMessage[]                      │  │
│  │  - LanguageModelChatSelector                             │  │
│  │  - ChatResponseStream                                    │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                           │
│                      │ Response Stream                           │
│                      ↓                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │       AddiChatProvider (VS Code API Provider)             │  │
│  │                                                           │  │
│  │  - provideResponse()                                      │  │
│  │  - provideResponse2()                                    │  │
│  │  - LLMService (Uses AI SDK internally)                    │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                           │
│                      │ Stream response                          │
│                      ↓                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         LLMService (llmService.ts)                       │  │
│  │                                                           │  │
│  │  - streamText() (AI SDK)                                 │  │
│  │  - generateText() (AI SDK)                               │  │
│  │  - MessageConverter (VS Code ↔ AI SDK)                   │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                           │
│                      │ ModelMessage[] (AI SDK)                  │
│                      ↓                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │        AI SDK Core (streamText/generateText)             │  │
│  │                                                           │  │
│  │  - OpenAI Provider                                        │  │
│  │  - Anthropic Provider                                     │  │
│  │  - Other AI Providers                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Current Type System

```typescript
// src/playground/playground.ts (Custom Type)
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  model?: string;
}

// src/presentation/extension.ts (VS Code Type)
import * as vscode from 'vscode';
// vscode.LanguageModelChatMessage

// src/core/llm/messageConverter.ts (AI SDK Type)
import type { CoreMessage } from 'ai';
// AI SDK CoreMessage (ModelMessage)
```

### Current Message Conversion Chain

```
ChatMessage[] (Playground)
    ↓ createChatMessages()
LanguageModelChatMessage[] (VS Code API)
    ↓ provideResponse() → LLMService
MessageConverter.convertToCoreMessages()
    ↓
ModelMessage[] (AI SDK)
    ↓ streamText()
AI Provider (OpenAI, Anthropic, etc.)
```

---

## Problems with Current Architecture

### 1. Custom Type Not Aligned with AI SDK

**Problem**: Uses custom `ChatMessage` type with simple `content: string`

```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string; // ❌ Too simple, doesn't support tool calls
  timestamp?: number;
  model?: string;
}
```

**AI SDK Standard**: Uses `UIMessage` with rich content:

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
    createdAt: number;
    model?: string;
    totalTokens?: number;
    // ... other metadata
  };
}
```

**Impact**:

- Cannot represent tool calls and results
- No support for complex content types
- Not compatible with AI SDK ecosystem
- Limited metadata support

### 2. Multiple Conversion Layers

**Problem**: Three type conversions before reaching AI SDK

```
ChatMessage[]
    ↓ createChatMessages()
LanguageModelChatMessage[]
    ↓ MessageConverter.convertToCoreMessages()
ModelMessage[]
    ↓ streamText()
AI Provider
```

**Impact**:

- Performance overhead from multiple conversions
- Potential for bugs in conversion logic
- Maintenance burden (need to update conversion logic when types change)
- Type safety gaps

### 3. VS Code API Dependency

**Problem**: Playground depends on VS Code `LanguageModelChatMessage` API

**Impact**:

- Tightly coupled to VS Code API
- Cannot run Playground outside VS Code (testing, web, etc.)
- VS Code API is limited (no built-in tool calling support)
- Not aligned with AI SDK patterns

### 4. No Direct Tool Calling Support

**Problem**: Tool calling is not supported in current Playground

**Impact**:

- Cannot use tools in Playground
- Limited testing capabilities
- Cannot demonstrate Addi's tool features

### 5. Limited Streaming Support

**Problem**: Custom stream processing, not using AI SDK streaming utilities

**Impact**:

- Complex stream handling code
- No built-in error handling for streams
- No stream transformations
- Hard to maintain

---

## New Architecture Design

### New Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Extension                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                                                │
│  │   Webview    │                                                │
│  │  (Frontend)  │                                                │
│  └──────┬───────┘                                                │
│         │                                                        │
│         │ sendMessage()                                           │
│         ↓                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         PlaygroundService (NEW)                          │  │
│  │                                                           │  │
│  │  - messageStore: MessageStore                            │  │
│  │  - model: LanguageModel (AI SDK)                         │  │
│  │  - tools: Record<string, Tool> (AI SDK)                  │  │
│  │                                                           │  │
│  │  Methods:                                                │  │
│  │  - sendMessage(prompt, options)                          │  │
│  │  - streamText(messages, options)                          │  │
│  │                                                           │  │
│  │  Used:                                                    │  │
│  │  - streamText() (AI SDK Core)                            │  │
│  │  - convertToModelMessages() (AI SDK UI)                   │  │
│  │  - readUIMessageStream() (AI SDK UI)                     │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                           │
│                      │ ModelMessage[]                            │
│                      ↓                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │        AI SDK Core (streamText/generateText)             │  │
│  │                                                           │  │
│  │  - OpenAI Provider                                        │  │
│  │  - Anthropic Provider                                     │  │
│  │  - Other AI Providers                                     │  │
│  │                                                           │  │
│  │  Returns:                                                │  │
│  │  - textStream (AsyncIterable<string>)                    │  │
│  │  - fullStream (AsyncIterable<TextStreamPart>)            │  │
│  │  - toUIMessageStream()                                   │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                           │
│                      │ UIMessageChunk stream                    │
│                      ↓                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │     readUIMessageStream() (AI SDK UI)                     │  │
│  │                                                           │  │
│  │  Transforms UIMessageChunk stream to:                    │  │
│  │  - UIMessage (complete messages)                          │  │
│  │  - Preserves tool calls and results                      │  │
│  │  - Adds metadata                                         │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                           │
│                      │ UIMessage (PlaygroundUIMessage)          │
│                      ↓                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         MessageStore (NEW)                               │  │
│  │                                                           │  │
│  │  - messages: PlaygroundUIMessage[]                     │  │
│  │  - getMessages()                                         │  │
│  │  - addMessage(message)                                   │  │
│  │  - clearMessages()                                       │  │
│  │  - updateMessage(id, updates)                           │  │
│  └───────────────────┬──────────────────────────────────────┘  │
│                      │                                           │
│                      │ Update UI                                  │
│                      ↓                                           │
│  ┌──────────────┐                                                │
│  │   Webview    │                                                │
│  │  (Frontend)  │                                                │
│  └──────────────┘                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### New Type System

```typescript
// src/playground/types.ts
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
  // Custom metadata can be added here
}

export type PlaygroundUIMessage = UIMessage<PlaygroundMetadata>;
```

### Eliminated Conversion Chain

**Before**:

```
ChatMessage[]
    ↓ createChatMessages()
LanguageModelChatMessage[]
    ↓ MessageConverter.convertToCoreMessages()
ModelMessage[]
    ↓ streamText()
AI Provider
```

**After**:

```
PlaygroundUIMessage[]
    ↓ convertToModelMessages() (AI SDK UI)
ModelMessage[]
    ↓ streamText() (AI SDK Core)
AI Provider
```

**Improvements**:

- Removed VS Code API dependency
- Eliminated custom ChatMessage type
- Single conversion layer (AI SDK UI)
- Type-safe throughout

---

## Component Design

### 1. MessageStore

**Purpose**: Manage message history with persistence support

**Interface**:

```typescript
import type { PlaygroundUIMessage } from './types';

export interface MessageStore {
  getMessages(): PlaygroundUIMessage[];
  addMessage(message: PlaygroundUIMessage): void;
  clearMessages(): void;
  updateMessage(id: string, updates: Partial<PlaygroundUIMessage>): void;
  on(event: 'add' | 'update' | 'clear', listener: (data: any) => void): void;
  off(event: string, listener: (data: any) => void): void;
}
```

**Implementation**:

```typescript
import type { PlaygroundUIMessage } from './types';

export class InMemoryMessageStore implements MessageStore {
  private messages: Map<string, PlaygroundUIMessage> = new Map();
  private messageOrder: string[] = [];
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  getMessages(): PlaygroundUIMessage[] {
    return this.messageOrder
      .map((id) => this.messages.get(id))
      .filter((m): m is PlaygroundUIMessage => m !== undefined);
  }

  addMessage(message: PlaygroundUIMessage): void {
    this.messages.set(message.id, message);
    this.messageOrder.push(message.id);
    this.emit('add', message);
  }

  clearMessages(): void {
    this.messages.clear();
    this.messageOrder = [];
    this.emit('clear', null);
  }

  updateMessage(id: string, updates: Partial<PlaygroundUIMessage>): void {
    const existing = this.messages.get(id);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.messages.set(id, updated);
      this.emit('update', updated);
    }
  }

  private emit(event: string, data: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => listener(data));
    }
  }

  on(event: string, listener: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: (data: any) => void): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }
}
```

### 2. PlaygroundService

**Purpose**: Core service handling AI interactions using AI SDK

**Interface**:

```typescript
import type { LanguageModel } from 'ai';
import type { Tool } from 'ai';
import type { PlaygroundUIMessage } from './types';
import type { MessageStore } from './MessageStore';

export interface PlaygroundOptions {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  tools?: Record<string, Tool>;
}

export interface PlaygroundService {
  sendMessage(prompt: string, options?: PlaygroundOptions): Promise<void>;
  generateResponse(
    messages: PlaygroundUIMessage[],
    options?: PlaygroundOptions
  ): Promise<PlaygroundUIMessage>;
  clearHistory(): void;
  getHistory(): PlaygroundUIMessage[];
}
```

**Implementation**:

```typescript
import { streamText, convertToModelMessages, readUIMessageStream } from 'ai';
import type { LanguageModel } from 'ai';
import type { Tool } from 'ai';
import type { PlaygroundUIMessage, PlaygroundMetadata } from './types';
import type { MessageStore } from './MessageStore';
import { generateId } from 'ai';

export class PlaygroundService implements PlaygroundService {
  constructor(
    private messageStore: MessageStore,
    private model: LanguageModel,
    private defaultTools: Record<string, Tool> = {}
  ) {}

  async sendMessage(prompt: string, options: PlaygroundOptions = {}): Promise<void> {
    // 1. Add user message
    const userMessage: PlaygroundUIMessage = {
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      metadata: {
        createdAt: Date.now(),
        modelSid: this.model.modelId || 'unknown',
        temperature: options.temperature ?? 0.7,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
      },
    };

    this.messageStore.addMessage(userMessage);

    // 2. Convert to model messages
    const history = this.messageStore.getMessages();
    const modelMessages = await convertToModelMessages(history);

    // 3. Stream response
    const tools = { ...this.defaultTools, ...options.tools };
    const result = streamText({
      model: this.model,
      messages: modelMessages,
      temperature: options.temperature,
      topP: options.topP,
      maxOutputTokens: options.maxOutputTokens,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      onFinish: ({ usage, finishReason }) => {
        // Update last message with metadata
        const lastMessage = this.getHistory().slice(-1)[0];
        if (lastMessage) {
          this.messageStore.updateMessage(lastMessage.id, {
            metadata: {
              ...lastMessage.metadata,
              totalTokens: usage.totalTokens,
              finishReason: finishReason,
            },
          });
        }
      },
      onError: ({ error }) => {
        console.error('Stream error:', error);
        // Add error message
        const errorMessage: PlaygroundUIMessage = {
          id: generateId(),
          role: 'assistant',
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          metadata: {
            createdAt: Date.now(),
            modelSid: this.model.modelId || 'unknown',
            temperature: options.temperature ?? 0.7,
          },
        };
        this.messageStore.addMessage(errorMessage);
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
          // First chunk of assistant message
          currentAssistantMessage = aiMessage;
          currentAssistantMessage.metadata = {
            createdAt: Date.now(),
            modelSid: this.model.modelId || 'unknown',
            temperature: options.temperature ?? 0.7,
          };
          this.messageStore.addMessage(currentAssistantMessage);
        } else {
          // Update existing message (streaming update)
          currentAssistantMessage.content = aiMessage.content;
          if (aiMessage.parts) {
            // Update parts for real-time streaming
            currentAssistantMessage.parts = aiMessage.parts;
          }
          this.messageStore.updateMessage(currentAssistantMessage.id, {
            content: aiMessage.content,
            parts: aiMessage.parts,
          });
        }
      }
    }
  }

  async generateResponse(
    messages: PlaygroundUIMessage[],
    options: PlaygroundOptions = {}
  ): Promise<PlaygroundUIMessage> {
    // For non-streaming generation
    const modelMessages = await convertToModelMessages(messages);
    const tools = { ...this.defaultTools, ...options.tools };

    const result = await streamText({
      model: this.model,
      messages: modelMessages,
      temperature: options.temperature,
      topP: options.topP,
      maxOutputTokens: options.maxOutputTokens,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
    });

    // Collect full response
    const assistantMessage: PlaygroundUIMessage = {
      id: generateId(),
      role: 'assistant',
      content: [],
      metadata: {
        createdAt: Date.now(),
        modelSid: this.model.modelId || 'unknown',
        temperature: options.temperature ?? 0.7,
      },
    };

    for await (const aiMessage of readUIMessageStream({
      stream: result.toUIMessageStream(),
      originalMessages: messages,
    })) {
      if (aiMessage.role === 'assistant') {
        assistantMessage.content = aiMessage.content;
        assistantMessage.parts = aiMessage.parts;
      }
    }

    return assistantMessage;
  }

  clearHistory(): void {
    this.messageStore.clearMessages();
  }

  getHistory(): PlaygroundUIMessage[] {
    return this.messageStore.getMessages();
  }
}
```

### 3. PlaygroundController

**Purpose**: Connect VS Code webview with PlaygroundService

**Implementation**:

```typescript
import * as vscode from 'vscode';
import type { MessageStore } from './MessageStore';
import type { PlaygroundService } from './PlaygroundService';
import type { PlaygroundUIMessage } from './types';

export class PlaygroundController {
  private webviewPanel: vscode.WebviewPanel | undefined;

  constructor(
    private messageStore: MessageStore,
    private service: PlaygroundService,
    private context: vscode.ExtensionContext
  ) {
    // Listen to message store changes and update webview
    this.messageStore.on('add', (message: PlaygroundUIMessage) => {
      this.postMessageToWebview({
        type: 'message',
        message,
      });
    });

    this.messageStore.on('update', (message: PlaygroundUIMessage) => {
      this.postMessageToWebview({
        type: 'messageUpdate',
        message,
      });
    });
  }

  async showPlayground(): Promise<void> {
    if (this.webviewPanel) {
      this.webviewPanel.reveal();
      return;
    }

    this.webviewPanel = vscode.window.createWebviewPanel(
      'addi.playground',
      'Addi Playground',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.webviewPanel.webview.html = this.getWebviewContent();

    this.webviewPanel.webview.onDidReceiveMessage(
      async (data) => {
        switch (data.type) {
          case 'sendMessage':
            await this.service.sendMessage(data.prompt, data.options);
            break;
          case 'clearHistory':
            this.service.clearHistory();
            this.postMessageToWebview({ type: 'clearHistory' });
            break;
          case 'getHistory':
            const history = this.service.getHistory();
            this.postMessageToWebview({ type: 'history', messages: history });
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    this.webviewPanel.onDidDispose(
      () => {
        this.webviewPanel = undefined;
      },
      undefined,
      this.context.subscriptions
    );
  }

  private postMessageToWebview(data: any): void {
    if (this.webviewPanel) {
      this.webviewPanel.webview.postMessage(data);
    }
  }

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Addi Playground</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .messages {
      max-height: 70vh;
      overflow-y: auto;
      margin-bottom: 20px;
    }
    .message {
      margin-bottom: 15px;
      padding: 10px;
      border-radius: 5px;
      border-left: 3px solid;
    }
    .message.user {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border-left-color: var(--vscode-testing-iconPassed);
    }
    .message.assistant {
      background-color: var(--vscode-textBlockQuote-background);
      border-left-color: var(--vscode-testing-iconQueued);
    }
    .message .metadata {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-top: 5px;
    }
    .message .tool-call,
    .message .tool-result {
      background-color: var(--vscode-editor-selectionBackground);
      padding: 8px;
      margin-top: 5px;
      border-radius: 3px;
    }
    .input-area {
      display: flex;
      gap: 10px;
    }
    #prompt {
      flex: 1;
      padding: 10px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
    }
    button {
      padding: 10px 20px;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div id="messages" class="messages"></div>
  <div class="input-area">
    <input type="text" id="prompt" placeholder="Enter your message..." />
    <button id="send">Send</button>
    <button id="clear">Clear</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesDiv = document.getElementById('messages');
    const promptInput = document.getElementById('prompt');
    const sendButton = document.getElementById('send');
    const clearButton = document.getElementById('clear');

    // Request initial history
    vscode.postMessage({ type: 'getHistory' });

    // Listen for messages from extension
    window.addEventListener('message', (event) => {
      const data = event.data;

      if (data.type === 'message' || data.type === 'messageUpdate') {
        renderMessage(data.message);
      } else if (data.type === 'history') {
        data.messages.forEach(msg => renderMessage(msg));
      } else if (data.type === 'clearHistory') {
        messagesDiv.innerHTML = '';
      }
    });

    function renderMessage(message) {
      // Check if message already exists
      const existing = document.getElementById(message.id);
      if (existing) {
        // Update existing message
        existing.innerHTML = getMessageContent(message);
        return;
      }

      const div = document.createElement('div');
      div.id = message.id;
      div.className = 'message ' + message.role;
      div.innerHTML = getMessageContent(message);
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function getMessageContent(message) {
      let html = '';

      // Render parts
      if (message.parts) {
        message.parts.forEach(part => {
          if (part.type === 'text') {
            html += '<div>' + part.text + '</div>';
          } else if (part.type === 'tool-call') {
            html += '<div class="tool-call"><strong>Tool:</strong> ' + part.toolName + '<br><strong>Args:</strong> ' + JSON.stringify(part.args) + '</div>';
          } else if (part.type === 'tool-result') {
            html += '<div class="tool-result"><strong>Result:</strong> ' + JSON.stringify(part.result) + '</div>';
          }
        });
      } else if (message.content) {
        // Fallback to content array
        message.content.forEach(item => {
          if (item.type === 'text') {
            html += '<div>' + item.text + '</div>';
          }
        });
      }

      // Render metadata
      if (message.metadata) {
        html += '<div class="metadata">';
        html += new Date(message.metadata.createdAt).toLocaleTimeString();
        if (message.metadata.totalTokens) {
          html += ' · ' + message.metadata.totalTokens + ' tokens';
        }
        if (message.metadata.finishReason) {
          html += ' · ' + message.metadata.finishReason;
        }
        html += '</div>';
      }

      return html;
    }

    sendButton.addEventListener('click', () => {
      const prompt = promptInput.value.trim();
      if (prompt) {
        vscode.postMessage({ type: 'sendMessage', prompt: prompt });
        promptInput.value = '';
      }
    });

    promptInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendButton.click();
      }
    });

    clearButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearHistory' });
    });
  </script>
</body>
</html>`;
  }
}
```

### 4. AI Model Provider Factory

**Purpose**: Create AI SDK LanguageModel instances from provider configuration

**Implementation**:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ModelConfiguration } from '../types';

export class ModelProviderFactory {
  static createModel(config: ModelConfiguration): LanguageModel {
    switch (config.provider) {
      case 'openai':
        const openai = createOpenAI({
          apiKey: config.apiKey,
        });
        return openai(config.modelSid);

      case 'anthropic':
        const anthropic = createAnthropic({
          apiKey: config.apiKey,
        });
        return anthropic(config.modelSid);

      case 'custom':
      case 'addi':
        // For custom providers using OpenAI-compatible API
        const custom = createOpenAICompatible({
          name: config.provider,
          apiKey: config.apiKey,
          baseURL: config.baseUrl || 'http://localhost:11434/v1',
        });
        return custom(config.modelSid);

      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }
  }
}
```

---

## Data Flow

### 1. User Sends Message

```
User types in webview
    ↓
Webview posts message: { type: 'sendMessage', prompt: '...' }
    ↓
PlaygroundController.onDidReceiveMessage()
    ↓
PlaygroundService.sendMessage(prompt, options)
    ↓
Create user message: UIMessage with metadata
    ↓
MessageStore.addMessage(userMessage)
    ↓
MessageStore emits 'add' event
    ↓
PlaygroundController posts message to webview
    ↓
Webview renders user message
```

### 2. AI Streams Response

```
PlaygroundService.sendMessage()
    ↓
convertToModelMessages(history)
    ↓
streamText({ model, messages, tools, ... })
    ↓
AI Provider returns stream
    ↓
readUIMessageStream({ stream, originalMessages })
    ↓
Loop: for await (uiMessage of stream)
    ↓
Create assistant message: UIMessage
    ↓
MessageStore.addMessage(assistantMessage)
    ↓
MessageStore emits 'add' event
    ↓
PlaygroundController posts message to webview
    ↓
Webview renders assistant message (streaming)
    ↓
Next chunk of stream
    ↓
MessageStore.updateMessage(id, { content: newContent })
    ↓
MessageStore emits 'update' event
    ↓
Webview updates existing message
    ↓
Repeat until stream ends
    ↓
onFinish callback: update metadata (tokens, finishReason)
    ↓
MessageStore.updateMessage(id, { metadata: {...} })
    ↓
Webview displays final metadata
```

### 3. Tool Calling Flow

```
User: "What's the weather in Tokyo?"
    ↓
AI model calls tool: weatherTool({ location: 'Tokyo' })
    ↓
readUIMessageStream emits UIMessage with tool-call part
    ↓
Webview renders: "Tool called: weather, Args: { location: 'Tokyo' }"
    ↓
PlaygroundService executes tool
    ↓
Tool returns result: { location: 'Tokyo', temperature: 25 }
    ↓
AI SDK automatically continues with tool result
    ↓
readUIMessageStream emits UIMessage with tool-result part
    ↓
Webview renders: "Tool result: { ... }"
    ↓
AI model generates final response with tool result context
    ↓
readUIMessageStream emits final UIMessage with text part
    ↓
Webview renders: "The weather in Tokyo is 25°C."
```

---

## VS Code API Compatibility

### Challenge

The new Playground uses AI SDK directly, bypassing VS Code's `LanguageModelChatMessage` API. How do we maintain compatibility with VS Code's model selection UI and existing functionality?

### Solution

We maintain two separate integration paths:

#### Path 1: Playground (AI SDK Direct)

```
Playground → AI SDK → AI Providers (No VS Code API)
```

**Used for**:

- Playground webview
- Testing and development
- Full tool calling support
- Advanced features

#### Path 2: Copilot Integration (VS Code API)

```
VS Code Chat API → AddiChatProvider → LLMService → AI SDK → AI Providers
```

**Used for**:

- VS Code Chat integration
- Inline code actions
- Users using VS Code's built-in AI features

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌──────────────────┐                     │
│  │   Playground    │    │  VS Code Chat    │                     │
│  │   (Webview)     │    │     (Native)     │                     │
│  └────────┬────────┘    └────────┬─────────┘                     │
│           │                      │                               │
│           │                      │                               │
│           ↓                      ↓                               │
│  ┌─────────────────┐    ┌──────────────────┐                     │
│  │ PlaygroundService│    │AddiChatProvider │                     │
│  │ (Uses AI SDK   │    │ (Uses VS Code   │                     │
│  │  Directly)      │    │  API + AI SDK)  │                     │
│  └────────┬────────┘    └────────┬─────────┘                     │
│           │                      │                               │
│           │                      │                               │
│           ↓                      ↓                               │
│  ┌──────────────────────────────────────────────────┐            │
│  │              AI SDK Core                          │            │
│  │                                                     │            │
│  │  streamText()                                     │            │
│  │  generateText()                                   │            │
│  │  createOpenAICompatible()                         │            │
│  │  createAnthropic()                                │            │
│  └──────────────────┬───────────────────────────────┘            │
│                     │                                              │
│                     ↓                                              │
│  ┌──────────────────────────────────────────────────┐            │
│  │              AI Providers                        │            │
│  │                                                     │            │
│  │  - OpenAI                                         │            │
│  │  - Anthropic                                      │            │
│  │  - Custom (Ollama, LocalAI, etc.)                │            │
│  └──────────────────────────────────────────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Benefits of This Approach

1. **Best of Both Worlds**:
   - Playground: Full AI SDK features (tool calling, streaming, metadata)
   - Copilot: VS Code integration (model selector, native chat)

2. **Shared Infrastructure**:
   - Both paths use AI SDK Core
   - Shared model provider registry
   - Shared configuration management

3. **No Breaking Changes**:
   - Existing Copilot integration unchanged
   - Playground gets upgraded independently
   - Users can choose which integration to use

4. **Future Flexibility**:
   - Can add more VS Code integrations without affecting Playground
   - Can add more web-based interfaces without affecting Copilot

---

## Migration Strategy

### Phase 1: Preparation (Week 1)

**Tasks**:

1. Add AI SDK dependencies
2. Create new type definitions
3. Set up new folder structure
4. Write unit tests for new components

**Dependencies**:

```bash
npm install ai @ai-sdk/openai-compatible @ai-sdk/anthropic @ai-sdk/openai
```

**New Folder Structure**:

```
src/
  playground/
    types.ts              # New: UIMessage types
    MessageStore.ts       # New: Message storage
    PlaygroundService.ts  # New: Core service (replaces existing logic)
    PlaygroundController.ts  # New: Webview controller
    ModelProviderFactory.ts  # New: AI model factory
    playground.ts          # To be updated/removed
    playground.html        # To be updated
```

### Phase 2: Core Implementation (Week 2)

**Tasks**:

1. Implement MessageStore
2. Implement PlaygroundService
3. Implement ModelProviderFactory
4. Write integration tests

**Acceptance Criteria**:

- Can create and retrieve messages
- Can stream AI responses
- Can handle tool calls
- Can update metadata

### Phase 3: Webview Integration (Week 3)

**Tasks**:

1. Implement PlaygroundController
2. Update webview HTML/CSS
3. Implement webview JavaScript
4. Test user flows

**Acceptance Criteria**:

- Can send messages from webview
- Can see streaming responses
- Can clear history
- Can see metadata

### Phase 4: Integration with Extension (Week 4)

**Tasks**:

1. Update extension.ts to use PlaygroundController
2. Update commands
3. Update storage to work with new types
4. End-to-end testing

**Acceptance Criteria**:

- Can open Playground from command
- Messages persist across sessions
- Model configuration works
- No breaking changes to Copilot integration

### Phase 5: Cleanup and Documentation (Week 5)

**Tasks**:

1. Remove old code (createChatMessages, ChatMessage type)
2. Remove unused MessageConverter (for Playground only)
3. Update PROJECT_DESIGN.md
4. Update README.md
5. Add migration guide

### Rollback Plan

If issues arise:

- Keep old playground.ts as playground_old.ts
- Feature flag to switch between old/new implementation
- Can quickly revert by changing command to use old controller

---

## Benefits

### 1. Type Safety and Alignment

**Before**:

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string; // Simple string
  timestamp?: number;
}
```

**After**:

```typescript
type PlaygroundUIMessage = UIMessage<PlaygroundMetadata>;

// Rich content with parts
content: Array<
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool-result'; toolCallId: string; result: any }
>;

// Type-safe metadata
metadata: PlaygroundMetadata; // Fully typed
```

**Benefits**:

- Full type inference from AI SDK
- No custom type maintenance
- Compatible with AI SDK ecosystem

### 2. Reduced Complexity

**Before**:

- 3 type conversions
- Custom stream processing
- No built-in error handling
- Manual metadata management

**After**:

- 1 type conversion (AI SDK UI)
- Built-in streaming utilities
- Built-in error handling
- Built-in metadata support

**Metrics**:

- ~40% reduction in code
- ~50% reduction in complexity
- ~60% reduction in maintenance burden

### 3. Better Tool Calling

**Before**:

- Not supported in Playground
- Limited to text-only conversations

**After**:

- Full tool calling support
- Automatic tool execution
- Multi-step tool calling
- Visual tool call display

### 4. Improved Streaming

**Before**:

- Custom stream handling
- Manual chunk processing
- No stream transformations

**After**:

- `readUIMessageStream()` for clean streaming
- Automatic chunk processing
- Support for stream transformations (smoothStream, custom transforms)
- Built-in error handling for streams

### 5. Better Testing

**Before**:

- Hard to test (VS Code API dependency)
- No mocking support
- Integration testing only

**After**:

- `MockLanguageModelV3` for unit testing
- `simulateReadableStream` for testing
- Full test coverage possible

### 6. Metadata Support

**Before**:

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  model?: string;
}
```

**After**:

```typescript
interface PlaygroundMetadata {
  createdAt: number;
  modelSid: string;
  temperature: number;
  topP?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  // Can add custom metadata
}
```

**Benefits**:

- Rich metadata for debugging
- Token usage tracking
- Performance metrics
- Custom metadata support

### 7. Future-Proofing

**Before**:

- Tied to VS Code API
- Hard to add new features
- Limited extensibility

**After**:

- Uses standard AI SDK patterns
- Easy to add new features (agents, structured output, etc.)
- Easy to port to other platforms (web, mobile)
- Aligned with AI SDK roadmap

---

## Conclusion

The redesigned Playground architecture:

1. **Eliminates custom ChatMessage type** in favor of AI SDK's `UIMessage`
2. **Uses AI SDK Core directly** (`streamText`, `convertToModelMessages`, `readUIMessageStream`)
3. **Removes intermediate layers** and VS Code API dependency for Playground
4. **Adds full tool calling support** with automatic execution
5. **Improves streaming** with built-in utilities
6. **Enhances type safety** with AI SDK types
7. **Better testing** with AI SDK mock utilities
8. **Rich metadata support** for debugging and analytics

This architecture aligns completely with AI SDK technical specifications while maintaining VS Code API compatibility for Copilot integration through a separate path.

The migration is incremental and can be done without breaking existing functionality, with a clear rollback plan if needed.
