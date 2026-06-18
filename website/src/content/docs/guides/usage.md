---
title: Usage
description: Basic usage of Ot CLI
---

Run a job defined in your workflow configuration:

```sh
ot <job-name> [options]
```

## Options

| Flag | Description |
|------|-------------|
| `-j, --job <name>` | Job name to run (can also be positional) |
| `-c, --config <path>` | Custom config file path |
| `--graph` | Print execution graph without running |
| `--changed-files [files...]` | Consume remaining args as changed files for hook integrations |
| `--changed-file <path>` | Add one changed file (repeatable) |
| `--fail-fast` | Stop on first failure (default: true) |
| `-v, --verbose` | Show command output |
| `--no-color` | Disable colored output |
| `--version` | Show version |
| `-h, --help` | Show help |

## Worktree Management

You can also manage worktrees directly from the CLI:

```sh
ot wt <command> [options]
```

| Command | Description |
|---------|-------------|
| `add` | Create a new worktree (and optionally a new branch) |
| `remove` | Remove a worktree (and optionally delete its branch) |
| `list` | List managed worktrees |

See the [Worktree Management](/ot/guides/worktree-management/) guide for more details.

## Changed Files

Use `--changed-files` with hook runners that append file templates:

```yaml
pre-commit:
  commands:
    lint:
      run: ot pre-commit --changed-files {staged_files}
```

Steps can read `OT_CHANGED_FILES`, `OT_CHANGED_FILES_JSON`, and
`OT_CHANGED_FILES_COUNT`. Set `changedFiles: "append"` on a step or Bun action
to append those files as command arguments.
