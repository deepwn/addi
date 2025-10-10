# Change Log

All notable changes to the "addi" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.3] - 2025-10-10

- Enabled proposed APIs required for language model tool interoperability (`contribLanguageModelToolSets`, `languageModelCapabilities`).
- Added a tool registry fallback so Addi models can invoke VS Code built-in tools whenever the host exposes them.
- Unified OpenAI-compatible request payloads to re-use shared tool definitions and extended tests covering fallback tool discovery.

## [0.0.2] - 2025-10-09

- Added centralized logger with configurable `addi.logLevel` and dedicated Output channel commands (`addi.showLogs`, `addi.setLogLevel`).
- Removed the legacy `addi.debug.printSettingsSyncState` command in favor of richer structured logging around model resolution and chat options.

## [0.0.1] - 2025-09-28

- Initial release of Addi, enabling custom AI model integration with GitHub Copilot.