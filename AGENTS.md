# AGENTS.md: rules for AI coding agents working on Despawn

You are working on **Despawn**, an open-source tool that lets a person print a sensitive document at any shop without the shop keeping a copy. Read this whole file at the start of every task. These rules apply to every task unless the task prompt explicitly overrides one.

## 1. Source of truth

Read the documents the task names. Always treat these as authoritative:

| Document | Authority over |
|---|---|
| `docs/REQUIREMENTS.md` | What to build, priorities, acceptance criteria |
| `docs/ARCHITECTURE.md` | How to build it: threat model, crypto protocol (section 5), state machine (section 4), API (section 8), repo layout (section 12) |
| `docs/FILE_SUPPORT.md` | Rendering pipeline and format support |
| `docs/UI_DESIGN.md` and `design/tokens.css` | Screens, copy, components, tokens |

Rules:

- Implement the spec **exactly**. Do not redesign, rename, simplify or "improve" the protocol, message names, state names, field names or timer values.
- If the spec is ambiguous, contradictory or seems wrong, **stop and ask** (see section 9). Do not guess. If you think the spec has an error, describe it under "Spec issues" in the report and wait.
- Do not edit anything under `docs/` or `design/` unless the task says so. The only exception is adding your report under `docs/progress/`.

## 2. How every task runs

1. Run `git pull --rebase origin main`. Read this file and the documents the task names.
2. Write a short plan (5 to 10 lines) before changing anything. Do not wait for approval unless something is unclear.
3. Implement only what the task asks. Anything else you notice goes under "Noticed, not done" in the report.
4. Verify (section 6).
5. Write the report (section 7).
6. Commit and push (section 5).
7. Send the final message (section 8).

## 3. Security rules (non-negotiable)

- **Cryptography uses WebCrypto only** (`crypto.subtle`, `crypto.getRandomValues`). Never add a crypto library. Never invent a primitive, mode or construction. Follow ARCHITECTURE.md section 5.2 exactly: algorithms, HKDF salts and info strings, AAD layout, nonce construction.
- Never log, print, store or put in a URL any of: file key, link secret, private keys, plaintext document bytes, passwords, owner tokens. Never include them in error messages.
- No `eval`, `new Function`, string-form `setTimeout`, or `innerHTML` with any non-constant value. Use `textContent` and DOM APIs.
- The shop viewer (`apps/viewer`) has **zero runtime dependencies**, makes requests only to its own origin, uses no third-party code or fonts, and compiles to ES2018.
- Keys and decrypted data must never be written to localStorage, sessionStorage, IndexedDB, cookies, the Cache API or a service worker in the viewer.
- Constant-time comparison for MAC verification (use the WebCrypto verify call, not manual string compare).
- Any code that touches keys, MACs or ciphertext needs tests, including tamper tests (flip a bit, reorder, truncate, wrong key, wrong session ID).
- Treat every file, message and server response as hostile input. Validate with the shared schemas.

## 4. Engineering rules

- TypeScript strict mode. No `any` (use `unknown` and narrow). No `@ts-ignore` or `@ts-expect-error` without a comment explaining why.
- No stubs presented as finished work. No `TODO` in shipped code unless it references a numbered item in your report's "Noticed, not done".
- **Dependencies:** add a dependency only if the task allows it or it is clearly necessary. For each new dependency, record in the report: name, exact version, licence, approximate size, and why. Prefer platform APIs. Licences must be compatible with Apache-2.0 (no GPL or AGPL in the default build).
- Do not weaken lint, type or test settings to make something pass. Do not delete or skip a failing test. If a test is wrong, fix it and say so in the report.
- Keep functions small and files focused. Put shared constants and message schemas in `packages/protocol`, not duplicated.
- Naming and structure follow ARCHITECTURE.md section 12.
- Comments explain why, not what. Public functions get a short doc comment.
- Write tests alongside code. Crypto and protocol code is written test-first.

## 5. Git rules

- Work on `main` and push to `origin main`. No force-push, no history rewriting, no amending commits that were already pushed.
- Small commits, one logical change each, **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`, `refactor:`), imperative mood, under 72 characters in the subject.
- Before each commit run `git status` and `git diff --stat` and confirm nothing unintended is included.
- **Never commit:** `node_modules/`, build output, `.env*`, logs, secrets, `_review/`, or any `*.zip` file. If `git status` shows one of these as untracked or staged, fix `.gitignore` or unstage it. Never use `git add -f`.
- After pushing, run `git fetch origin && git log origin/main -1 --oneline` and confirm your last commit is there.
- If a push fails (auth, conflict, rejected), stop and report. Do not work around it.

## 6. Verification (be honest)

- From a clean state, run the project's checks that exist at that point: install, lint, format check, typecheck, tests, build. Use the exact commands from the root `package.json`.
- Report the **real** results. Paste the key lines of output (pass counts, errors). Never claim a check passed unless you ran it in this task. If you could not run something, say so and why.
- If something fails and you cannot fix it within the task's scope, report it as failing. Do not hide it.

## 7. Progress report

Create `docs/progress/TASK-NN-short-name.md` (NN is the task number from the prompt) and commit it. Use exactly this structure:

```
# TASK-NN: <title>

## Summary
Three to six sentences on what was done.

## Changes
Bulleted list of files and directories added or changed, with one line each.

## Verification
Each command run and its result (pass or fail, counts, key output lines).

## Dependencies added
Table: name, version, licence, size, reason. Write "none" if none.

## Decisions made
Choices you had to make that the spec did not dictate, with the reason.

## Spec issues
Anything in the docs that looked wrong, ambiguous or inconsistent. Write "none" if none.

## Noticed, not done
Numbered list of out-of-scope issues or follow-ups.

## Commits
Short hash and subject for each commit, in order.
```

## 8. Final chat message

When finished, reply with:

1. The last commit's full hash on `origin/main`.
2. A summary of at most five lines.
3. Any decisions you need from the owner, or "none".
4. Anything that failed or was skipped, or "none".

## 9. When to stop and ask

Stop and ask the owner, without guessing, if:

- The spec is ambiguous or you believe it is wrong.
- A task needs a new dependency that is not clearly permitted, or a licence is unclear.
- A check fails and the fix would need changes outside the task's scope.
- You are about to delete files you did not create, rewrite history, or change anything under `docs/` or `design/`.
- Credentials, tokens or accounts are needed.

## 10. Review package (optional)

Status: **OFF**. The reviewer reads the public repository directly. Only do this section if the task prompt says "create the review zip".

If asked:

1. Complete and push everything first.
2. Delete every file matching `_review/despawn-*.zip` (the older zips).
3. Create the folder `_review/` if needed. It is git-ignored.
4. Run `git archive --format=zip --prefix=despawn/ -o _review/despawn-TASKNN-<shorthash>.zip HEAD`, using the task number and the short hash of the pushed commit. This works on every operating system and includes only committed files.
5. Confirm `git status` is clean and the zip is not tracked. Never add or push the zip.
6. Tell the owner the zip's full path.
