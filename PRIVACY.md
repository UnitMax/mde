# Privacy and Network Behavior

This document describes the privacy and network behavior of the released MDE application. It is an implementation summary, not a legal privacy policy.

## Summary

MDE is local-only for its own application traffic. The released application contains no telemetry, analytics, crash reporting, automatic update checks, or internet service connections.

## What MDE stores locally

MDE stores workspace metadata in a local `workspace.json` file under Electron's user-data directory. This includes project labels, terminal session paths, platform details, appearance settings, and terminal layout.

## Network behavior in the released application

MDE does not make automatic network requests. It reads local files and, on Windows, invokes local WSL and operating-system commands to support terminal sessions and file actions.

## User-initiated external actions

MDE may open an external link in the system browser when the user explicitly activates a terminal link. The browser then makes any resulting network connection. MDE does not automatically load those links.

Commands entered by the user in a terminal, including commands run through third-party terminal applications, may access the network. Those are user-directed child-process activities rather than automatic connections made by MDE.

## Scope of this statement

This local-only statement applies to MDE's supported release configuration. MDE cannot control commands launched by the user or a compromised host operating system; network activity initiated by those external components is outside MDE's behavior and responsibility.

## Audit conclusion

The released MDE application has no hidden telemetry or automatic internet activity. Explicit browser-link clicks and user terminal commands are separate, user-directed activities outside MDE's own network behavior.
