# Addi Architecture

## Overview

Addi is a VS Code extension that provides a **Visual Editor** for `chatLanguageModels.json` (VS Code's built-in BYOK configuration file). It uses VS Code's `CustomTextEditorProvider` API.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   VS Code Extension                  │
│                                                      │
│  src/extension.ts                                    │
│    └─ activate()                                     │
│        ├─ Register CustomTextEditorProvider           │
│        ├─ Register "addi.openEditor" command          │
│        ├─ Create default .vscode/chatLanguageModels   │
│        │    .json if missing                          │
│        └─ Migration from v1.x (detect + prompt)       │
│                                                      │
│  src/addiEditor.ts                                    │
│    └─ AddiEditorProvider (CustomTextEditorProvider)    │
│        ├─ resolveCustomTextEditor()                   │
│        │   └─ Webview Panel (React app)               │
│        ├─ Message handling: init, ready, update       │
│        └─ WorkspaceEdit sync (save)                   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│               Webview (React + Vite)                  │
│                                                      │
│  webview-ui/src/App.tsx                               │
│    ├─ Visual editor for LMProvider[]                  │
│    ├─ Provider cards (collapsible)                    │
│    ├─ Inline editing (fields, toggles)                │
│    ├─ Add/delete provider/model                       │
│    ├─ Dirty state tracking + Save bar                 │
│    └─ i18n (en/zh)                                    │
│                                                      │
│  webview-ui/src/index.css                             │
│    └─ VS Code theme-aware dark theme                  │
└─────────────────────────────────────────────────────┘
```

## Key Concepts

### BYOK (Bring Your Own Key)
VS Code's native mechanism allowing users to configure custom model endpoints. Configuration is stored in `.vscode/chatLanguageModels.json` in the workspace.

### CustomTextEditorProvider
VS Code API that associates a custom editor view with a file type (by `filenamePattern`). Addi registers for `chatLanguageModels.json`.

### Data Flow
1. User opens `chatLanguageModels.json` → VS Code triggers `AddiEditorProvider`
2. Provider reads file content → sends to webview as `{ type: "init", data: LanguageModelsConfig }`
3. Webview renders visual editor with providers/models
4. User edits → webview sends `{ type: "update", data: LanguageModelsConfig }`
5. Provider writes to file via `WorkspaceEdit`
6. VS Code detects change → re-triggers editor → sends updated data

## Data Types

```typescript
interface LanguageModelsConfig {
  $schema: string;
  providers: LMProvider[];
}

interface LMProvider {
  vendor: ProviderVendor;     // e.g., "copilot", "github", "openai", "azure", "anthropic", "google", "custom"
  name: string;               // Display name
  apiKey?: string;            // API key (written to file, VS Code handles security)
  apiType: ApiType;           // "chat-completions" | "azure-chat-completions" | "completions" | "realtime"
  models: LMModel[];
}

interface LMModel {
  id: string;                 // Model identifier
  name?: string;              // Display name
  url?: string;               // Custom endpoint URL
  apiType?: ApiType;          // Per-model override
  toolCalling?: boolean;      // Supports tools/functions
  vision?: boolean;           // Supports vision/Images
  maxInputTokens?: number;    // Input token limit
  maxOutputTokens?: number;   // Output token limit
  editTools?: boolean;        // Supports edit tools
  thinking?: boolean;         // Supports thinking/reasoning
  streaming?: boolean;        // Supports streaming
  supportsReasoningEffort?: "low" | "medium" | "high";
  reasoningEffortFormat?: "api-token" | "api-header-proxy" | "api-key";
  requestHeaders?: Record<string, string>;
  zeroDataRetentionEnabled?: boolean;
}
```

## Build

- **Extension**: `bun build ./src/extension.ts --outdir ./dist --target node --format cjs --external vscode`
- **Webview**: Vite builds to `resources/webview/assets/`
- **Full**: `bun run build` (webview + extension)

## Zero Runtime Dependencies

The extension has no npm runtime dependencies. It only uses VS Code APIs. The webview is a standalone React app (bundled by Vite).
