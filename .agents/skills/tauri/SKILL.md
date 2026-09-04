---
name: tauri
description: Tauri v2 domain knowledge — IPC commands and events, capabilities and permissions, CSP, plugins, window/webview management, bundling, code signing, and updater. Use when working in a Tauri project, wiring Rust backend to a web frontend, configuring tauri.conf.json, or debugging a Tauri build. Reference material only; it does not drive planning, TDD, or review workflow.
---

# Tauri

Domain knowledge for Tauri v2. This skill answers *what is true about Tauri*. It does
not decide *how you work* — planning, TDD, debugging method, and review belong to the
process skills, and this skill never overrides them.

Load only what the current question needs. Every file below is a standalone reference;
grep it rather than reading it end to end.

## Architecture in one pass

Two processes. The **Core** process is Rust: it owns the event loop, windows, and every
privileged capability. The **WebView** process renders your frontend and is treated as
untrusted. They exchange messages only through IPC.

IPC has two directions with different shapes:

- **Commands** — frontend calls Rust and awaits a result. Request/response, typed,
  invoked via `invoke()`. This is the workhorse.
- **Events** — fire-and-forget notifications in either direction. No return value. Use
  for progress, file-watch notifications, and lifecycle signals.

Everything a command can reach is gated by the **capability** system: a command is
callable from a given window only if a capability grants that window the matching
permission. Capabilities live in `src-tauri/capabilities/`, are JSON, and default to
denying. This is the security model — not an add-on to it.

## Reference map

| Question | File |
|---|---|
| Scaffolding a new app, prerequisites, first run | `references/getting_started.md` |
| Process model, IPC internals, architecture, debugger setup | `references/core_concepts.md` |
| Dev workflow, debugging, devtools, mobile plugin dev | `references/development.md` |
| Bundling, installers, code signing, notarization, CI | `references/distribution.md` |
| Using and authoring plugins | `references/plugins.md` |
| `tauri.conf.json` schema, CLI, JS and Rust APIs | `references/reference.md` |
| Capabilities, permissions, CSP, updater signing | `references/security.md` |
| End-to-end walkthroughs | `references/tutorials.md` |
| State management, migration, Linux packaging, WebDriver | `references/other.md` |

Security depth, beyond what the official docs cover:

| Question | File |
|---|---|
| Concrete hardened implementations, CVE case studies | `references/security-examples.md` |
| STRIDE analysis, attack scenarios, trust boundaries | `references/security-threat-model.md` |
| Advanced IPC, plugin, and updater patterns | `references/advanced-patterns.md` |

`other.md` is large and grab-bag; always grep it for a heading rather than reading it.

## Facts worth knowing before you look anything up

**Commands are registered explicitly.** A `#[tauri::command]` function does nothing
until it appears in the `invoke_handler` list in your builder. Forgetting this is the
single most common "my command doesn't exist" error.

**Async commands must return `Result`.** A non-`Result` async command silently loses
errors across the IPC boundary.

**Capabilities deny by default.** A newly scaffolded app cannot read the filesystem.
Adding the `fs` plugin is not sufficient — you also grant scoped permissions in a
capability file. Scope patterns are glob-based and are enforced in Rust, not JS.

**The CSP is real and it is strict.** Tauri injects a CSP that blocks inline scripts and
remote origins unless configured. Frontend bundlers that inject inline style or script
tags will break in a release build while working fine in dev.

**State is shared via `tauri::State`.** Managed state is registered with `.manage()` and
injected into commands by type. Interior mutability is your problem — a `Mutex` or
`RwLock` around the inner value is the normal pattern.

**Dev and release behave differently.** The dev build runs the frontend from a dev
server; release embeds assets. Path resolution, CSP violations, and asset loading bugs
routinely appear only in release. Test a release bundle before believing anything works.

**Platform differences are load-bearing.** macOS uses WKWebView, Windows uses WebView2,
Linux uses WebKitGTK. Rendering, font, and CSS behaviour genuinely differ between them,
and Linux is the usual source of surprises. Signing and notarization are entirely
platform-specific — see `distribution.md`.

## Working on a markdown editor specifically

Relevant because rendering and file access are the two hot paths:

- Rendering markdown in Rust (`pulldown-cmark` / `comrak`) and passing HTML over IPC
  moves work off the main thread but costs a serialization round trip per keystroke if
  done naively. Rendering in the webview keeps it local but ships a JS parser.
  Either is defensible; measure before committing.
- Mermaid is a JS library and must run in the webview. It cannot be rendered in Rust.
- File watching belongs in Rust, pushed to the frontend as events.
- Filesystem scope for an editor that opens arbitrary user directories cannot be
  statically globbed at build time. Look at runtime scope extension in `security.md`
  before designing the file browser.
