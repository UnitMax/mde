# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript Electron application. Keep process boundaries explicit:

- `src/main/` owns filesystem access, `node-pty`, WSL commands, and OpenCode processes.
- `src/preload/` exposes the minimal typed `contextBridge` API; do not add Node access to the renderer.
- `src/renderer/` contains the React UI, Zustand workspace state, terminal views, and components.
- `src/shared/` contains IPC channel names and payload types shared by both sides.
- `test/` contains Vitest tests (`*.test.ts`); `scripts/` contains maintenance scripts; `docs/` contains project documentation.

Use the existing `@/` and `@shared/` aliases. Place UI primitives under `src/renderer/components/ui/` and domain logic beside its feature.

## Build, Test, and Development Commands

Run `npm install` after checkout to rebuild native `node-pty`.

- `npm run dev` — start Electron through electron-vite.
- `npm test` — run the Vitest suite once; use `npm run test:watch` while developing.
- `npm run typecheck` — run strict Node/web TypeScript checks.
- `npm run compile` — bundle the Electron application without packaging.
- `npm run build` — validate notices, typecheck, bundle, and package for the current platform.
- `npm run licenses:check` — verify `THIRD_PARTY_NOTICES.md` matches the lockfile.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, no semicolons, and trailing commas for multiline syntax. Prefer small, strict functions and typed IPC contracts. Use `PascalCase` for React components/types, `camelCase` for functions/variables, and the existing descriptive naming pattern for test files. No standalone lint or formatter is configured; rely on nearby code, typecheck, and tests.

## Testing Guidelines

Vitest runs Node-environment tests matched by `test/**/*.test.ts`. Name tests after the behavior or module under test (for example, `wsl.test.ts`). Add focused regression coverage for launch, path, parsing, validation, IPC, and workspace changes; run `npm test` and `npm run typecheck` before submitting.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, sentence-style subjects (for example, `Preserve ANSI terminal colors`). Keep commits focused. Pull requests should explain the user-visible change, implementation impact, and verification commands; include screenshots for UI changes and note Windows/WSL testing. Update documentation or third-party notices when affected.

Run `npm run audit:package` before every commit. It deletes the electron-builder debug dumps that record absolute build-machine paths (`dist/builder-debug.yml`, `dist/builder-effective-config.yaml`) and fails when a home directory, project root, or user profile path leaked into the packaged output, in either UTF-8 or UTF-16. It audits whatever `dist/` currently holds and reports that there is nothing to audit when the directory is absent, so it is safe to run on a working tree that has never been packaged. The same audit runs automatically at the end of every `npm run build*` script.

## Versioning

The application version is authoritative in `package.json` and must stay synchronized with `package-lock.json`. The initial version is `0.0.1`. Increase the patch version by `0.0.1` once when preparing each commit unless the user explicitly says otherwise; do not increase it merely because a task changes files, and do not increase it again when committing a version that was already bumped for that commit. The About dialog must display this same package version.

## Security & Configuration Tips

Keep `contextIsolation` and renderer sandboxing intact. Validate WSL/process arguments and never log credentials or session data. Do not commit workspace state, build artifacts, or secrets.
