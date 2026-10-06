# PokeRogue Offline rules

- The worktree's `node_modules` is a junction to the main checkout's `node_modules`; anything written through it changes the main install. Never run `npm install`, `npm ci`, `npm update` or `npm rebuild`, and never modify `node_modules`.
- Never delete the worktree or anything in it recursively (`rm -rf`, `rmdir /s`, `Remove-Item -Recurse`, `git worktree remove`, `git clean -x`): these can follow the junction and delete the main install. Delete files one at a time by exact path (`Remove-Item -LiteralPath <file>` or `del <file>`), never recursively. Do not use git commands that write the index (`git rm`, `git add`, `git mv`, `git stash`): the sandbox cannot write the worktree's index, and staging is done at `luna accept`. Only `luna clean` removes a worktree.
- Read `AGENTS.md` and `CONTEXT.md` first and use the domain terms in `CONTEXT.md` (Backup, Update, Save data).
- Never touch real Save data. Tests and reproductions use disposable directories and Electron profiles under the temp folder, never the real `userData`.
- Do not weaken input validation, the update host allowlist, sandbox/contextIsolation settings, the network policy, or any Backup/Restore rollback and recovery path unless the packet names that exact change.
- User-visible text (dialog titles, messages, button labels, installer strings) stays byte-identical unless the packet says otherwise.
- Do not publish, tag, push, or run the release packaging commands (`npm run package:win`, `npm run package:mac`). Smoke packaging is allowed only when the packet asks for it.
- A check you could not run is a limitation, not a pass. Report it as pending with the exact error.
- Keep each file's existing line endings. `git diff` must show only real changes.
- Stop and report on any packet stop condition instead of working around it.
- Final report: files changed, lines added/removed (`git diff --stat`), each verification command with its exit code and pass/fail counts, and anything you left undone and why.
