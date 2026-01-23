# Change Log

All notable changes to the "addi" extension will be documented in this file.

## [0.0.23] - 2026-01-22

### Added

- **RegExp Flags Configuration**: Users can now customize regular expression flags (`i`, `s`, `m`) for scrubbing patterns in the model settings.
- **Retry Limit & Safety**: Added a hard limit of 3 retries for unexpected behavior handling to prevent infinite loops, with user notification upon failure.

### Changed

- **Enhanced Scrubbing Logic**: Updated streaming response middleware to use persistent buffers per request, ensuring robust detection of patterns even when split across multiple packets.
- **Improved Output Interception**: Fully masks the triggering data chunks from reaching the UI when a retry is initiated.
- **Default Behavior**: Set default RegExp flags to `g` (global) to provide predictable matching by default.

## [0.0.22] - 2026-01-22

### Added

- **Unexpected Behavior Handling (Beta)**: Introduced a mechanism to handle hallucinated tool call tags (e.g. `<tool_call>`) in model responses:
  - **Scrubbing**: Automatically remove hallucinated tags from prompt history and streaming responses.
  - **Auto-Retry**: Detect hallucinated output in real-time and automatically retry the request with `tool_choice: required` to force proper tool usage.
  - **Robust Matching**: Support for cross-delta regex matching in streaming responses to catch tags even when split across packets.
- **Model Editor Enhancements**: Improved the model configuration UI with real-time regex validation, error highlighting, and an interactive matching tester.

### Fixed

- **Middleware ID handling**: Added unique request IDs to middleware context to ensure thread-safe state management during concurrent streaming requests.
- **Performance**: Optimized regex processing in `ToolCallCompatibilityMiddleware` using a compilation cache.

## [0.0.21] - 2026-01-21

### Changed

- **Configuration Sync Strategy**: Enhanced security by separating sensitive data from synchronized configuration:
  - **API Keys**: Always stored in VS Code's `SecretStorage` (OS-encrypted) and never synced
  - **Performance Data**: Local-only storage some like `speedHistory` / `averageSpeed` to `EXTEND_STORAGE_KEY` to avoid frequent sync traffic
- **Security Enhancement**: Consolidated API key storage in encrypted `SecretStorage` with automatic migration from legacy storage (when import file without API key will migrate local keys if already present).
- **Performance Optimization**: Reduced Settings Sync traffic by isolating frequently-updated performance metrics
- **VS Code Version requirement**: Updated minimum VS Code version to `1.108.0`.
- **Schema handling**: Adopted Zod-based schema conversion (`safeConvertToZod`) and updated `LLMService` to register tools using Zod schemas while retaining compatibility with legacy JSON Schemas.
- **Disable speed test by default**: The speed test is now disabled by default with `Verify & Detect` in editor view. It's auto tested with every normal chat requests.

## [0.0.20] - 2026-01-16

> [!NOTE]
> This release introduces significant enhancements to the MCP Server, including HTTP resource serving, authentication, and improved logging. These changes aim to provide a secure and flexible environment for executing custom tools. Now you can use it as a standalone service over HTTP with proper access controls and shareable for your team. And you can use the `mcp-server` CLI directly with more options as a single tool.

### Added

- **MCP Server (CLI refactor)**: migrated `mcp-server` to `cobra` for consistent CLI handling and added flags: `--host`, `--port`, `--auth`, `--log-limit`, `--base-url`, and `--cors`.
- **HTTP Resource Serving**: resources can now be exposed over HTTP in HTTP mode. Resource URIs are generated as `http(s)://<base-url>/resources/<dirToken>/<relPath>` when `--port` is set.
- **Auth & Security**: HTTP mode supports an authentication token (auto-generated if `--auth` is empty). Token may be passed via query param (for EventSource) or `Authorization: Bearer <token>` header.

### Changed

- **Resources refactor**: moved resource discovery/registration code into `mcp-server/resources` and updated `resources.Register` to accept a `buildURI` callback so URIs can be generated for different transport modes.
- **SSE base URL**: SSE server now publishes a configurable base URL (uses `--base-url` when provided) so clients behind proxies see correct endpoints.
- **Logging rotation**: replaced ad-hoc logging with `lumberjack` rotator and added `--log-limit` (days) to control retention (old files purged).

### Fixed

- **Path traversal & access control**: HTTP resource handler validates requested paths against registered resource roots and returns `403` for forbidden access.
- **Build fixes**: resolved minor compile issues (unused variables and signature mismatches) introduced during refactor.

### Notes

- Default CORS behavior: CORS headers are not emitted unless `--cors` is set. If `--cors` is `*`, a startup warning is logged. If `--base-url` is set and `--cors` is not provided, the server will allow the `--base-url` origin by default.

## [0.0.19] - 2026-01-14

### Added

- **Formatting**: added ESLint and Prettier configurations for consistent code style.

### Changed

- llmService: remove `stopWhen` to give more flexibility to tool calling logic.
- refactor logging mechanism and remove log level configuration.
- enforce object schema for LLM tool inputs and sanitize properties.

### Fixed

- Optimization: Build a map of toolCallId -> toolName once to avoid O(N\*M) lookups when processing tool calls.

## [0.0.18] - 2026-01-09

### Added

- **Tool Verification**:
  - Added `tool_yaml_verify` tool to validate tool YAML definitions against the schema.
  - Added automatic validation during tool loading: malformed YAML files are now ignored with a warning notification sent to the client instead of silently failing or crashing.

### Changed

- **UI**: Removed the manual "Refresh" button from the Custom Tools view. Tool lists now update automatically via the file watcher and MCP notifications.

## [0.0.17] - 2026-01-07

> [!NOTE]
> This release provides necessary updates and fixes. We are postponing the 0.1.0 release to strictly address stability issues with the MCP auto-update mechanism.

### Added

- **Advanced Tool Runner (Composite Actions)**:
  - Fully implemented a local runner compatible with **GitHub Actions Composite Action** syntax.
  - **Context Support**: Added support for `${{ runner.os }}`, `${{ github.workspace }}`, `${{ inputs.* }}`, and `${{ steps.*.outputs }}` contexts.
  - **Expression Evaluation**: Support for basic expressions in `if` conditions and `run` scripts.
  - **Cross-Platform Shells**: Automatic resolution of `bash`, `powershell`, `python`, `node`, `bun`, and `cmd`.
  - **recursive Calls**: Tools can now reference other local tools using `uses: ./path/to/action`.
- **Tool Context Resources**:
  - MCP Server now scans for a `resources` subdirectory in tool directories.
  - Files in these directories are exposed as MCP Resources (URI `file:///...`), allowing AI models to read documentation or templates directly.
  - Added `addi_server_info` built-in tool to inspect server state, version, and loaded tools.
- **Embedded Documentation**: The MCP Server binary now embeds reference documentation and templates (accessible via specific internal URIs or `addi_server_info`), helping users learn syntax without leaving the editor.
- **Improved Watcher**: The file watcher now correctly handles file deletions (`remove` events) and instantly notifies clients to refresh the tool list.

### Improved

- **Documentation**:
  - Major update to `CUSTOM_TOOLS.md`: Added detailed guides on "Advanced Features" (Contexts, Conditionals), "Complex Script Separation", and updated directory structure recommendations.
  - Added comprehensive reference docs (`create-composite-action.md`, `metadata-syntax.md`, `workflow-syntax.md`) internally for context.
- **Developer Experience**:
  - `McpServerService` now dynamically syncs its reported client version with the extension version.
  - Refined `mcpIntegration` to ensure stable environment variables, reducing unnecessary server restarts.

### Fixed

- **Docker Compatibility**: Explicitly disabled mismatched execution modes (prevented Docker actions from failing obscurely in local mode).

## [0.0.16] - 2026-01-06

### Added

- **Hot Reloading**: MCP Server now supports watching for file changes (`--watch` mode). Modifying tool definitions (YAML) will automatically reload and register the tool without restarting the server or VS Code.
- **Tools**: Added `scripts/dev-install.ps1` and `scripts/dev-install.sh` for rapid local development iterations (build, install binary, install vsix, reload).
- **Network Tools**: Enhanced sample tools `test-remoteip` and `test-netinfo` with cross-platform support (Windows PowerShell optimized, Mac/Linux support).

### Fixed

- **PowerShell Execution**: Optimized PowerShell command execution in MCP tools by adding `-NoProfile` to prevent loading user profiles, resulting in faster and cleaner execution.
- **Windows Support**: Improve compatibility for network commands on Windows.

### Fixed (Previous)

- **MCP Server**: Download Fixed an issue in the `Download Addi MCP Server` command where specifying a version did not correctly download the requested version.

- **Moved**: `fetchProviderModelsFromApi` and related methods to `ProviderModelManager` for better separation of concerns.
- **Refactored**: Refactored `McpServerService` to implement a persistent connection, reducing overhead from spawning new processes for each tool call.
- **Updated**: Updated `AddiChatProvider` and `LLMService` to accept `McpServerService` as a dependency, enhancing modularity and testability.
- **Removed**: Removed unused interfaces and constants to clean up the codebase.
- **Enhanced**: Enhanced schema sanitization in `LLMService` to ensure required fields are validated against existing properties.

### Added

- **Manual Version Selection**: The `Download Addi MCP Server` command now allows users to input a specific version to download.
- **Windows Dev Support**: Added `scripts/build.ps1` for building the MCP server and generating checksums in Windows environments.
- **Document Of Project Design**: Added project design documentation to reflect architectural changes and future improvement plans.

### Improved

- **Code Organization**: Extracted MCP binary download logic into a dedicated `McpDownloader` utility class.
- **Dependency Management**: Updated core dependencies including `@ai-sdk/*`, `zod`, and `typescript-eslint`.

## [0.0.15] - 2026-01-05

> [!WARNING] **Major Breaking Change / 重大破坏性更新**
>
> This release introduces a complete architectural overhaul for Custom Tools. We have abandoned the legacy internal JavaScript-based tool parser in favor of a robust, standalone **MCP (Model Context Protocol) Server**.
>
> 本次更新对自定义工具进行了彻底的架构重构。放弃了旧版内部的 JavaScript 工具解析器，转而采用基于 **Go**, **mcp-go** 和 **nektos/act** 构建的独立 MCP Server。

### ⚠ Architecture Changes

- **Standalone MCP Server**: Tool execution is now handled by a separate binary (`mcp-server`), which implements the Model Context Protocol. This ensures better isolation, performance, and standard compliance.
- **Act Integration**: We now leverage `nektos/act` libraries to parse and execute tools, providing a runtime environment compatible with GitHub Actions.
- **Legacy Parser Removal**: The old `ToolParser` and `CustomToolExecutor` logic within the extension has been replaced.

### Added

- **Automatic Binary Management**: The extension automatically downloads, verifies (SHA256), and updates the required `mcp-server` binary.
- **Security & Integrity**: Added SHA256 checksum verification for the downloaded MCP server binary to ensure integrity.
- **Documentation**: Added [CUSTOM_TOOLS.md](CUSTOM_TOOLS.md) for detailed guidance on the new tool system.

### Improved

- **Reliability**: Tool execution is now significantly more reliable and consistent across platforms.
- **Security**: Added checksum verification for external binaries.

### Fixed

- **Execution Context**: Fixed issues where complex scripts or environment variables were not correctly handled in the previous JS implementation.

## [0.0.14] - 2026-01-05

### Added

- **Script Execution**: Custom tools now support multi-line scripts (Node.js, Python, Shell, etc.) via the `run` property.
- **Shell Selection**: Added `shell` property to tool steps to specify the execution environment (e.g., `node`, `python`, `bash`, `powershell`).
- **Environment Variables**: Added `env` property to tool steps for injecting environment variables.
- **Enhanced Parsing**: `ToolParser` now intelligently handles both legacy simple commands and new structured script steps.

### Changed

- **Test Architecture**: Completely reorganized the test suite into `unit` and `integration` directories for better maintainability and faster execution.
- **Tool Execution**: Custom tools are now executed via temporary files for better robustness and compatibility with complex scripts.
- **Editor View**: Refactored the Editor View to load HTML resources asynchronously.

### Fixed

- **Tool Management**: Fixed `editTool` and `deleteTool` commands to correctly locate files in `.addi/public` or `.addi/private`.
- **Provider Refresh**: Fixed an issue where the provider list wouldn't refresh automatically after updates.
- **Test Imports**: Fixed relative import paths in the test suite.

## [0.0.13] - 2025-12-29

### Bun Migration

- **Build System**: Migrated from Webpack to Bun's native build system for faster and more efficient builds.

> [!WARNING] Should delete Webpack config and related files after confirming Bun build is stable. and remove `node_modules` and old lock files before reinstalling with Bun.

### Security

- **Secure Storage**: Migrated API Key storage to VS Code's native `SecretStorage`. API Keys are now encrypted by the OS and are no longer synced via Settings Sync (only non-sensitive config is synced).
- **Secure Export**: Exporting configuration without a password now automatically strips all API Keys. API Keys are only included when exporting with a password (encrypted).

> [!WARNING] Users will need to re-enter their API Keys after updating to this version, as the storage mechanism has changed. Or backup and re-import with password to transfer existing keys.

## [0.0.12] - 2025-12-27

### Re-build

- **Extension Re-build**: Rebuilt the entire extension ai based on `@ai-sdk/*` packages to improve stability and maintainability.
- **Dependency Updates**: Updated all dependencies to their latest versions, ensuring compatibility and security.

### Fixed

- **Bug Fixes**: Fixed some bug with model verification, streaming, and tool calling to enhance user experience and reliability (when switching to Vercel AI SDK).

## [0.0.11] - 2025-12-25

### Major Refactor

- **Vercel AI SDK Integration**: Completely rewrote the core LLM engine to use Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/deepseek`). This improves stability, standardizes streaming, and simplifies future provider additions.
- **DeepSeek Support**: Added native support for DeepSeek via `@ai-sdk/deepseek`.

### Added

- **Custom Tools**: New "Custom Tools" panel allows you to define your own tools (Shell Commands or HTTP Requests) that can be automatically called by the model during chat.
- **Tool Management**: Add, delete, and manage custom tools directly from the sidebar.

### Changed

- **Architecture**: Removed legacy `LLMClient` and manual HTTP fetching logic.
- **Performance**: Improved message conversion and stream handling.

### Fixed

- **Stability**: Addressed various bugs related to stream parsing and connection handling by leveraging the robust AI SDK.

## [0.0.10] - 2025-12-23

### Added

- **Copy Feature**: Added "Copy" context menu option for Providers and Models to quickly duplicate configurations
- **Preview Enhancements**: Added support for Vision and Tool Calling examples in the Request Preview

### Changed

- **UI Improvements**: Increased the height of the Request Preview area in the editor view for better visibility
- **Cleanup**: Removed `responseOverwrite` feature to simplify the codebase and improve stability

## [0.0.9] - 2025-12-23

### Added

- **Request/Response Customization**: Added `requestAdditional` and `responseOverwrite` properties to ModelDraft for advanced request and response customization
- **Header Sanitization**: Implemented header sanitization for API calls across all provider types to ensure security and compatibility
- **Streaming Tests**: Enhanced test coverage for bare JSON responses and multiple small chunk handling in streaming scenarios

### Improved

- **Editor View**: Replaced DetailsView with a more powerful EditorViewManager that supports editing, saving, and verifying providers and models
- **SSE Payload Handling**: Enhanced `streamChatCompletion` to correctly process various SSE (Server-Sent Events) payload formats
- **API Client**: Improved `requestAdditional` handling to support additional parameters in API requests for all provider types

### Changed

- **Architecture**: Major refactoring of the view system - migrated from `detailsView.ts` to `editorView.ts` with enhanced functionality
- **Test Coverage**: Expanded streaming test suite with 300+ new test cases to ensure robust streaming behavior

## [0.0.8] - 2025-12-20

### Added

- **Enhanced Model Verification**: Improved model verification UI with better progress indicators and error handling
- **Auto-Detection**: Automatic detection of model capabilities (vision, tool calling) during verification process
- **Token Limit Optimization**: More efficient token limit detection using binary search with parameter estimation to avoid consuming user tokens

### Improved

- **Vision Testing**: Unified vision capability testing with standardized 1x1 GIF image for consistent verification across models
- **Error Messages**: More descriptive error messages for failed verifications with actionable feedback
- **Sorting Performance**: Fixed case sensitivity issue in alphabetical sorting of providers and models

### Changed

- **UI Feedback**: Enhanced verification progress indicators with real-time status updates
- **Configuration**: Better handling of model configuration during verification with rollback options on failure

## [0.0.7] - 2025-12-19

Fix: Upper and lower case alphabetical sorting bug.

## [0.0.6] - 2025-12-19

### Added

- **Settings Access**: Added a settings button to the Addi panel title bar for quick access to extension configuration.
- **Sorting Options**: Introduced `addi.sortRule` to sort providers and models by alphabet, input tokens, or output tokens.
- **Sort Targeting**: Added `addi.sortTarget` to control whether sorting applies to providers, models, or both.

## [0.0.5] - 2025-12-17

### Added

- **Token Limit Detection**: Implemented binary search for more efficient and accurate input/output token limit detection.
- **Cost Optimization**: Token limit testing now uses parameter estimation to avoid consuming user tokens.
- **Vision Testing**: Unified vision capability testing with a standardized 1x1 GIF image.
- **Auto-Verification**: The "Verify" button now automatically tests for capabilities (vision, tools) and detects token limits.

### Changed

- **Type Safety**: Increased usage of `@types/vscode` built-in types and classes.
- **Logging**: Enhanced logging with more detailed execution information for debugging.

### Fixed

- **Message Converter**: Resolved issues with image attachment handling in `messageConverter`.

## [0.0.4] - 2025-12-15

### Fixed

- **Tool Invocation**: Resolved an issue where certain tool invocations would fail due to incorrect parameter serialization.
- **Stream Termination**: Fixed a critical bug where responses were cut off prematurely if the network packet split the stream at a specific point.
- **Latency**: Resolved an issue causing a long delay after tool execution by optimizing how the extension detects the end of a stream.
- **Progress Indicators**: Improved the handling of "Thinking" and other progress events to ensure they are displayed correctly.

### Changed

- **Project Management**: Migrated from Yarn to NPM for dependency management and packaging.

## [0.0.3] - 2025-10-10

- Enabled proposed APIs required for language model tool interoperability (`contribLanguageModelToolSets`, `languageModelCapabilities`).
- Added a tool registry fallback so Addi models can invoke VS Code built-in tools whenever the host exposes them.
- Unified OpenAI-compatible request payloads to re-use shared tool definitions and extended tests covering fallback tool discovery.

## [0.0.2] - 2025-10-09

- Added centralized logger with configurable `addi.logLevel` and dedicated Output channel commands (`addi.showLogs`, `addi.setLogLevel`).
- Removed the legacy `addi.debug.printSettingsSyncState` command in favor of richer structured logging around model resolution and chat options.

## [0.0.1] - 2025-09-28

- Initial release of Addi, enabling custom AI model integration with GitHub Copilot.
