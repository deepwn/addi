# Change Log

All notable changes to the "addi" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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