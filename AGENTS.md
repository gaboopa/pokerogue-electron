## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Luna

`.luna/` configures Luna Runner for this repository.

- Hand implementation work to Luna with `luna start <packet.md>`. Never call codex or codex-companion directly; a hook blocks that in repositories with `.luna/`.
- Wait with `luna status <id> --wait` in a background shell. Do not poll.
- Then run `luna result <id>`. Review the diff and rerun the key checks yourself; Luna's self-report is never the final word.
- Use `luna send <id>` for fix rounds, at most 2 per run. If the result still fails review after 2 rounds, fix it in the worktree yourself, or `luna clean <id> --discard` and rewrite the packet.
- Use `luna accept <id> -m "..."` to commit after review, and `luna clean <id>` to remove the worktree.
