# GitHub Actions 的元数据语法 (action.yml)

> Source: [https://docs.github.com/zh/actions/creating-actions/metadata-syntax-for-github-actions](https://docs.github.com/zh/actions/creating-actions/metadata-syntax-for-github-actions)

> **Compatibility Note for Addi MCP Server:**
> Addi MCP Server uses this format (`action.yml`) to define MCP Tools.
> - **Inputs**: Mapped to MCP Tool arguments. Descriptions and required fields are respected.
> - **Runs**: `docker` and `composite` execution modes are supported.
> - **Shell**: Unlike standard GitHub Actions, the `shell` field is **optional**. 
>   - On **Windows**, it defaults to `powershell`.
>   - On **macOS/Linux**, it defaults to `bash`.
> - **Paths**: When using `${{ github.action_path }}`, it is recommended to wrap it in double quotes (e.g., `"${{ github.action_path }}/script.js"`) to handle spaces in file paths.
> - **Unsupported**: `pre`, `post`, `pre-if`, `post-if` hooks are currently ignored.

Docker container, JavaScript, and composite actions require a metadata file. The metadata filename must be either `action.yml` or `action.yaml`.

## name

Required. The name of your action. GitHub displays the `name` in the Actions tab to help visually identify actions in each job.

## author

Optional. The name of the action's author.

## description

Required. A short description of the action.

## inputs

Optional. Input parameters allow you to specify data that the action expects to use during runtime.

```yaml
inputs:
  num-octocats:
    description: 'Number of Octocats'
    required: false
    default: '1'
  octocat-eye-color:
    description: 'Eye color of the Octocats'
    required: true
```

### inputs.<input_id>
Required. A string identifier to associate with the input.

### inputs.<input_id>.description
Required. A string description of the input parameter.

### inputs.<input_id>.required
Optional. A boolean to indicate whether the action requires the input parameter.

### inputs.<input_id>.default
Optional. A string representing the default value.

## outputs

Optional. Output parameters allow you to declare data that an action sets.

### For Docker container and JavaScript actions

```yaml
outputs:
  sum: # id of the output
    description: 'The sum of the inputs'
```

### For composite actions

```yaml
outputs:
  random-number:
    description: "Random number"
    value: ${{ steps.random-number-generator.outputs.random-id }}
```

## runs

Required. Specifies whether this is a JavaScript action, a composite action, or a Docker container action and how the action is executed.

### JavaScript actions

```yaml
runs:
  using: 'node20'
  main: 'main.js'
  pre: 'setup.js'
  pre-if: runner.os == 'linux'
  post: 'cleanup.js'
  post-if: runner.os == 'linux'
```

- `using`: Required. The runtime used to execute the code (`node20`, `node16`).
- `main`: Required. The file that contains your action code.

### Composite actions

```yaml
runs:
  using: "composite"
  steps:
    - run: ${{ github.action_path }}/test/script.sh
      shell: bash
```

- `using`: Required. Set to `'composite'`.
- `steps`: Required. The steps that you plan to run in this action.

### Docker container actions

```yaml
runs:
  using: 'docker'
  image: 'Dockerfile' # or 'docker://image:tag'
  args:
    - ${{ inputs.greeting }}
  env:
    HELLO: world
```

- `using`: Required. Set to `'docker'`.
- `image`: Required. The Docker image to use.

## branding

Optional. You can use a color and Feather icon to create a badge.

```yaml
branding:
  icon: 'award'
  color: 'green'
```
