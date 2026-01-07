# Creating a composite action

> Source: [https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action)

> **Compatibility Note for Addi MCP Server:**
> Addi MCP Server supports the `action.yml` format for defining tools, but executes them with a lightweight internal runner.
> - **Inputs**: Supported and mapped to environment variables (`INPUT_NAME`).
> - **Runs**: `using: "composite"` and `using: "docker"` are supported.
> - **Steps**: `run` steps are supported. The `shell` field can be omitted to use the system default (PowerShell on Windows, Bash on Unix).
> - **Paths**: Always use double quotes around `${{ github.action_path }}` to ensure compatibility with paths containing spaces.
> - **Unsupported**:
>   - `uses`: You cannot reference other actions (e.g., `actions/checkout`) in a composite step currently.
>   - `GITHUB_OUTPUT` / `GITHUB_ENV`: Standard output (stdout) is returned as the tool result. Parsing logic for these files is present but behavior may vary.

Composite actions allow you to collect a series of workflow job steps into a single action which you can then run as a single job step in multiple workflows.

## Creating an action metadata file

Create a new file called `action.yml` in your repository.

```yaml
name: 'Hello World'
description: 'Greet someone'
inputs:
  who-to-greet:  # id of input
    description: 'Who to greet'
    required: true
    default: 'World'
outputs:
  random-number:
    description: "Random number"
    value: ${{ steps.random-number-generator.outputs.random-number }}
runs:
  using: "composite"
  steps:
    - name: Set Greeting
      run: echo "Hello $INPUT_WHO_TO_GREET."
      shell: bash
      env:
        INPUT_WHO_TO_GREET: ${{ inputs.who-to-greet }}

    - name: Random Number Generator
      id: random-number-generator
      run: echo "random-number=$(echo $RANDOM)" >> $GITHUB_OUTPUT
      shell: bash

    - name: Set GitHub Path
      run: echo "$GITHUB_ACTION_PATH" >> $GITHUB_PATH
      shell: bash
      env:
        GITHUB_ACTION_PATH: ${{ github.action_path }}

    - name: Run goodbye.sh
      run: goodbye.sh
      shell: bash
```

## Testing out your action in a workflow

```yaml
on: [push]

jobs:
  hello_world_job:
    runs-on: ubuntu-latest
    name: A job to say hello
    steps:
      - uses: actions/checkout@v4
      - id: foo
        uses: ./.github/actions/hello-world-composite-action
        with:
          who-to-greet: 'Mona the Octocat'
      - run: echo random-number "$RANDOM_NUMBER"
        shell: bash
        env:
          RANDOM_NUMBER: ${{ steps.foo.outputs.random-number }}
```
