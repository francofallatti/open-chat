# OpenChat

Desktop chat panel for open models, built with Rust and Tauri 2 on top of the OpenCode engine. See [README.md](README.md), [ROADMAP.md](ROADMAP.md) and [DECISIONS.md](DECISIONS.md).

## Build the executable after code changes

When you finish a code change that needs a new build to be tried (anything under `src/` or `ui/`, `Cargo.toml`, `tauri.conf.json`, `capabilities/`), build the release executable so the user can test it:

```powershell
cargo build --release --features custom-protocol
```

The result is `target\release\openchat.exe`. Tell the user it is ready and what to try. Changes to documentation only do not need a build.

If the build fails because the file is in use, OpenChat is still open: ask the user to close it, then build again.

## Commits

- Written in English.
- Start with the type of work in brackets: `[FEAT]`, `[FIX]`, `[REFACTOR]`, `[DOCS]`, `[CHORE]`, `[TEST]`. Example: `[FIX] Keep read permission so free models answer`.
- The user reviews the work first. Commit and push only after they approve.
