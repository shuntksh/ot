---
title: Step Types
description: Available step types in Ot workflows
---

Ot supports several types of steps to define your workflow.

## `cmd`

Run a shell command:

```json
{ "name": "build", "cmd": "bun run build" }
```

`name` is the stable step id used by `dependsOn`. Add `displayName` when you want a friendlier label in progress output:

```json
{ "name": "typecheck", "displayName": "TypeScript", "cmd": "bun run typecheck" }
```

## `worktree:cp`

Copy files from another worktree:

```json
{
  "name": "sync",
  "worktree:cp": {
    "from": "main",
    "files": ["config.json", "secrets/"],
    "allowMissing": true
  }
}
```

## `bun`

Run scripts across workspace packages with dependency ordering (TurboRepo-style):

```json
{
  "name": "test",
  "bun": {
    "script": "test",
    "dependsOn": ["^build"],
    "hardTimeoutSeconds": 30
  }
}
```

`hardTimeoutSeconds` is optional. When set, Ot kills the package script if it
runs longer than the configured number of seconds.

### Dependency syntax

- `^task` — Run task in all dependencies first
- `task` — Run task in current package first
- `pkg#task` — Run specific package's task first
