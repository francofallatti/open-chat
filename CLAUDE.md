# OpenChat

Desktop chat panel for open models, built with Rust and Tauri 2 on top of the OpenCode engine. See [README.md](README.md), [ROADMAP.md](ROADMAP.md) and [DECISIONS.md](DECISIONS.md).

## Canary

Start each answer with the name "Fran"

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

## Interface work

Three skills in `.claude/skills/` filter generic interface output: `antislop` (the rules), `antislop-ui` (visual and layout) and `antislop-human` (contrast, keyboard, focus). They come from [anti-slop](https://github.com/miqdadbadjuber/anti-slop) and stay off unless this section turns them on.

- When a change adds or edits anything the person sees in `ui/` (markup, styles, texts, behaviour of a control), load the three skills before writing, and tell the user in one line that they are active. Do not wait for an answer.
- Do not load them for anything else: Rust code, tests, documentation, or a change in `ui/app.js` that does not alter what is shown.
- The mode is already chosen, so do not ask it: `during` for a change, `after` only when the user asks for an audit of the existing interface. The findings of an audit go in [UI-AUDIT.md](UI-AUDIT.md), numbered; tick each one in the pull request that fixes it.
- The design direction they need is in `DESIGN.md`. If it does not exist yet, say so and write it with the user before a visual change.
- Check every colour pair with `python .claude/skills/antislop-human/contrast-check.py "#text" "#background"` instead of judging by eye.
- To update the skills, copy the three folders again from the repository and review the difference. Do not run its installer: it adds a block to this file that loads the rules in every session.

## Commits

- Written in English.
- Start with the type of work in brackets: `[FEAT]`, `[FIX]`, `[REFACTOR]`, `[DOCS]`, `[CHORE]`, `[TEST]`. Example: `[FIX] Keep read permission so free models answer`.
