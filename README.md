# en-quire

**Structured document management for agent systems, with governance.**

An MCP server that treats markdown and YAML files as structured, section-addressable documents with built-in RBAC, approval workflows via git, and semantic search. Designed for operational use cases where agents need to read, propose edits to, and maintain documents — SOPs, skill files, memory, runbooks, config files — under governance.

> A [Nullproof Studio](https://github.com/nullproof-studio) open-source project.

---

## Packages

This repo is an npm workspaces monorepo with three packages:

| Package | Role | Bin |
|---|---|---|
| [`@nullproof-studio/en-core`](packages/en-core/) | Shared reliability primitives (etag, proposals, diff, git, RBAC, parser registry). Library only. | — |
| [`@nullproof-studio/en-quire`](packages/en-quire/) | **Investigative** — reads and edits with structural understanding (sections, outlines, frontmatter, TOC). This README covers en-quire in depth. | `enquire` |
| [`@nullproof-studio/en-scribe`](packages/en-scribe/) | **Literal** — reads and edits plain-text files without interpretation (ranges, anchors, append). Sibling MCP. See [packages/en-scribe/README.md](packages/en-scribe/README.md). | `enscribe` |

Keep the two binaries distinct: auto-detecting headings belongs in en-quire; byte- and line-offset ops belong in en-scribe. Both share en-core's reliability guarantees so etag and proposal semantics can't drift.

---

## The Problem

Agent systems increasingly depend on markdown files as operational infrastructure. But existing tooling falls short:

- **Filesystem MCP** — no document awareness, no governance, no search. Agents can clobber files freely.
- **Knowledge-graph MCPs** — impose opinionated schemas, designed for conversational memory rather than operational documents.
- **Search-only MCPs** — read-only. No write or edit capability.
- **None of them** have RBAC or approval flows. Every caller is fully trusted.

en-quire fills this gap: a server that understands document structure, supports surgical section-level editing, and treats governance as a first-class concern.

## Key Features

- **Multi-format support** — pluggable parser architecture handles markdown (`.md`, `.mdx`) and YAML (`.yaml`, `.yml`). Both produce the same section tree; all tools work uniformly across formats.
- **Section-addressable editing** — read and write at the heading/key level, not the file level. Address sections by heading text (`## Checks`), breadcrumb path (`Procedures > Checks > Daily`), positional index (`[0, 1]`), or YAML dot-path (`services.api.environment.PORT`).
- **Multi-root document management** — configure multiple named document roots with independent git repos, permissions, and search indices. Paths are prefixed by root name (`docs/sops/runbook.md`, `config/docker-compose.yaml`).
- **Git-native governance** — edits from unprivileged callers land on branches, not main. Approval is a merge. Rejection is branch deletion. The audit trail is commit history.
- **RBAC inside the MCP** — caller identity and permissions are resolved at the MCP layer. Different agents get different capabilities on different document sets.
- **Full-text search** — SQLite FTS5 out of the box, with structural ranking (heading match boost, depth penalty, breadcrumb relevance).
- **Semantic search** (optional) — local embeddings via sqlite-vec. No external API keys required.
- **Git-optional mode** — full functionality without git for evaluation and local setups; governance features require git.
- **Write validation** — output is validated before writing. Invalid YAML syntax is blocked; warnings are surfaced to the calling agent.
- **Language-agnostic** — section addressing and search operate on document structure, not language. SOPs in Japanese, skill files in German, runbooks in Portuguese — en-quire works with any language that markdown supports.

## MCP Tools

### Document Reading
`doc_outline` · `doc_read_section` · `doc_read` · `doc_list` · `doc_insert_text`

### Document Editing
`doc_replace_section` · `doc_insert_section` · `doc_append_section` · `doc_delete_section` · `doc_move_section` · `doc_set_value` · `doc_create` · `doc_find_replace` · `doc_rename` · `doc_generate_toc` · `doc_status`

### Search & Cross-Document
`doc_search` (fulltext / semantic / hybrid) · `doc_references` · `doc_referenced_by` · `doc_context_bundle` · `doc_history` · `doc_list`

### Governance
`doc_proposals_list` · `doc_proposal_diff` (returns `can_merge` + `conflicts[]`) · `doc_proposal_approve` (refuses on conflict) · `doc_proposal_reject`

### Admin
`doc_exec` · `doc_audit_log` — escape hatch for feature discovery, with full audit logging and on-demand audit-log queries.

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

Sections can be addressed in multiple ways:

| Style | Example | Use when |
|-------|---------|----------|
| Heading text | `"2. Deployment Steps"` | You know the exact heading |
| Breadcrumb path | `"Procedures > Checks > Daily"` | Disambiguating duplicates |
| Positional index | `"[0, 1]"` | Navigating programmatically |
| Glob pattern | `"2.*"` | Matching multiple sections |
| Dot-path (YAML) | `"services.api.environment.PORT"` | YAML key hierarchies |
| Bracket notation (YAML) | `"services['my.dotted.key']"` | YAML keys containing dots |

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
→ { success: true, mode: "propose", branch: "propose/michelle/sops/deployment.md/20260317T1423Z" }
```

An approver can review and merge through the MCP:

```
doc_proposal_diff({ branch: "propose/michelle/sops/deployment.md/20260317T1423Z" })
doc_proposal_approve({ branch: "propose/michelle/sops/deployment.md/20260317T1423Z" })
```

Or on GitHub/GitLab — when `git.remote` + `git.push_proposals` + `git.pr_hook` are configured on a root, every propose write also pushes the branch and fires the hook (typically `gh pr create ...`) so the proposal shows up as a real PR:

```yaml
document_roots:
  docs:
    path: /data/docs
    git:
      remote: origin
      push_proposals: true
      pr_hook: "gh pr create --head {branch} --title 'Proposal: {file}' --base main"
```

`doc_proposal_approve` pre-flight-fetches the remote before merging and refuses if the branch is gone (likely already merged upstream), preventing divergent local history. `doc_proposals_list` stays current across sessions via a startup `git fetch --prune`.

### 7. Work with YAML files

YAML files are first-class citizens. The same tools work with dot-path addressing:

```
doc_outline({ file: "config/docker-compose.yaml" })
→ { headings: [
    { level: 1, text: "version", has_children: false },
    { level: 1, text: "services", has_children: true },
    ...
  ]}

doc_read_section({ file: "config/docker-compose.yaml", section: "services.api.environment" })
→ { content: "      NODE_ENV: production\n      PORT: 3100\n", heading: "environment" }

doc_set_value({ file: "config/docker-compose.yaml", path: "services.api.environment.PORT", value: "8080" })
→ { success: true, mode: "write", commit: "d4e5f6a" }
```

`doc_set_value` preserves the original YAML quote style — if the value was `"quoted"`, the replacement stays quoted.

### 8. Append, insert, and find-replace

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

### 9. Cross-document references and context bundles

`doc_search` finds matches in a single document. For topics that span SOPs, skills, and runbooks, en-quire maintains a derived link index (`doc_links`) populated from markdown links, Obsidian-style `[[wiki]]` links, and frontmatter `references` / `implements` / `supersedes` / `see_also` arrays.

```
// Outgoing references from a file (or one of its sections)
doc_references({ file: "skills/triage.md", section: "Tool Selection" })
→ { references: [
    { target_file: "sops/runbook.md", target_section: "checks", relationship: "references", context: "..." },
  ] }

// Inverse — which skills and runbooks point AT this section?
// Use this for impact analysis before editing a shared SOP section.
doc_referenced_by({ file: "sops/runbook.md", section: "checks" })
→ { referenced_by: [
    { source_file: "skills/triage.md", source_section: "Tool Selection", ... },
  ] }

// Single-call topic gathering. Seeds with FTS hits, expands via the
// link graph in both directions up to max_depth hops, returns the
// section bodies with combined relevance + hop_distance scores.
doc_context_bundle({
  query: "deployment metrics",
  max_sections: 10,
  max_depth: 1,
})
→ { sections: [
    { file: "sops/deployment.md", section_path: "Metrics", content: "...", relevance_score: 0.71, hop_distance: 0 },
    { file: "skills/observability.md", section_path: "Observability", content: "...", relevance_score: 0.34, hop_distance: 1 },
  ] }
```

### 10. Section-level history

```
doc_history({ file: "sops/runbook.md", section: "checks", limit: 5 })
→ { history: [
    { sha: "...", date: "2026-04-29T13:09:26Z", author: "Andy", subject: "fix: tighten check ordering" },
    { sha: "...", date: "2026-04-15T08:37:54Z", author: "Andy", subject: "init: add checks section" },
  ] }
```

Resolves the section to its current line range, then runs `git log -L` over those lines so editing one section never appears in history queries for another.

### 11. Semantic search

When `search.semantic.enabled` is on (config below), `doc_search` accepts `search_type: "semantic"` or `"hybrid"`:

```
doc_search({
  query: "how do we keep agent edits auditable",
  search_type: "hybrid",     // 50/50 fulltext + vector blend
  max_results: 10,
})
```

Embeddings come from any OpenAI-compatible endpoint (OpenAI, LM Studio, Ollama via its `/v1` shim, vLLM, llama.cpp's `--api`, text-embeddings-inference). When sqlite-vec or the endpoint is unavailable, semantic mode degrades silently to fulltext rather than refusing requests.

## Configuration

```yaml
# en-quire.config.yaml

# Document roots (multiple supported)
document_roots:
  docs:
    path: /data/docs                # Must be a git repository for governance
  config:
    path: /data/config              # YAML configs, docker-compose, etc.

# Server
transport: stdio                    # stdio | streamable-http
port: 3100                          # For streamable-http

# Search
search:
  sync_on_start: blocking           # "blocking" or "background" (use background for 100k+ docs)
  batch_size: 500                   # Files per index transaction batch
  semantic:
    enabled: false                  # Opt-in (sqlite-vec + OpenAI-compatible embeddings)
    # Base URL of an OpenAI-compatible embeddings server. The client
    # appends "/embeddings" — do not include the trailing path. Works
    # against OpenAI, LM Studio, vLLM, llama.cpp --api,
    # text-embeddings-inference, and Ollama via its /v1 compat shim.
    endpoint: "https://api.openai.com/v1"
    model: "text-embedding-3-small"
    dimensions: 1536
    api_key_env: "OPENAI_API_KEY"   # preferred over a literal `api_key`

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
| YAML parser | yaml (with source token preservation) |
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
- Git ≥ 2.38 (proposal conflict detection uses `git merge-tree --write-tree`)

### Build from source

```bash
git clone https://github.com/nullproof-studio/en-quire.git
cd en-quire
npm install                # installs all workspaces
npm run build              # builds en-core, en-quire, en-scribe in order
```

### Run locally

```bash
# en-quire, stdio transport (default)
npm start -w @nullproof-studio/en-quire -- --config path/to/en-quire.config.yaml

# Development mode (no build step)
npm run dev -w @nullproof-studio/en-quire -- --config path/to/en-quire.config.yaml

# en-scribe
npm run dev -w @nullproof-studio/en-scribe -- --config path/to/en-scribe.config.yaml
```

### Run tests

```bash
npm test              # single run across all packages (vitest discovers packages/*/test)
npm run test:watch    # watch mode
```

### Publish npm packages

Published in dependency order — en-core first, then the two binaries:

```bash
npm run build
npm run lint
npm test
npm publish -w @nullproof-studio/en-core
npm publish -w @nullproof-studio/en-quire
npm publish -w @nullproof-studio/en-scribe
```

CI runs `npm publish --dry-run` for each package on every PR to catch tarball-shape regressions before release. All three are configured for public access via `publishConfig.access`; bump versions in the respective `packages/*/package.json` before running `publish`.

### Build and publish Docker image

One multi-stage image ships both binaries. The default entrypoint is `enquire`; override for en-scribe.

```bash
# Build
docker build -t ghcr.io/nullproof-studio/en-quire:latest .

# Run en-quire (default)
docker run -i --rm \
  -v /path/to/docs:/data/docs:rw \
  -v /path/to/config:/app/config:ro \
  ghcr.io/nullproof-studio/en-quire:latest \
  --config /app/config/en-quire.config.yaml

# Run en-scribe from the same image
docker run -i --rm \
  --entrypoint enscribe \
  -v /path/to/docs:/data/docs:rw \
  -v /path/to/config:/app/config:ro \
  ghcr.io/nullproof-studio/en-quire:latest \
  --config /app/config/en-scribe.config.yaml

# Publish to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
docker push ghcr.io/nullproof-studio/en-quire:latest
docker tag ghcr.io/nullproof-studio/en-quire:latest ghcr.io/nullproof-studio/en-quire:0.2.0
docker push ghcr.io/nullproof-studio/en-quire:0.2.0
```

When using streamable-http transport, the image includes a health check at `GET /health`:

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
- **v0.2 — Governance** (shipped): Proposal workflows, remote push (`git.push_proposals`), PR hooks (`git.pr_hook`), safe approve with pre-flight fetch, commit-metadata hydration, startup fetch-prune reconciliation, HTTP bearer-token auth + session-bound callers, localhost-default binding, authorization correctness fixes (rename destination scope, file-scoped approve/reject, branch-validated reject), symlink-ancestor realpath check.
- **v0.2 — remaining**: Audit log queries, conflict detection (`can_merge` / `conflicts[]`).
- **v0.3 — Search & Intelligence**: Semantic vector search, cross-document reference tracking, inverse lookups, context bundle builder.
- **v0.4 — Scale & Polish**: Bulk operations, watch mode, plugin hooks.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

© 2026 Nullproof Studio. Released under the MIT License.
