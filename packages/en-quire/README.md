# @nullproof-studio/en-quire

Structured document management for agent systems, with governance. An MCP server.

**Positioning** — investigative: reads and edits with structural understanding (sections, outlines, frontmatter, TOC). For literal plain-text editing without interpretation, use [@nullproof-studio/en-scribe](https://www.npmjs.com/package/@nullproof-studio/en-scribe).

## Install

```bash
npm install -g @nullproof-studio/en-quire
```

Provides the `enquire` binary.

## Supported formats

| Extensions | Parser | Indexed for search | Notes |
|---|---|---|---|
| `.md`, `.mdx` | markdown | yes | Section tree from ATX headings. Full TOC, frontmatter, GFM. |
| `.yaml`, `.yml` | yaml | yes | Keys are sections. Dot-path + bracket addressing for `doc_set_value`. |
| `.jsonl`, `.ndjson` | jsonl | no | Records wrapped in a synthetic `__records` root so `doc_insert_section({ anchor: "__records", position: "child_end" })` appends a new record (works on empty files too). Heading auto-coalesced from identifier fields (`name`, `id`, `description`, `title`, `role`, `type`, `kind`); falls back to `<firstKey>: <snippet>`. Each write re-validates every line. |

All parsers implement the same `DocumentParser` interface, so every `doc_*` tool works across formats — `doc_outline`, `doc_read_section`, `doc_replace_section`, `doc_insert_section`, `doc_delete_section`, `doc_proposals_*`, etc.

### Search scope

`doc_search` indexes markdown and YAML files only. JSONL is excluded deliberately: record-oriented data (chat transcripts, training samples, event logs) tends to be noisy in FTS — large content fields, repetitive role prefixes, and record counts that quickly outweigh prose documents — and its primary access pattern is record-by-index via `doc_read_section`, not substring search across the corpus. `doc_status` still surfaces JSONL files under `unindexed`, which is accurate rather than a warning. If search over JSONL content turns out to be a real need later, we can add it per-root behind a config flag.

## Governance workflow

Proposals can become real pull requests on GitHub/GitLab. Configure the remote, the push flag, and a `pr_hook` on a root:

```yaml
document_roots:
  docs:
    path: /data/docs
    git:
      remote: origin
      push_proposals: true
      pr_hook: "gh pr create --head {branch} --title 'Proposal: {file}' --base main"
```

Every `mode: "propose"` write then runs the full pipeline:

1. Commits to a `propose/<caller>/<path>/<timestamp>` branch locally
2. Pushes to the remote
3. Fires `pr_hook` with `{branch}` / `{file}` / `{caller}` substitution (via `execFile` — no shell)

Approvals happen via `doc_proposal_approve` (merges locally after verifying the remote branch still exists — fails closed if it was merged upstream already) or via the PR UI on your host. Server startup runs `git fetch --prune` per git-enabled root so `doc_proposals_list` stays current across sessions.

## Usage

See the [repo README](https://github.com/nullproof-studio/en-quire#readme) for configuration, tool reference, and the full spec.
