---
title: Configuration
description: Configuring Ot workflows and worktrees
---

Config is discovered from (in order):

1. Custom path via `--config`
2. `workflow.json` or `workflow.jsonc` in git root
3. `.config/workflow.json` or `.config/workflow.jsonc`
4. `workflows` field in `package.json`

## Example Workflow

```jsonc
// package.json
{
  "workflows": {
    "build": {
      "steps": [
        { "name": "install", "displayName": "Install dependencies", "cmd": "bun install --frozen-lockfile" },
        { "name": "build", "bun": { "script": "build" }, "dependsOn": ["install"] }
      ]
    },
    "sync-config": {
      "steps": [
        {
          "name": "copy-from-main",
          "branches": ["worktree:*", "!main"],
          "worktree:cp": {
            "from": "worktree:main",
            "files": [".config/settings.json",".env"],
            "allowMissing": true
          }
        }
      ]
    },
    "test-all": {
      "steps": [
        {
          "name": "test",
          "bun": {
            "script": "test",
            "dependsOn": ["^build"],
            "parallel": 5,
            "hardTimeoutSeconds": 60
          }
        }
      ]
    },
    "quality": {
      "steps": [
        {
          "name": "checks",
          "description": "Run local checks",
          "parallel": false,
          "steps": [
            { "name": "format", "cmd": "bun run format" },
            { "name": "lint", "cmd": "bun run lint", "dependsOn": ["format"] },
            { "name": "test", "cmd": "bun test", "dependsOn": ["lint"] }
          ]
        }
      ]
    }
  }
}
```

Nested `steps` group related substeps under one parent in the progress output.
Ready substeps run in parallel by default. Set `parallel: false` to run one
ready child at a time in the order from `steps`, while still honoring
`dependsOn`. Outside the parent group, address a nested step as `parent.child`.
`pararell` is also accepted as a compatibility alias.

Workspace `bun` actions also support `parallel` to control package-script
concurrency inside each dependency layer. Omit it or set `parallel: true` for
the default limit of 5, set a positive integer for a custom limit, set
`parallel: false` to run package scripts sequentially, or set `parallel: -1` to
run every ready package script in the current dependency layer at once.
`pararell` is accepted as an alias.

## Worktree Configuration

Configure worktree defaults and hooks in the `worktree` section of your config:

```jsonc
{
  "worktree": {
    "defaults": {
      "base_dir": "../worktrees" // Relative to git root
    },
    "hooks": {
      "post_create": [
        {
          "type": "copy",
          "from": ".env",
          "to": ".env"
        },
        {
          "type": "command",
          "command": "bun install"
        }
      ]
    }
  }
}
```
