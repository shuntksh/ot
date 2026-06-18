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

Append CLI-provided changed files to a command:

```json
{ "name": "lint", "cmd": "biome check", "changedFiles": "append" }
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
    "hardTimeoutSeconds": 30,
    "cache": true
  }
}
```

`hardTimeoutSeconds` is optional. When set, Ot kills the package script if it
runs longer than the configured number of seconds.

`changedFiles: "append"` appends package-scoped changed files to each package
script. `cache: true` enables local content-hash success caching for package
script invocations. Cache hits skip only when the script command, Bun version,
package inputs, relevant root inputs, and changed-file argv match a previous
successful run.

```json
{
  "name": "lint",
  "bun": {
    "script": "lint",
    "changedFiles": "append",
    "cache": {
      "inputs": ["src/**/*", "package.json"],
      "globalInputs": ["biome.jsonc"]
    }
  }
}
```

### Dependency syntax

- `^task` — Run task in all dependencies first
- `task` — Run task in current package first
- `pkg#task` — Run specific package's task first

## Nested `steps`

Group related steps under a parent step:

```json
{
  "name": "quality",
  "description": "Run quality checks",
  "parallel": false,
  "steps": [
    { "name": "format", "cmd": "bun run format" },
    { "name": "lint", "cmd": "bun run lint" },
    { "name": "test", "cmd": "bun test", "dependsOn": ["lint"] }
  ]
}
```

Nested steps are shown under the parent step in progress output. By default,
ready nested steps run in parallel. Set `parallel: false` to run one ready child
at a time using the order from `steps`, while still honoring `dependsOn`.
`pararell` is also accepted as a compatibility alias.
