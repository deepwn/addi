# Optimization and Refactoring Plan

## Goal
Audit the current project and replace custom type definitions with native VS Code API types where possible, following the update of dependencies.

## Status
- [x] Update npm packages to latest versions.
- [x] Audit and Refactor Codebase.

## Refactoring Phases

### Phase 1: Core Types & Utilities (Inner Layer)
**Target:** `src/services/messageConverter.ts`

1.  **Replace `CustomImagePart`**
    *   **Status:** Completed.
    *   **Details:** Replaced with `vscode.LanguageModelDataPart`. Added `uint8ArrayToBase64` helper.

2.  **Optimize Tool Call Extraction**
    *   **Status:** Completed.
    *   **Details:** Added check for `vscode.LanguageModelToolCallPart`.

3.  **Optimize Tool Result Extraction**
    *   **Status:** Completed.
    *   **Details:** Added check for `vscode.LanguageModelToolResultPart`.

### Phase 2: Service Layer (Middle Layer)
**Target:** `src/modelTester.ts`

1.  **Update Vision Test Payload**
    *   **Status:** Completed.
    *   **Details:** Updated to use `new vscode.LanguageModelDataPart(...)`.

### Phase 3: Client & Extension Layer (Outer Layer)
**Target:** `src/services/llmClient.ts` & `src/extension.ts`

1.  **Verify Usage**
    *   **Status:** Verified.
    *   **Details:** `LLMClient` uses `MessageConverter` which now handles native types.

2.  **Optimize Tool Definitions**
    *   **Status:** Completed.
    *   **Details:**
        *   Updated `LLMClient` methods to accept `ReadonlyArray<vscode.LanguageModelChatTool>`.
        *   Updated `ToolRegistry` to work with `vscode.LanguageModelChatTool`.
        *   Updated `AddiChatProvider.resolveToolDefinitions` to use `options.tools` directly.
        *   Removed unused `ToolRegistry` import and helper methods in `LLMClient`.

## Execution Strategy
1.  Verify type availability in `src/services/messageConverter.ts` first.
2.  If types are available, proceed with Phase 1.
3.  Compile and test.
4.  Proceed with Phase 2.
5.  Compile and verify "Verify" button functionality.
