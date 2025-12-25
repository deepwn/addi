# Change Log

All notable changes to the "addi" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.11] - 2025-12-25

### Changed
- **Fixes**: Addressed several minor bugs and improved overall stability based on user feedback. (deepseek `reasoning_content` missing at next request with tool calling in thinking chain)

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