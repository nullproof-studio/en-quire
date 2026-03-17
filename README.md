# en-quire

**Structured markdown document management for agent systems, with governance.**

An MCP server that treats markdown files as structured, section-addressable documents with built-in RBAC, approval workflows via git, and semantic search. Designed for operational use cases where agents need to read, propose edits to, and maintain markdown documents — SOPs, skill files, memory, runbooks — under governance.

> A [Nullproof Studio](https://github.com/nullproof-studio) open-source project.

---

## The Problem

Agent systems increasingly depend on markdown files as operational infrastructure. But existing tooling falls short:

- **Filesystem MCP** — no document awareness, no governance, no search. Agents can clobber files freely.
- **Knowledge-graph MCPs** — impose opinionated schemas, designed for conversational memory rather than operational documents.
- **Search-only MCPs** — read-only. No write or edit capability.
- **None of them** have RBAC or approval flows. Every caller is fully trusted.

en-quire fills this gap: a server that understands markdown structure, supports surgical section-level editing, and treats governance as a first-class concern.

## Key Features

- **Section-addressable editing** — read and write at the heading level, not the file level. Address sections by path (`2.7`), heading text (`## Checks`), or breadcrumb (`Procedures > Checks > Daily`).
- **Git-native governance** — edits from unprivileged callers land on branches, not main. Approval is a merge. Rejection is branch deletion. The audit trail is commit history.
- **RBAC inside the MCP** — caller identity and permissions are resolved at the MCP layer. Different agents get different capabilities on different document sets.
- **Full-text search** — SQLite FTS5 out of the box, with structural ranking (heading match boost, depth penalty, breadcrumb relevance).
- **Semantic search** (optional) — local embeddings via sqlite-vec. No external API keys required.
- **Git-optional mode** — full functionality without git for evaluation and local setups; governance features require git.

## MCP Tools

### Document Reading
`doc_outline` · `doc_read_section` · `doc_read` · `doc_list`

### Document Editing
`doc_replace_section` · `doc_insert_section` · `doc_append_section` · `doc_delete_section` · `doc_create` · `doc_find_replace` · `doc_rename` · `doc_status`

### Search
`doc_search` · `doc_list`

### Governance
`doc_proposals_list` · `doc_proposal_diff` · `doc_proposal_approve` · `doc_proposal_reject`

### Admin
`doc_exec` — escape hatch for feature discovery, with full audit logging.

## Quick Start

### Docker (recommended)

```bash
docker run -i --rm \
  -v /path/to/your/docs:/data/docs:rw \
  -v /path/to/config:/app/config:ro \
  ghcr.io/nullproof-studio/en-quire:latest
```

### MCP Client Configuration

```json
{
  "mcpServers": {
    "en-quire": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/home/user/docs:/data/docs:rw",
        "-v", "/home/user/.config/en-quire:/app/config:ro",
        "ghcr.io/nullproof-studio/en-quire:latest"
      ]
    }
  }
}
```

## Configuration

```yaml
# en-quire.config.yaml

# Required
document_root: /data/docs          # Must be a git repository

# Server
transport: stdio                    # stdio | streamable-http
port: 3100                          # For streamable-http

# Search
search:
  fulltext: true                    # Always on
  semantic:
    enabled: false                  # Opt-in
    endpoint: "http://localhost:11434/api/embeddings"
    model: "nomic-embed-text"
    dimensions: 768

# Git
git:
  auto_commit: true                 # Commit on every write operation
  remote: null                      # Optional: push proposals to remote
  pr_hook: null                     # Optional: webhook/script to open PRs

# Callers (see RBAC section in spec)
callers:
  # ...
```

## Technology Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript |
| Runtime | Node.js 22 (LTS) |
| Markdown AST | unified / remark |
| Git operations | simple-git |
| Full-text search | better-sqlite3 + FTS5 |
| Vector search | sqlite-vec (optional) |
| Schema validation | Zod |
| MCP SDK | @modelcontextprotocol/sdk |

## Roadmap

- **v0.1 — Core**: Document parsing, section addressing, read/write tools, git integration, full-text search, basic RBAC, Docker image, stdio transport.
- **v0.2 — Governance**: Proposal workflows, remote push, PR hooks, audit log queries, conflict detection.
- **v0.3 — Search & Intelligence**: Semantic vector search, cross-document reference tracking, inverse lookups, context bundle builder.
- **v0.4 — Scale & Polish**: Streamable-http transport, bulk operations, watch mode, plugin hooks.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

© 2026 Nullproof Studio. Released under the MIT License.
