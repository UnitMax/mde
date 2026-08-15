# OpenCode slash commands in MDE

## Overview

OpenCode does not publish command-usage telemetry, so this is a practical ranking based on likely developer frequency, user impact, implementation effort, and fit with MDE's GUI. OpenCode's current TUI command list is documented at [opencode.ai/docs/tui](https://dev.opencode.ai/docs/tui/).

MDE already provides native GUI equivalents for `/models`, `/sessions`, `/resume`, `/continue`, `/new`, `/clear`, `/undo`, and `/redo`. Those should not be duplicated in the first slash-command implementation.

## First implementation draft

The first draft intentionally supports only:

1. `/compact` (alias: `/summarize`) — compact the current OpenCode session.
2. `/init` — analyze the project and create or update `AGENTS.md`.

Both commands have dedicated OpenCode server endpoints. MDE will invoke those endpoints using the currently selected model and then reload the authoritative conversation history. See the [OpenCode server API](https://dev.opencode.ai/docs/server/).

Sharing, unsharing, custom command discovery, and custom command execution are explicitly outside this first draft.

## Command analysis

| Command(s) | Impact | Ease | MDE assessment |
| --- | --- | --- | --- |
| `/models` | High | Complete | Already supported by the model picker. |
| `/sessions`, `/resume`, `/continue` | High | Complete | Already supported by the conversation selector. |
| `/new`, `/clear` | High | Complete | Already supported by the new-conversation action. |
| `/undo`, `/redo` | High | Complete | Already supported by the rollback controls. |
| `/compact`, `/summarize` | High | Easy–medium | First implementation target; OpenCode exposes `/session/:id/summarize`. |
| `/init` | High | Easy–medium | First implementation target; OpenCode exposes `/session/:id/init`. |
| `/help` | Medium | Easy | A future native MDE help dialog could document supported commands. |
| `/thinking`, `/details` | Medium | Easy | Future local GUI visibility toggles for reasoning and tool details. |
| `/export` | Medium | Easy–medium | Future native Markdown export using the rendered transcript. |
| `/themes` | Low | Medium–hard | TUI themes do not map cleanly to MDE's own visual system. |
| `/editor` | Low | Medium | MDE already provides a multiline chat editor. |
| `/connect` | Low–medium | Hard | Provider authentication is platform- and browser-dependent. |
| `/exit` | Low | Not applicable | MDE owns the application lifecycle rather than OpenCode's TUI lifecycle. |

## Implementation constraints

- Recognized commands must not be sent as ordinary prompts.
- Ordinary prompts continue using the existing message flow.
- The command action must respect the existing busy, permission, streaming, error, and session-status behavior.
- The selected model is passed to OpenCode for `/compact`, `/summarize`, and `/init`.
- Unknown or unsupported slash input must remain visible in the composer and produce an error instead of silently reaching the model.

## Future candidates

OpenCode also supports `/share` and `/unshare`, plus project and global custom commands. They are intentionally deferred because sharing publishes conversation data and custom commands require a broader command-discovery and argument-execution design. OpenCode documents custom commands separately at [opencode.ai/docs/commands](https://opencode.ai/docs/commands/) and sharing at [dev.opencode.ai/docs/share](https://dev.opencode.ai/docs/share/).
