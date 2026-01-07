# GitHub Actions 的工作流语法

> Source: [https://docs.github.com/zh/actions/reference/workflows-and-actions/workflow-syntax](https://docs.github.com/zh/actions/reference/workflows-and-actions/workflow-syntax)

> **Compatibility Note for Addi MCP Server:**
> This document describes the syntax for GitHub Actions *Workflows* (`.github/workflows/*.yml`).
> Addi MCP Server currently uses **Action Metadata** (`action.yml`) to verify/load tools, not Workflow files.
> This document is provided for reference context, as many concepts (like `run` steps, `env`, expression syntax) are shared between Workflows and Composite Actions.

## About YAML syntax for workflows

Workflow files use YAML syntax, and must have either a `.yml` or `.yaml` file extension. If you're new to YAML and want to learn more, see [Learn YAML in Y minutes](https://learnxinyminutes.com/docs/yaml/).

You must store workflow files in the `.github/workflows` directory of your repository.

## name

The name of the workflow. GitHub displays the names of your workflows under your repository's "Actions" tab. If you omit `name`, GitHub displays the workflow file path relative to the root of the repository.

## run-name

The name for workflow runs generated from the workflow. GitHub displays the workflow run name in the list of workflow runs on your repository's "Actions" tab.

This value can include expressions and can reference the `github` and `inputs` contexts.

## on

Required. The name of the GitHub event that triggers the workflow. You can provide a single event string, array of events, array of event types, or an event configuration map that restricts the execution of a workflow to specific files, tags, or branch changes.

### Example: Using a single event

```yaml
on: push
```

### Example: Using a list of events

```yaml
on: [push, pull_request]
```

### Example: Using activity types

```yaml
on:
  label:
    types: [created, edited]
```

## on.<push|pull_request>.<branches|tags>

```yaml
on:
  push:
    branches:
      - main
      - 'releases/**'
    tags:
      - v2
      - v1.*
```

## on.workflow_dispatch

To manually trigger a workflow.

```yaml
on:
  workflow_dispatch:
    inputs:
      logLevel:
        description: 'Log level'
        required: true
        default: 'warning'
        type: choice
        options:
        - info
        - warning
        - debug
```

## jobs

A workflow run is made up of one or more `jobs`, which run in parallel by default. To run jobs sequentially, you can define dependencies on other jobs using the `jobs.<job_id>.needs` keyword.

### jobs.<job_id>

Use `jobs.<job_id>` to give your job a unique identifier.

### jobs.<job_id>.runs-on

Required. The type of machine to run the job on.

- `ubuntu-latest`, `ubuntu-22.04`
- `windows-latest`
- `macos-latest`
- `self-hosted`

### jobs.<job_id>.steps

A job contains a sequence of tasks called `steps`. Steps can run commands, run setup tasks, or run an action.

```yaml
jobs:
  my-job:
    runs-on: ubuntu-latest
    steps:
      - name: Print a greeting
        env:
          MY_VAR: Hi there!
        run: echo $MY_VAR
```

### jobs.<job_id>.steps[*].uses

Selects an action to run as part of a step in your job.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
```

### jobs.<job_id>.steps[*].run

Runs command-line programs using the operating system's shell.

```yaml
- name: Install Dependencies
  run: npm install
```

### jobs.<job_id>.steps[*].with

A map of the input parameters defined by the action.

### jobs.<job_id>.needs

Identifies any jobs that must complete successfully before this job will run.

```yaml
jobs:
  job1:
  job2:
    needs: job1
  job3:
    needs: [job1, job2]
```

## permissions

You can use `permissions` to modify the default permissions granted to the `GITHUB_TOKEN`.

```yaml
permissions:
  actions: read|write|none
  checks: read|write|none
  contents: read|write|none
  deployments: read|write|none
  issues: read|write|none
  packages: read|write|none
  pull-requests: read|write|none
  repository-projects: read|write|none
  security-events: read|write|none
  statuses: read|write|none
```

## env

A map of variables that are available to the steps of all jobs in the workflow.

## defaults

Use `defaults` to create a map of default settings that will apply to all jobs in the workflow.

```yaml
defaults:
  run:
    shell: bash
    working-directory: ./scripts
```

## concurrency

Ensure that only a single job or workflow using the same concurrency group will run at a time.

```yaml
concurrency:
  group: ${{ github.ref }}
  cancel-in-progress: true
```
