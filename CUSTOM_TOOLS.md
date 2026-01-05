# 自定义工具指南 (Custom Tools Guide)

Addi 允许你通过简单的 YAML 配置文件定义自定义工具，从而扩展 GitHub Copilot 的能力。这些工具可以在你的本地机器上运行脚本（Python, Node.js, Shell 等），或者执行 HTTP 请求，并将结果返回给 AI 模型。

## 核心概念

- **工具定义**：使用 YAML 文件描述工具的名称、描述、输入参数和执行步骤。
- **本地执行**：工具直接在你的 VS Code 环境中运行（通过子进程），可以访问你的本地文件和网络。
- **上下文感知**：工具可以接收 AI 传递的参数，并将输出反馈给 AI，帮助其完成更复杂的任务。
- **安全隔离**：支持区分 `public` (共享) 和 `private` (私有/包含密钥) 的工具配置。

## 工具位置

Addi 会自动扫描以下目录中的 `.yaml` 或 `.yml` 文件：

1. **全局工具**：`~/.addi/*.yaml` (用户主目录)
   - 适合通用的、跨项目的工具。
2. **工作区公共工具**：`./.addi/public/*.yaml` (当前工作区)
   - 适合随项目代码库一起提交的共享工具。
3. **工作区私有工具**：`./.addi/private/*.yaml` (当前工作区)
   - 适合包含 API Key 或敏感信息的工具。**建议将 `.addi/private` 添加到 `.gitignore`。**

## 构造方式

工具定义文件遵循类似 GitHub Actions 的语法结构。

### 基本结构

```yaml
name: "my-tool-name"          # 工具的唯一标识符 (必填)
description: "工具的功能描述"   # AI 会根据此描述决定何时调用工具 (必填)
inputs:                       # 输入参数定义 (可选)
  arg1:
    description: "参数描述"
    required: true
runs:                         # 执行逻辑 (必填)
  using: "composite"          # 目前支持 composite 模式
  steps:                      # 执行步骤列表
    - run: echo "Hello ${{ inputs.arg1 }}"
      shell: bash
```

### 属性详解

#### `inputs`
定义工具接受的参数。
- `description`: 参数用途的自然语言描述。
- `required`: 是否必须提供。

#### `runs.steps`
定义执行步骤。每个步骤可以包含：
- `run`: 要执行的脚本命令。支持多行字符串。
- `shell`: 指定执行环境。支持 `bash`, `sh`, `python`, `node`, `powershell`, `cmd` 等。
  - 如果未指定，默认使用系统默认 shell。
- `env`: 设置环境变量 map。

### 变量替换
在 `run` 脚本中，可以使用 `${{ inputs.variableName }}` 来引用输入参数。

## 示例

### 1. 简单的 Shell 脚本 (获取公网 IP)

```yaml
name: "get-remote-ip"
description: "Get the public IP address and geolocation info"
runs:
  using: "composite"
  steps:
    - run: |
        curl -s http://ip-api.com/json/
      shell: bash
```

### 2. Python 脚本 (计算斐波那契数列)

```yaml
name: "fibonacci"
description: "Calculate the Nth Fibonacci number"
inputs:
  n:
    description: "The position in the Fibonacci sequence"
    required: true
runs:
  using: "composite"
  steps:
    - run: |
        import sys
        
        def fib(n):
            if n <= 1: return n
            return fib(n-1) + fib(n-2)
            
        try:
            n = int("${{ inputs.n }}")
            print(f"Fibonacci({n}) = {fib(n)}")
        except ValueError:
            print("Error: Input must be an integer")
      shell: python
```

### 3. Node.js 脚本 (使用环境变量)

```yaml
name: "check-env"
description: "Check if a specific environment variable is set"
inputs:
  varName:
    description: "The name of the environment variable to check"
    required: true
runs:
  using: "composite"
  steps:
    - env:
        MY_SECRET: "some-secret-value"
      run: |
        const varName = "${{ inputs.varName }}";
        const val = process.env[varName];
        console.log(`Value of ${varName}: ${val ? 'Set' : 'Unset'}`);
        if (varName === 'MY_SECRET') {
            console.log(`Secret check: ${process.env.MY_SECRET === 'some-secret-value'}`);
        }
      shell: node
```

## 运行方式

1. **创建文件**：在上述任意一个支持的目录中创建 `.yaml` 文件。
2. **刷新**：Addi 会自动监听文件变化并重新加载工具。你也可以在 VS Code 命令面板运行 `Addi: Refresh Tools`。
3. **使用**：在 Chat 界面中，你可以直接用自然语言请求 AI 使用这些工具。
   - 例如："帮我查一下现在的公网 IP" (如果定义了 `get-remote-ip`)
   - 例如："计算斐波那契数列的第 10 项" (如果定义了 `fibonacci`)

## 调试

- 如果工具执行失败，可以在 VS Code 的 "Output" (输出) 面板中选择 "Addi" 频道查看详细日志。
- 确保你的系统路径中安装了对应的运行时（如 `python`, `node` 等）。
