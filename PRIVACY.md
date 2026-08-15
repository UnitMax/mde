# Privacy and Network Behavior

This document describes the privacy and network behavior of the released MDE application. It is an implementation summary, not a legal privacy policy.

## Summary

MDE is local-only for its own application traffic. The released application contains no telemetry, analytics, crash reporting, automatic update checks, or internet service connections.

The supported OpenCode data flow is:

```text
MDE --local HTTP/SSE--> OpenCode --provider connection--> model provider
```

MDE starts and communicates with OpenCode running on the same computer. OpenCode may then connect to cloud model providers; those provider connections belong to OpenCode, not MDE.

## What MDE stores locally

MDE stores workspace metadata in a local `workspace.json` file under Electron's user-data directory. This includes project paths, session metadata, selected OpenCode session IDs, and model selections.

Conversation transcripts are not sent to an MDE-owned service or stored in an MDE cloud account. OpenCode manages its own conversation data and provider credentials.

## Network behavior in the released application

### OpenCode communication

MDE uses HTTP requests and a Server-Sent Events stream to communicate with the OpenCode server:

- Native sessions use `127.0.0.1`.
- WSL sessions use the selected distro's local WSL address.
- Prompts, commands, session operations, model information, and streamed events pass through this local connection.

MDE does not connect directly to model providers. Its model-related communication is with the local OpenCode server.

## User-initiated external actions

MDE may open an external link in the system browser when the user explicitly clicks a link in an agent message. The browser then makes any resulting network connection. MDE does not automatically load those links.

MDE also provides terminal sessions and launches OpenCode as a local process. Commands entered by the user, and actions explicitly requested through OpenCode, may access the network. Those are user-directed child-process activities rather than automatic connections made by MDE.

## Scope of this statement

This local-only statement applies to MDE's supported release configuration. MDE cannot control a modified OpenCode executable or a compromised host operating system; network activity initiated by those external components is outside MDE's behavior and responsibility.

## Audit conclusion

The released MDE application has no hidden telemetry or automatic internet activity. MDE's own application traffic is limited to communicating with the local OpenCode server. OpenCode's provider traffic, explicit browser-link clicks, and user terminal commands are separate, user-directed or external-component activities outside MDE's own network behavior.
