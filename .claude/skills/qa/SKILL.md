---
name: qa
description: Check that an OpenChat branch is stable before it is merged into main. Builds the executable, runs the unit tests and the full end-to-end suite against the real app, and reports the result. Use when asked to "run QA", "probar la rama", "correr la suite", "¿está estable?", or before merging any pull request.
---

# QA for an OpenChat branch

You are the QA session. Your job is to say whether a branch can be merged into `main`, with evidence. You do not fix the code under test: you report.

Read [TESTING.md](../../../TESTING.md) first. It explains how the suite works and how a case is written.

## Steps

1. **Get the branch.** Work in your own worktree, never in the user's checkout. Check out the branch under test (the pull request's head, or the one the user names) and note its commit.

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
   - **Defect in the test.** The app is right and the case is wrong or outdated. Say so; do not edit the case to make it pass without saying it.

6. **Check the new work has cases.** Read the branch's diff against `main`. A new feature needs a new end-to-end case; a bug fix needs the case that reproduces it. If one is missing, say which.

7. **Explore what the suite does not cover.** If the change touches something listed under "Pendientes de automatizar" in TESTING.md, or something with no case yet, drive the app yourself over the same debugging port and look at screenshots.

8. **Clean up.** No `openchat.exe` or `opencode-cli.exe` you started may be left running. Do not close processes you did not start.

## Report

Post it as a comment on the pull request if you can; otherwise give it to the user. Lead with the verdict.

```
QA: PASSED | FAILED | NOT VERIFIED
Branch feat/... at <commit>

Build: ok
Unit tests: 12 passed
End to end: 18 passed, 1 failed

Failed
- CHAT-002 ... : <what the window showed, in one line>. <app defect | provider | test defect>

Missing cases
- <feature with no case, or "none">

Explored by hand
- <what you tried and what you saw, or "nothing">
```

- **PASSED** only when the build, the unit tests and every end-to-end case passed.
- **NOT VERIFIED** when the only failures are provider problems that survived a retry.
- State what you ran. Never report a case as passed if it did not run.
