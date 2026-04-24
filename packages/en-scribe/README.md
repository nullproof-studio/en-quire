# @nullproof-studio/en-scribe

Reliable plain-text editing for agent systems. A sibling MCP to [en-quire](https://www.npmjs.com/package/@nullproof-studio/en-quire): shares en-quire's reliability layer (etag optimistic locking, proposals, diffs) but operates on lines, ranges, and anchors rather than sections.

**Positioning** — literal: reads and edits without structural interpretation. For section-aware editing of markdown or YAML, use en-quire.

## Install

```bash
npm install -g @nullproof-studio/en-scribe
```

Provides the `enscribe` binary.

## Tools

Two primitives — `text_find`, `text_replace_range` — can express any edit. The sugar tools are ergonomic shortcuts for the common unique-match case; they error with a clear hint when matches are ambiguous, so agents can fall back to the primitives without getting stuck.

| Layer | Tool |
|---|---|
| Read | `text_read`, `text_find`, `text_head`, `text_tail`, `text_list` |
| Write primitives | `text_replace_range`, `text_create`, `text_append` |
| Sugar | `text_edit`, `text_insert_at_anchor` |
| Lifecycle | `text_rename`, `text_delete` |
| Governance | `text_status`, `text_proposals_list`, `text_proposal_diff`, `text_proposal_approve`, `text_proposal_reject` |

No regex. The positioning is *predictable, no hidden semantics*; agents wanting pattern power reach for `grep` or en-quire.

See the [repo README](https://github.com/nullproof-studio/en-quire#readme) for configuration and the full spec.
