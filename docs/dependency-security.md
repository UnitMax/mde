# Dependency security maintenance

Run `npm run audit:deps` against the full lockfile after dependency changes and
before releases. Renderer libraries such as Mermaid are bundled into the app
even though they are declared as development dependencies, so a production-only
audit does not cover all shipped code.

The lockfile includes patched `http-cache-semantics` 4.3.0 and `source-map-js`
1.2.2. These updates remain within their parents' existing dependency ranges.

Two scoped overrides address advisories while preserving the current direct
dependency versions:

| Override | Reason | Removal condition |
| --- | --- | --- |
| Mermaid → KaTeX 0.18.2 | Fixes [inherited trust options](https://github.com/advisories/GHSA-238p-pmpm-9mq7). Mermaid's declared 0.16.x range excludes the fix. | Mermaid adopts a patched KaTeX release. |
| @electron/get → global-agent 4.1.3 | Removes the roarr → sprintf-js chain affected by [unbounded formatting precision](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). global-agent 4 no longer depends on roarr and retains the downloader's `bootstrap()` API. | Electron builder's downloader adopts a version without the vulnerable chain. |

`test/mermaid-runtime.test.ts` exercises real diagram rendering, Mermaid's math
integration, and rejection of inherited KaTeX trust options. The math integration
test enables HTML labels only in its isolated test configuration; the app keeps
HTML labels disabled and sanitizes diagram SVGs.
`test/dependency-security.test.ts` exercises Electron builder's actual downloader
in a child process with a local HTTP proxy and with `NO_PROXY` bypass, without
changing the test runner's global HTTP agents.

When updating these overrides, rerun those tests, the full test suite, typecheck,
compilation, the dependency audit, and the Windows build. Regenerate third-party
notices with `npm run licenses` when shipped dependencies change. Avoid blindly
applying `npm audit fix --force`: its proposed major-version changes can downgrade
the direct build and diagram dependencies.
