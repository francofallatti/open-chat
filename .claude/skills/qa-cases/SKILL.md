---
name: qa-cases
description: Find which end-to-end cases an OpenChat branch is missing and write them. Compares the branch's changes against main and the existing suite, proposes the cases, writes them, and runs only the new ones. Use for "/qa-cases", "agregá los casos de prueba", "¿faltan casos?", "qué casos hay que sumar", or after finishing a feature or a bug fix. To judge whether a branch can be merged use the qa skill instead.
argument-hint: "[branch] [solo-listar]"
---

# Add the end-to-end cases a branch is missing

Your job is to leave the branch with the cases its changes need. You change files under `e2e/` and `TESTING.md` only; if a case reveals a defect in the app, report it and leave the app code alone.

Read [TESTING.md](../../../TESTING.md) first: it has the conventions (ids, titles, selectors, `appReady`, `seedChat`, the `@modelo` tag).

Arguments: `$ARGUMENTS`. With `solo-listar`, stop after step 3 and write nothing.

## Steps

1. **See what changed.** Work in a worktree on the branch (the one named, or the current one). Read `git diff main...HEAD` and name each change the user can see or do: a new control, a new flow, a changed message, a fixed defect.

2. **See what is covered.** Run `npm run casos` in `e2e/` and read the specs of the areas the changes touch.

3. **List the gaps.** For each change, say which existing case covers it, or propose a new one: id, title, and what it checks in one line. Also list:

   - existing cases the change makes wrong or outdated;
   - entries under "Pendientes de automatizar" in TESTING.md that this branch makes possible to automate.

   A refactor with no visible change needs no new case: say so instead of inventing one.

4. **Write the cases.** Follow TESTING.md. One behaviour per case. Prefer `seedChat` over calling a model; tag `@modelo` only when a real answer is the point.

5. **Run only what you wrote**, at least twice, to catch a case that passes by luck:

   ```powershell
   cargo build --release --features custom-protocol   # only if the executable is older than the branch
   cd e2e
   npx playwright test -g "<ID-1>|<ID-2>" --repeat-each 2
   ```

   For a bug-fix case, confirm it fails without the fix when that is cheap to check, and say whether you did.

6. **Update TESTING.md** if you added an area prefix or automated something from the pending list.

7. **Commit and push** to the branch with a `[TEST]` commit. Leave no `openchat.exe` or `opencode-cli.exe` of yours running.

## Report

```
Cases added: SES-006, SES-007
Cases changed: MOD-002 (the label text changed)
Ran: 2 new cases x 2, all passed
Not covered, and why: <change with no case, or "nothing">
Defects found in the app: <or "none">
```

This does not replace the gate: after it, the branch still needs a full `/qa`.
