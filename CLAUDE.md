# OpenChat

Desktop chat panel for open models, built with Rust and Tauri 2 on top of the OpenCode engine. See [README.md](README.md), [ROADMAP.md](ROADMAP.md) and [DECISIONS.md](DECISIONS.md).

## Build the executable after code changes

When you finish a code change that needs a new build to be tried (anything under `src/` or `ui/`, `Cargo.toml`, `tauri.conf.json`, `capabilities/`), build the release executable so the user can test it:

```powershell
cargo build --release --features custom-protocol
```

The result is `target\release\openchat.exe`. Tell the user it is ready and what to try. Changes to documentation only do not need a build.

If the build fails because the file is in use, OpenChat is still open: ask the user to close it, then build again.

## Branches and pull requests

- `main` is production. Never commit or push to it directly. Releases are tags on `main`.
- Work happens on a branch taken from `main`: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
- Commit and push to those branches without asking. Then open a pull request against `main`.
- The user approves by merging. Only the user merges, and only when the test suite passed on that branch.

## Tests

How the suite works and how to write a case: [TESTING.md](TESTING.md).

- Every new feature comes with its end-to-end case in `e2e/tests/`. Every bug fix comes with the case that reproduces it.
- The session that writes the code does not run QA. Before opening a pull request, run only the end-to-end cases you wrote or changed (`npx playwright test -g "<ID>"` in `e2e/`), and `cargo test` if you touched Rust code. Do not run the full suite or `/qa`: a separate QA session does that on the pull request. Say in the pull request what ran and that the full suite is pending QA.
- Two skills live in `.claude/skills/`:
  - `/qa [branch]` decides whether a branch can be merged: build, unit tests, full suite, verdict. `/qa rapido` and `/qa CHAT-002` run part of it for quick feedback, with no verdict.
  - `/qa-cases [branch]` finds the cases a branch is missing, writes them and runs only those.

## Commits

- Written in English.
- Start with the type of work in brackets: `[FEAT]`, `[FIX]`, `[REFACTOR]`, `[DOCS]`, `[CHORE]`, `[TEST]`. Example: `[FIX] Keep read permission so free models answer`.
