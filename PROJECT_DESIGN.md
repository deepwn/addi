# Addi Project Design Document

## 1. Overview

Addi is a Visual Studio Code extension that enhances the Copilot experience by allowing users to bring their own AI providers (OpenAI, Anthropic, Google, etc.) and models. It serves as a bridge between VS Code's Copilot and custom AI backends, while also providing a robust local runtime for custom tools via the Model Context Protocol (MCP).

## 2. Architecture Layers

The project is architected into four distinct layers to ensure separation of concerns and maintainability.

```mermaid
graph TD
    subgraph "Layer 1: Presentation (Frontend)"
        UI[Views & TreeData]
        CMD[Commands]
        Entry[Extension Entry]
    end

    subgraph "Layer 2: Core (Middle Bridge)"
        LLM[LLM Service]
        Align[Message Converter/Adapter]
        Registry[Provider & Model Manager]
    end

    subgraph "Layer 3: Infrastructure (Backend Execution)"
        MCP["MCP Service (Process Mgr)"]
        Tools[Tool Manager]
        Storage[Storage Service]
    end

    subgraph "Layer 4: Shared (Utils)"
        Logger
        Helpers
        Types
    end

    Entry --> CMD
    CMD --> UI
    CMD --> Registry

    UI --> Registry

    Registry --> Storage

    Entry --> LLM
    LLM --> Align
    LLM --> MCP

    MCP --> Tools
    Tools --> Storage
```

### Layer 1: Presentation (Frontend)

**Responsibility**: controls UI and VS Code related behaviors.

- **Views**: Tree Data Providers (`ProviderView`, `ToolView`) and Webview Managers (`EditorView`).
- **Commands**: Handles user interactions from the Command Palette and Context Menus.
- **Entry**: `extension.ts` serves as the bootstrapper, wiring dependencies together.

### Layer 2: Core (Middle Bridge)

**Responsibility**: Aligns behaviors between Copilot and the plugin's custom models.

- **LLMService**: The heart of the chat logic. It creates a standardized interface for `vscode.LanguageModel` to talk to various providers (OpenAI, Anthropic, etc.) via the Vercel AI SDK. Ref: [docs/ai-sdk-integration-guide.md](docs/ai-sdk-integration-guide.md)
- **MessageConverter**: Translates VS Code's chat protocol into standard AI SDK `ModelMessage` format. It ensures all multi-modal content and tool interactions are correctly mapped to the AI SDK Core specification.
- **ProviderModelManager**: Manages the domain state (Providers, Models) and business logic for CRUD operations.

### Layer 3: Infrastructure (Backend)

**Responsibility**: Managed execution of custom tools and persistence.

- **McpServerService**: Manages the lifecycle of the external Go-based MCP server. It handles the "physical" execution of tools (Process Management, Binary Downloading).
- **CustomToolManager**: Watches the file system for tool definitions (YAML) and configures the environment.
- **StorageService**: Abstracts VS Code's persistence layer (`globalState`, `secretStorage`).

### Layer 4: Shared (Utils)

**Responsibility**: Reusable, standardized utility tools.

- **Logger**: Standardized logging wrapper.
- **McpDownloader**: Utility for fetching external binaries.
- **Parsers & Validators**: Pure functions for data processing.

## 3. Core Design Principles

### Message Construction Standard

Addi strictly follows the **Vercel AI SDK Core `ModelMessage`** convention for all LLM interactions. This ensures:

1.  **High-Fidelity Context**: Accurate translation of VS Code's rich message parts (Text, Tool Call, Tool Result, Data/Images) into AI SDK parts. Ref: [docs/type-system-design.md](docs/type-system-design.md)
2.  **Provider Neutrality**: By normalizing to `ModelMessage`, we can swap between any AI SDK supported provider (OpenAI, Anthropic, Google) without changing the core logic.
3.  **Resilience**: Adoption of best practices like using the `system` property for system prompts to mitigate injection risks.

### Tool Execution Safety

Tools are executed in an isolated MCP server environment. The `core` layer never executes tool logic directly; it only coordinates the "request-response" loop between the LLM and the MCP infrastructure.

## 4. Interaction Flow

1.  **Initialization**: Layer 1 (Extension) boots up Layer 3 (MCP Service) and Layer 2 (Provider Manager).
2.  **User Request**: Copilot invokes Layer 2 (LLM Service).
3.  **Processing**: Layer 2 converts the request (Converter) and selects the right Provider.
4.  **Tool Execution**: If a tool is needed, Layer 2 calls into Layer 3 (MCP Service + Tool Manager) to execute it securely.
5.  **Response**: Results flow back up to Layer 1 for display.

## 5. External MCP Server (`mcp-server/`)

- Written in **Go**.
- Acts as the robust "Backend" execution engine.
- Supports File Watching, Docker execution, and Local binary execution.
- Bridged to Layer 3 via Stdio.

## 6. Directory Structure Vision

```
src/
  presentation/       # Layer 1
    commands/
    views/
    extension.ts (Entry)
  core/               # Layer 2
    llm/
    providers/
  infrastructure/     # Layer 3
    mcp/
    storage/
  common/             # Layer 4
    utils/
    types/
```
