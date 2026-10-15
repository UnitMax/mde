# Privacy and Network Behavior

This document describes the privacy and network behavior of the released MDE application. It is an implementation summary, not a legal privacy policy.

## Summary

MDE is local-only for its own application traffic. The released application contains no telemetry, analytics, crash reporting, automatic update checks, or internet service connections.

## What MDE stores locally

MDE stores data only on the local machine:

- `workspace.json` under Electron's user-data directory: project labels, terminal session names,
  paths, platform and distro details, shell overrides, tab and terminal layout, and To Do projects
  with their task titles and descriptions.
- The renderer's local storage (`mde.terminal-settings`): appearance and terminal preferences,
  including the executable and argument strings configured for the shell, OpenCode, Codex and
  Claude launchers. Any secret typed into an argument string is stored there in plain text.
- The renderer's local storage (`mde.markdown-preview-width`): whether the Markdown preview is a
  centered column or fills the page (the word `centered` or `full`).
- Small preference files in the user-data directory for the OpenCode status integration and
  notifications.
- If you enable the optional OpenCode integrations, a short status snapshot under
  `/tmp/mde-opencode` in the WSL distro, or a private `mde-opencode` directory under the
  macOS user temporary directory (state, current session title, timestamps, and a process ID
  with its start identity; never prompts, messages or tool data), plus the plugin files MDE installs into the target's OpenCode
  configuration directory (`plugins/mde-status/`). The plugin runs inside the OpenCode terminal
  process and edits no OpenCode configuration file. Disabling an integration does not uninstall
  its plugin.
  On Mac the snapshot directory is accessible only by the current user (0700), with files
  restricted to that user (0600). MDE removes snapshots when terminals close and matching
  artifacts older than 24 hours on startup. Abrupt termination may leave these temporary files.

MDE does not copy file contents or terminal output into any of these. Terminal scrollback is held
in memory only. The OpenCode session picker asks the configured OpenCode executable for session metadata on demand
(`opencode api`, which reads OpenCode's own local background service: session
titles, directories, models, token usage and cost) and keeps the result in memory only. The query output passes through a private temporary file on the native Mac host or in the distro, which is deleted when the query ends.

## Network behavior in the released application

MDE does not make automatic network requests. It reads local files and invokes local commands to support terminal sessions and file actions: Git for repository status, `wsl.exe` on Windows, and the configured OpenCode executable for the session picker.

MDE also disables Chromium's DNS-over-HTTPS upgrade at startup, with `app.configureHostResolver({ secureDnsMode: 'off' })`. Chromium's default mode would otherwise route name resolution through a DoH provider whenever the system resolver is a recognized one, without any application code asking it to. Because MDE resolves no hostnames of its own, the result is no DNS traffic rather than a fallback to plaintext DNS, and the statement above holds regardless of how the user's machine is configured to resolve names.

On Mac MDE also reads integration-related environment values through the user's login shell and
uses `/bin/ps` to check OpenCode process liveness. Shell startup configuration can execute
user-configured commands, as it does in normal terminal sessions.

## User-initiated external actions

MDE may open an external link in the system browser when the user explicitly activates a terminal link. The browser then makes any resulting network connection. MDE does not automatically load those links.

Commands entered by the user in a terminal, including commands run through third-party terminal applications, may access the network. Those are user-directed child-process activities rather than automatic connections made by MDE.

## Scope of this statement

This local-only statement applies to MDE's supported release configuration. MDE cannot control commands launched by the user or a compromised host operating system; network activity initiated by those external components is outside MDE's behavior and responsibility.

## Audit conclusion

The released MDE application has no hidden telemetry or automatic internet activity. Explicit browser-link clicks and user terminal commands are separate, user-directed activities outside MDE's own network behavior.
