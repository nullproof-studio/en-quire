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

Add en-quire to your MCP client (Claude Desktop, Cursor, etc.):

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

## Usage

Once connected, an agent (or you through an MCP client) can use en-quire's tools to navigate, search, and edit markdown documents. Here's a typical workflow.

### 1. Discover documents

```
doc_list({ scope: "sops/" })
→ { files: [{ path: "sops/deployment.md", size: 4820, modified: "2026-03-17T..." }] }
```

### 2. Explore structure

```
doc_outline({ file: "sops/deployment.md", max_depth: 2 })
→ { headings: [
    { level: 1, text: "Deployment Procedures", has_children: true, char_count: 4200 },
    { level: 2, text: "1. Pre-deployment", has_children: true, char_count: 980 },
    { level: 2, text: "2. Deployment Steps", has_children: true, char_count: 1640 },
    { level: 2, text: "3. Post-deployment", has_children: true, char_count: 720 }
  ]}
```

### 3. Read a specific section

```
doc_read_section({ file: "sops/deployment.md", section: "2. Deployment Steps" })
→ { content: "## 2. Deployment Steps\n\n...", heading: "2. Deployment Steps",
    path: "Deployment Procedures > 2. Deployment Steps",
    prev_sibling: "1. Pre-deployment", next_sibling: "3. Post-deployment" }
```

Sections can be addressed four ways:

| Style | Example | Use when |
|-------|---------|----------|
| Heading text | `"2. Deployment Steps"` | You know the exact heading |
| Breadcrumb path | `"Deployment Procedures > 2. Deployment Steps"` | Disambiguating duplicates |
| Positional index | `"[0, 1]"` | Navigating programmatically |
| Glob pattern | `"2.*"` | Matching multiple sections |

### 4. Search across documents

```
doc_search({ query: "rollback", section_filter: "Post-deployment*" })
→ { results: [
    { file: "sops/deployment.md", section_heading: "3.2 Rollback Plan",
      breadcrumb: ["Deployment Procedures", "3. Post-deployment", "3.2 Rollback Plan"],
      snippet: "...follow the >>>rollback<<< procedure described in..." }
  ]}
```

Search results include structural context — breadcrumbs, section paths, and heading-match boosting — so agents can triage results by *where they sit in the document hierarchy*, not just by text relevance.

### 5. Edit a section

```
doc_replace_section({
  file: "sops/deployment.md",
  section: "3.2 Rollback Plan",
  content: "\nUpdated rollback steps:\n\n1. Revert the deployment\n2. Notify on-call\n3. Open incident ticket\n",
  message: "Updated rollback procedure to include incident ticket step"
})
→ { success: true, mode: "write", commit: "a1b2c3d",
    diff: "--- a/sops/deployment.md\n+++ b/sops/deployment.md\n@@ -42,3 +42,5 @@..." }
```

Every write operation returns a unified diff and auto-commits with a structured message.

### 6. Propose changes (governance)

Callers without `write` permission can propose edits that land on a branch:

```
doc_replace_section({
  file: "sops/deployment.md",
  section: "1. Pre-deployment",
  content: "\nAdded new environment check for API keys.\n",
  mode: "propose"
})
→ { success: true, mode: "propose", branch: "propose/michelle/sops/deployment/20260317T1423Z" }
```

An approver can then review and merge:

```
doc_proposal_diff({ branch: "propose/michelle/sops/deployment/20260317T1423Z" })
doc_proposal_approve({ branch: "propose/michelle/sops/deployment/20260317T1423Z" })
```

### 7. Append, insert, and find-replace

```
doc_append_section({
  file: "sops/deployment.md",
  section: "3.1 Monitoring",
  content: "- Check error rate dashboard after each deploy"
})

doc_insert_section({
  file: "sops/deployment.md",
  anchor: "2. Deployment Steps",
  position: "child_end",
  heading: "2.4 Canary Check",
  content: "Run canary checks before full rollout."
})

doc_find_replace({
  file: "sops/deployment.md",
  find: "staging",
  replace: "pre-production",
  expected_count: 3
})
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
  sync_on_start: blocking           # "blocking" or "background" (use background for 100k+ docs)
  batch_size: 500                   # Files per index transaction batch
  semantic:
    enabled: false                  # Opt-in
    endpoint: "http://localhost:11434/api/embeddings"
    model: "nomic-embed-text"
    dimensions: 768

# Logging
logging:
  level: info                       # error | warn | info | debug
  dir: null                         # null = stderr only; path = file logging
  # dir: /app/logs                  # Docker: writes combined.log + error.log

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
| Logging | Winston |
| MCP SDK | @modelcontextprotocol/sdk |

## Development

### Prerequisites

- Node.js 22+
- npm

### Build from source

```bash
git clone https://github.com/nullproof-studio/en-quire.git
cd en-quire
npm install
npm run build
```

### Run locally

```bash
# stdio transport (default)
npm start -- --config path/to/en-quire.config.yaml

# Development mode (no build step)
npm run dev -- --config path/to/en-quire.config.yaml
```

### Run tests

```bash
npm test              # Single run
npm run test:watch    # Watch mode
```

### Publish npm package

```bash
npm run build
npm run lint
npm test
npm publish --access public
```

The package is published as `@nullproof-studio/en-quire`. Ensure `version` in `package.json` is updated before publishing.

### Build and publish Docker image

```bash
# Build
npm run build
docker build -t ghcr.io/nullproof-studio/en-quire:latest .

# Test locally
docker run -i --rm \
  -v /path/to/docs:/data/docs:rw \
  -v /path/to/config:/app/config:ro \
  -v /path/to/logs:/app/logs:rw \
  ghcr.io/nullproof-studio/en-quire:latest

# Publish to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
docker push ghcr.io/nullproof-studio/en-quire:latest
docker tag ghcr.io/nullproof-studio/en-quire:latest ghcr.io/nullproof-studio/en-quire:0.1.0
docker push ghcr.io/nullproof-studio/en-quire:0.1.0
```

When using streamable-http transport, the Docker image includes a health check at `GET /health`:

```bash
docker run -d --name en-quire \
  -p 3100:3100 \
  -v /path/to/docs:/data/docs:rw \
  -v /path/to/config:/app/config:ro \
  -v /path/to/logs:/app/logs:rw \
  ghcr.io/nullproof-studio/en-quire:latest

curl http://localhost:3100/health
# → {"status":"ok","sessions":0}
```

## Roadmap

- **v0.1 — Core**: Document parsing, section addressing, read/write tools, git integration, full-text search, basic RBAC, Docker image, stdio transport, streamable-http transport.
- **v0.2 — Governance**: Proposal workflows, remote push, PR hooks, audit log queries, conflict detection.
- **v0.3 — Search & Intelligence**: Semantic vector search, cross-document reference tracking, inverse lookups, context bundle builder.
- **v0.4 — Scale & Polish**: Bulk operations, watch mode, plugin hooks.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

© 2026 Nullproof Studio. Released under the MIT License.
