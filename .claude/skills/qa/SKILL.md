---
name: qa
description: Check that an OpenChat branch is stable before it is merged into main. Builds the executable, runs the unit tests and the end-to-end suite against the real app, and reports a verdict. Use for "/qa", "run QA", "corré QA sobre la rama X", "probar la rama", "correr la suite", "¿está estable?", or before merging any pull request. To write missing cases use the qa-cases skill instead.
argument-hint: "[branch] [rapido | CASE-ID | area]"
---

# QA for an OpenChat branch

You are the QA session. Your job is to say whether a branch can be merged into `main`, with evidence. You do not fix the code under test and you do not write cases here: you report. Writing cases is the `qa-cases` skill.

Read [TESTING.md](../../../TESTING.md) first. It explains how the suite works.

## What to run

Arguments: `$ARGUMENTS`

| Arguments | Run | Result |
| --- | --- | --- |
| none, or only a branch | Full gate: build, unit tests, every end-to-end case | A verdict |
| `rapido` | Build, unit tests, `npm run test:rapido` (no case that calls a model) | No verdict: say the `@modelo` cases did not run |
| a case id (`CHAT-002`) or an area prefix (`SES`) | Build, then `npx playwright test -g "<text>"` | No verdict: say which cases ran |

Only the full gate can end in PASSED. A partial run is for quick feedback while developing.

The branch is the one named in the arguments. With none, use the branch of the open pull request the user means, or ask which one.

## Steps

1. **Get the branch.** Work in your own worktree, never in the user's checkout. Check out the branch under test and note its commit.

2. **Build.** The suite tests `target\release\openchat.exe` of the worktree you are in.

   ```powershell
   cargo build --release --features custom-protocol
   ```

   A build error is a failed QA run: report it and stop.

3. **Unit tests.**

   ```powershell
   cargo test
   ```

4. **End-to-end suite.**

   ```powershell
   cd e2e
   npm install
   npm test
   ```

   The suite opens real OpenChat windows, one at a time. It uses its own data folder, so it is safe to run while the user has OpenChat open.

5. **Read every failure before reporting it.** For each failed case, open its screenshot and `server.log` in `e2e\test-results\`, and decide which of these it is:

   - **Defect in the app.** The window shows the wrong thing. This blocks the merge.
   - **Provider problem.** An `@modelo` case failed with `quota`, `rate_limit`, `network` or `unavailable`. Run that case again once. If it fails the same way, report it as not verified, not as passed.
   - **Defect in the test.** The app is right and the case is wrong or outdated. Say so; do not edit the case to make it pass.

6. **Check the new work has cases.** Read the branch's diff against `main`. A new feature needs a new end-to-end case; a bug fix needs the case that reproduces it. If one is missing, list it and point to `/qa-cases`. Missing cases block PASSED.

7. **Explore what the suite does not cover.** If the change touches something listed under "Pendientes de automatizar" in TESTING.md, or something with no case yet, drive the app yourself over the same debugging port and look at screenshots.

8. **Clean up.** No `openchat.exe` or `opencode-cli.exe` you started may be left running. Close the app with its process tree (`taskkill /PID <pid> /T /F`), or the engine stays behind. Do not close processes you did not start.

## Report

Post it as a comment on the pull request if you can; otherwise give it to the user. Lead with the verdict.

```
QA: PASSED | FAILED | NOT VERIFIED | PARTIAL
Branch feat/... at <commit>

Build: ok
Unit tests: 15 passed
End to end: 16 passed, 1 failed

Failed
- CHAT-002 ... : <what the window showed, in one line>. <app defect | provider | test defect>

Missing cases
- <feature with no case, or "none">

Explored by hand
- <what you tried and what you saw, or "nothing">
```

- **PASSED** only when the full gate ran, everything passed and no case is missing.
- **NOT VERIFIED** when the only failures are provider problems that survived a retry.
- **PARTIAL** for `rapido` or a filtered run: say what ran and what did not.
- State what you ran. Never report a case as passed if it did not run.
