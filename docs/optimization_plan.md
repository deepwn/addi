# Addi Optimization Plan

## Objective
Streamline the architecture by removing the standalone "Playground" feature to focus on the core integration: `(openai/anthropic/deepseek/openai-compatible) → ai-sdk ←→ vscode copilot UI`. This ensures better control over the architecture and leverages the native VS Code Copilot UI.

## Phase 1: Remove Playground Feature

### 1. File Deletion
Remove the following files which are exclusively used for the Playground feature:
- `src/presentation/playground.ts`: Core logic for the playground webview.
- `resources/playground.html`: HTML template for the playground.
- `docs/playground-redesign.md`: Documentation for playground redesign (obsolete).
- `src/test/presentation/playground.test.ts`: Unit tests for playground.

### 2. Code Cleanup

#### `src/presentation/commands.ts`
- Remove `PlaygroundManager` import.
- Remove `openPlayground` method from `CommandHandler` class.

#### `src/presentation/extension.ts`
- Remove `addi.useModel` command registration.
- Remove logic that attempts to open the playground.

### 3. Configuration Cleanup (`package.json`)

#### Commands
- Remove `addi.useModel` from `contributes.commands`.

#### Menus
- Remove `addi.useModel` from `contributes.menus.commandPalette`.
- Remove `addi.useModel` from `contributes.menus.view/item/context`.

#### Icons
- Remove `use-model-icon` from `contributes.icons`.

#### Configuration
- Review and remove any `addi.playground.*` settings if they exist (Checked: none specific to playground found in `configuration.properties` except potentially some token limits being used there, but those seem generic).

## Phase 2: Core Architecture Optimization
*(To be detailed after Phase 1)*

Focus on the data flow:
`Provider (OpenAI/DeepSeek/etc) <-> Addi AI SDK <-> VS Code Language Model API <-> VS Code Copilot UI`

- **Stable Polyfill**: Ensure `ai-sdk` properly bridges all providers to the VS Code LM API standards.
- **Stream Response**: Optimize streaming stability for the Copilot UI.
- **Error Handling**: better error mapping from providers to VS Code UI.
