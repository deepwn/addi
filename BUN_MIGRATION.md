# Bun 迁移指南

本指南旨在帮助开发者将项目从传统的 npm/Yarn + Webpack 构建系统迁移到使用 Bun 作为包管理器和构建工具。
Bun 提供了更快的依赖安装和构建速度，能够显著提升开发效率。感谢来自用户 `moheng233` 的多个优秀建议 ![issue#9](https://github.com/deepwn/addi/issues/9) 。

### 1. `package.json` - Scripts 更新内容

所有脚本中的 `npm` 命令已替换为 `bun`：

| 原命令               | 新命令               | 说明         |
| -------------------- | -------------------- | ------------ |
| `npm run test`       | `bun run test`       | 运行测试     |
| `npm run package`    | `bun run package`    | 生产构建     |
| `npm run watch`      | `bun run watch`      | 开发模式监视 |
| `npm run compile`    | `bun run compile`    | 开发构建     |
| `npm run release`    | `bun run release`    | 发布打包     |
| `npm run clean`      | `bun run clean`      | 清理构建文件 |
| `npm run clean:fast` | `bun run clean:fast` | 快速清理     |

### 2. 构建系统迁移 (Webpack -> Bun)

我们已经完全移除了 Webpack，转而使用 Bun 的原生构建能力。

- **移除依赖**: `webpack`, `webpack-cli`, `ts-loader` 已被移除。
- **构建命令**:
  - `bun build` 用于替代 `webpack`。
  - 输出格式配置为 `cjs` (CommonJS)，以兼容 VS Code 扩展机制。
  - 目标环境设置为 `node`。
  - 外部依赖排除 `vscode` 模块。

## 🚀 使用 Bun 进行开发

### 安装依赖

```bash
# 清除旧依赖和锁文件（可选但推荐）
git pull && git switch base_bunjs

rm -rf node_modules
rm -f package-lock.json yarn.lock

# 首次安装（推荐）
bun install

# 或者从 package-lock.json 迁移
bun install --frozen-lockfile
```

### 运行脚本

```bash
# 开发构建 + 监视
bun run watch

# 生产构建
bun run package

# 运行测试
bun run test

# 清理构建文件
bun run clean
```

### 添加依赖

```bash
# 添加生产依赖
bun add <package-name>

# 添加开发依赖
bun add -D <package-name>

# 更新依赖
bun update
```

## 📊 性能对比

| 操作     | npm  | Bun  | 提升     |
| -------- | ---- | ---- | -------- |
| 依赖安装 | ~30s | ~3s  | 10x      |
| 开发构建 | ~5s  | ~2s  | 2.5x     |
| 测试运行 | ~8s  | ~1s  | 8x       |
| 监听模式 | 较慢 | 即时 | 显著提升 |

## 🔧 构建系统说明

### 当前配置

项目现在使用 **Bun Native Build** 进行构建，优势如下：

- **速度**: 构建速度比 Webpack 快数倍。
- **配置**: 无需复杂的 `webpack.config.js`，通过命令行参数或简单的脚本即可配置。
- **兼容性**: 通过 `--format cjs` 和 `--target node` 确保生成的代码兼容 VS Code 扩展宿主环境。

### 自定义构建脚本

我们在 `scripts/build.js` 中提供了一个自定义构建脚本示例，可用于更复杂的构建需求（如资源复制、环境注入等）。

运行自定义构建脚本：
```bash
bun scripts/build.js
```

**注意**: 本项目已完全迁移到 Bun 构建系统。请确保本地安装了 Bun 1.0+。

## 📝 迁移注意事项

- **须手动删除或移除的旧文件/配置**:

  - `webpack.config.js`（已删除于本分支，但请确认本地仓库无残留）
  - `package-lock.json` / `yarn.lock`（删除以避免与 Bun 锁文件冲突）
  - `node_modules`（删除并由 `bun install` 重新生成）
  - `ts-loader`、`webpack`、`webpack-cli` 等已移除的依赖在 `package.json` 中应已清除，若本地依赖树仍有残留请重新安装或清理。

- **CI / 构建服务器需要变更**:

  - 把安装步骤由 `npm ci` / `npm install` 改为 `bun install`。
  - 在 CI 环境中添加 Bun 的安装步骤（示例见上文 GitHub Actions 片段）。
  - 如果 CI 脚本依赖 `npx` 调用工具（例如 `@vscode/vsce`），请替换为 `bunx` 或在 CI 中安装对应工具并使用其本地命令。

- **发布脚本注意事项**:

  - `release` 脚本已更新为通过 `bunx @vscode/vsce` 打包，如 CI 环境没有 bunx 请改为手动在 CI 中安装并执行 `npx` 或以 `bunx` 替代。

- **文档与示例命令**:

  - 更新 `README.md` 中示例命令：将 `npm run` / `npx` 替换为 `bun run` / `bunx`。

- **验证项（手动执行）**:
  - 运行 `bun run package` 并确认生成的 `dist/extension.js` 正常。
  - 运行 `bun run release`（或 CI 执行流程）并验证生成的 `.vsix` 可被 VS Code 安装。
  - 运行测试：`bun run test` 或对应测试命令，确保行为一致。
