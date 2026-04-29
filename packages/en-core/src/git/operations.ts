// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { simpleGit, type SimpleGit } from 'simple-git';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac } from 'node:crypto';
import { GitRequiredError, ValidationError } from '../shared/errors.js';
import { tokeniseCommand } from '../shared/tokenise-command.js';
import { detectGit } from './detector.js';

const execFileAsync = promisify(execFile);

export class GitOperations {
  private git: SimpleGit;
  private _available: boolean;
  private _configuredDefault: string | null;
  private _defaultBranch?: string;
  private _remote: string | null;
  private _pushProposals: boolean;
  private _prHook: string | null;
  private _prHookSecret: string | null;
  private _documentRoot: string;

  constructor(
    documentRoot: string,
    forceEnabled?: boolean | null,
    configuredDefaultBranch?: string | null,
    remote?: string | null,
    pushProposals?: boolean | null,
    prHook?: string | null,
    prHookSecret?: string | null,
  ) {
    this._documentRoot = documentRoot;
    this.git = simpleGit(documentRoot);
    const detection = detectGit(documentRoot);
    this._available = forceEnabled === false ? false : detection.available;
    this._configuredDefault = configuredDefaultBranch ?? null;
    this._remote = remote ?? null;
    this._pushProposals = pushProposals === true;
    this._prHook = prHook ?? null;
    this._prHookSecret = prHookSecret ?? null;
  }

  get available(): boolean {
    return this._available;
  }

  private requireGit(operation: string): void {
    if (!this._available) {
      throw new GitRequiredError(operation);
    }
  }

  /**
   * Resolve the repo's default branch name. Precedence:
   *   1. `git.default_branch` from config (explicit override)
   *   2. `refs/remotes/origin/HEAD` (what origin says is default)
   *   3. Local `main` or `master`, in that order
   *   4. Fallback to `main`
   * The result is memoised — a repo's default branch doesn't change during
   * a server session, so one probe is enough.
   */
  async resolveDefaultBranch(): Promise<string> {
    this.requireGit('resolve default branch');
    if (this._defaultBranch) return this._defaultBranch;

    if (this._configuredDefault) {
      this._defaultBranch = this._configuredDefault;
      return this._defaultBranch;
    }

    const remoteHead = await this.detectRemoteHead();
    if (remoteHead) {
      this._defaultBranch = remoteHead;
      return this._defaultBranch;
    }

    this._defaultBranch = await this.detectLocalDefault();
    return this._defaultBranch;
  }

  private async detectRemoteHead(): Promise<string | null> {
    try {
      const result = await this.git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      const trimmed = result.trim();
      return trimmed.startsWith('origin/') ? trimmed.slice('origin/'.length) : trimmed;
    } catch {
      return null;
    }
  }

  private async detectLocalDefault(): Promise<string> {
    try {
      const { all } = await this.git.branchLocal();
      if (all.includes('main')) return 'main';
      if (all.includes('master')) return 'master';
    } catch {
      // fall through
    }
    return 'main';
  }

  async commitFile(filePath: string, message: string): Promise<string> {
    this.requireGit('commit');
    await this.git.add(filePath);
    const result = await this.git.commit(message, filePath);
    return result.commit;
  }

  async commitFiles(filePaths: string[], message: string): Promise<string> {
    this.requireGit('commit');
    await this.git.add(filePaths);
    const result = await this.git.commit(message, filePaths);
    return result.commit;
  }

  async createBranch(name: string): Promise<void> {
    this.requireGit('create branch');
    await this.git.checkoutLocalBranch(name);
  }

  async switchBranch(name: string): Promise<void> {
    this.requireGit('switch branch');
    await this.git.checkout(name);
  }

  async switchToDefault(): Promise<void> {
    this.requireGit('switch to default branch');
    const def = await this.resolveDefaultBranch();
    await this.git.checkout(def);
  }

  async getCurrentBranch(): Promise<string> {
    this.requireGit('get current branch');
    const status = await this.git.status();
    return status.current ?? 'main';
  }

  async mergeBranch(branch: string, message?: string): Promise<string> {
    this.requireGit('merge');
    const args = message ? ['--no-ff', '-m', message] : ['--no-ff'];
    const result = await this.git.merge([branch, ...args]);
    return result.result ?? '';
  }

  async deleteBranch(branch: string): Promise<void> {
    this.requireGit('delete branch');
    await this.git.deleteLocalBranch(branch, true);
  }

  /**
   * Run the configured `git.pr_hook` for a freshly-committed proposal.
   *
   * Two modes — chosen by the value's shape:
   *   - If `pr_hook` starts with `http://` or `https://`, it's a webhook URL.
   *     `runPrHookWebhook` POSTs the substitution payload as JSON, optionally
   *     signing it with `git.pr_hook_secret` (HMAC-SHA256 → `X-EnQuire-Signature`).
   *   - Otherwise it's a shell command. Tokenised FIRST, then each token
   *     substituted individually so a value with whitespace or shell
   *     metacharacters cannot split into new argv entries. Uses `execFile`
   *     (never `exec`), so the shell is never invoked.
   *
   * Returns `{ ran: false }` quietly when the hook is not configured. Hook
   * failures (non-zero exit, missing command, timeout, non-2xx response,
   * unreachable host) surface as warnings, never thrown — a failed hook
   * must not roll back the proposal commit that already landed.
   */
  async runPrHook(subs: { branch: string; file: string; caller: string }): Promise<{ ran: boolean; warning?: string }> {
    if (!this._prHook) return { ran: false };

    if (this._prHook.startsWith('http://') || this._prHook.startsWith('https://')) {
      return this.runPrHookWebhook(this._prHook, subs);
    }

    const tokens = tokeniseCommand(this._prHook);
    if (tokens.length === 0) {
      return { ran: false, warning: 'pr_hook is set but empty after tokenisation' };
    }

    const substitute = (t: string): string => t
      .replaceAll('{branch}', subs.branch)
      .replaceAll('{file}', subs.file)
      .replaceAll('{caller}', subs.caller);

    const [program, ...rest] = tokens.map(substitute);

    try {
      await execFileAsync(program, rest, {
        cwd: this._documentRoot,
        timeout: 30_000,
        maxBuffer: 1_048_576,
      });
      return { ran: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as NodeJS.ErrnoException | { code?: number }).code;
      const codeSuffix = code !== undefined ? ` (exit ${code})` : '';
      return { ran: false, warning: `pr_hook failed${codeSuffix}: ${msg}` };
    }
  }

  /**
   * Webhook-mode `pr_hook`: POST the substitution payload as JSON to the
   * configured URL. Body shape: `{ branch, file, caller, timestamp }` where
   * `timestamp` is the ISO 8601 string captured at hook time. When
   * `pr_hook_secret` is set, the body is HMAC-SHA256 signed and the digest
   * is sent as `X-EnQuire-Signature: sha256=<hex>`.
   *
   * Failure modes are all converted to a `{ ran: false, warning }` return —
   * never throw. The local proposal commit must not be clobbered when the
   * webhook receiver is down or returning errors.
   */
  private async runPrHookWebhook(
    url: string,
    subs: { branch: string; file: string; caller: string },
  ): Promise<{ ran: boolean; warning?: string }> {
    const body = JSON.stringify({
      branch: subs.branch,
      file: subs.file,
      caller: subs.caller,
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this._prHookSecret) {
      const sig = createHmac('sha256', this._prHookSecret).update(body).digest('hex');
      headers['x-enquire-signature'] = `sha256=${sig}`;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        return { ran: false, warning: `pr_hook webhook failed: ${res.status} ${res.statusText}` };
      }
      return { ran: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ran: false, warning: `pr_hook webhook failed: ${msg}` };
    }
  }

  /**
   * Run `git fetch --prune` against the configured remote. Returns
   * `{ ok: false }` quietly when no remote is configured, and returns a
   * warning string (rather than throwing) on network failures so callers
   * can decide whether to continue gracefully or abort. Used both at
   * bin startup and as the first step of the safe-approve pre-flight.
   */
  async fetchAndPrune(): Promise<{ ok: boolean; warning?: string }> {
    this.requireGit('fetch');
    if (!this._remote) {
      return { ok: false };
    }
    try {
      await this.git.raw(['fetch', '--prune', this._remote]);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, warning: `fetch --prune ${this._remote} failed: ${msg}` };
    }
  }

  /**
   * Push a proposal branch to the configured remote when the root's
   * `git.push_proposals` flag is on. Returns `{ pushed: false }` quietly
   * when either the remote or the flag is not set — the caller doesn't
   * need to pre-check. Push errors are caught and surfaced as a warning
   * string so the local commit is not clobbered when the network fails.
   */
  async pushProposalBranch(branch: string): Promise<{ pushed: boolean; warning?: string }> {
    this.requireGit('push proposal branch');
    if (!this._remote || !this._pushProposals) {
      return { pushed: false };
    }
    try {
      await this.git.push(this._remote, branch);
      return { pushed: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { pushed: false, warning: `Failed to push ${branch} to ${this._remote}: ${msg}` };
    }
  }

  /**
   * Merge a proposal branch into the default branch with safety guarantees:
   *   0. PRE-FLIGHT — if the root has a remote configured, fetch --prune
   *      and verify the proposal branch still exists on the remote.
   *      Refuses if the branch is gone (merged / rejected upstream) or
   *      the remote can't be reached; both cases mean we cannot verify
   *      the proposal's upstream state and merging blindly could produce
   *      a local merge commit that diverges from origin's merge commit,
   *      breaking the next `git push`. Skipped when no remote is
   *      configured (local-only proposals).
   *   1. Remember the caller's current branch.
   *   2. Ensure the working tree is on the default branch before the merge
   *      — otherwise the merge would land on whatever happened to be
   *      checked out.
   *   3. Merge (--no-ff), capture the merge commit SHA, delete the branch.
   *   4. In `finally`, attempt to restore the caller's original branch —
   *      unless the original was the proposal itself (just deleted) or
   *      was already the default.
   * If the merge throws (e.g. a conflict once detection lands), the finally
   * still runs so the working tree doesn't drift away from where the caller
   * left it.
   */
  async approveProposal(branch: string, message: string): Promise<{ merge_commit: string }> {
    this.requireGit('approve proposal');

    // Pre-flight: verify remote state before any mutation. Same principle
    // as etag checks on document writes — writes verify, reads don't.
    if (this._remote) {
      const fetchResult = await this.fetchAndPrune();
      if (!fetchResult.ok) {
        throw new ValidationError(
          `Cannot verify remote state of "${branch}" — ${fetchResult.warning ?? 'remote unreachable'}. ` +
          `Approval refused to prevent divergent history. Try again when the remote is reachable.`,
        );
      }
      try {
        // show-ref --verify exits 128 (rejects) with stderr "fatal:..." when
        // the ref is missing, which simple-git surfaces as a thrown error.
        // The --quiet form exits 1 silently and simple-git treats that as
        // success — so we use the noisy form and swallow the stderr here.
        await this.git.raw(['show-ref', '--verify', `refs/remotes/${this._remote}/${branch}`]);
      } catch {
        throw new ValidationError(
          `Proposal branch "${branch}" is no longer on remote "${this._remote}" — ` +
          `likely merged or rejected upstream already. Pull the default branch to reconcile local state.`,
        );
      }
    }

    const original = await this.getCurrentBranch();
    const def = await this.resolveDefaultBranch();
    const shouldRestore = original !== branch && original !== def;

    try {
      if (original !== def) {
        await this.git.checkout(def);
      }
      await this.mergeBranch(branch, message);
      const mergeCommit = (await this.git.raw(['rev-parse', 'HEAD'])).trim();
      await this.deleteBranch(branch);
      return { merge_commit: mergeCommit };
    } finally {
      if (shouldRestore) {
        try {
          await this.git.checkout(original);
        } catch {
          // Original branch no longer reachable — leave the tree on default.
        }
      }
    }
  }

  async listBranches(pattern?: string): Promise<string[]> {
    this.requireGit('list branches');
    const result = await this.git.branchLocal();
    const branches = result.all;
    if (pattern) {
      return branches.filter((b) => b.startsWith(pattern));
    }
    return branches;
  }

  async getDiff(branch: string): Promise<string> {
    this.requireGit('get diff');
    const def = await this.resolveDefaultBranch();
    return await this.git.diff([`${def}...${branch}`]);
  }

  /**
   * Check whether a proposal branch can be merged into the default branch
   * cleanly. Uses `git merge-tree --write-tree` (git ≥ 2.38) so the working
   * tree, index, and HEAD are untouched — this is a pure read of merge state.
   *
   * Exit semantics of `git merge-tree --write-tree`:
   *   0 — clean merge (output: tree OID)
   *   1 — merge has conflicts (output: tree OID, then conflicting paths)
   *   >1 — error (bad ref, missing object, etc.) — propagated as a throw
   */
  async checkMergeable(branch: string): Promise<{ can_merge: boolean; conflicts: string[] }> {
    this.requireGit('check mergeable');
    const def = await this.resolveDefaultBranch();

    try {
      await execFileAsync(
        'git',
        ['merge-tree', '--write-tree', '--name-only', '--no-messages', def, branch],
        {
          cwd: this._documentRoot,
          timeout: 30_000,
          maxBuffer: 10 * 1_048_576,
        },
      );
      return { can_merge: true, conflicts: [] };
    } catch (err) {
      const e = err as { code?: number | string; stdout?: string; stderr?: string };
      // execFile surfaces the process exit code as `code` (number for normal
      // exits; string like "ETIMEDOUT" for signal/timeout). On conflict (exit
      // 1), stdout is still populated with the tree OID on the first line
      // followed by conflicting file paths.
      if (e.code === 1) {
        const lines = (e.stdout ?? '').split('\n').filter(Boolean);
        const conflicts = lines.length > 1 ? [...new Set(lines.slice(1))] : [];
        return { can_merge: false, conflicts };
      }
      throw err;
    }
  }

  /**
   * Fetch the tip commit of a proposal branch along with the shortstat
   * diff against the default branch. The caller combines these with
   * `parseCommitMessage` to populate the structured metadata fields on
   * `doc_proposals_list` / `doc_proposal_diff` responses.
   */
  async getProposalTipCommit(branch: string): Promise<{
    sha: string;
    authorDate: string;
    message: string;
    diffSummary: string;
  }> {
    this.requireGit('get proposal tip');

    // Use a unique delimiter to isolate the full commit message (subject + body)
    // from git-log's default field-separated output. `%H` = SHA, `%aI` = author
    // date ISO 8601-strict, `%B` = raw body including subject.
    const DELIM = '\x1Fen-quire-log-end\x1F';
    const raw = await this.git.raw(['log', '-1', `--format=%H%n%aI%n%B${DELIM}`, branch]);
    const endIdx = raw.indexOf(DELIM);
    if (endIdx < 0) {
      throw new Error(`No commits on branch: ${branch}`);
    }
    const [sha, authorDate, ...bodyLines] = raw.slice(0, endIdx).split('\n');
    const message = bodyLines.join('\n').trimEnd();

    const def = await this.resolveDefaultBranch();
    const shortstat = (await this.git.raw(['diff', '--shortstat', `${def}...${branch}`])).trim();

    return {
      sha,
      authorDate,
      message,
      diffSummary: shortstat,
    };
  }

  async getModifiedFiles(): Promise<string[]> {
    this.requireGit('get modified files');
    const status = await this.git.status();
    return [...status.modified, ...status.not_added, ...status.created];
  }

  /**
   * Return the commits that touched lines `[lineStart, lineEnd]` of `file`.
   * Uses `git log -L` (line-history) which returns the full diff for each
   * touching commit; we strip to the metadata (sha, date, author, subject)
   * since `doc_history` only surfaces a list, not the diffs themselves.
   *
   * Returns an empty array if `file` is unknown to git or the line range
   * is outside the file. Newest first; capped at `limit`.
   */
  async getLineHistory(
    file: string,
    lineStart: number,
    lineEnd: number,
    limit: number,
  ): Promise<Array<{ sha: string; date: string; author: string; subject: string }>> {
    this.requireGit('get line history');

    if (lineStart < 1 || lineEnd < lineStart) {
      return [];
    }

    // %x1F = unit separator, %x1E = record separator. Stable delimiters
    // that won't appear in normal commit messages, so we don't have to
    // shell-escape anything.
    const recordSep = '\x1Een-quire-history-record\x1E';
    const fieldSep = '\x1F';
    const format = `${fieldSep}%H${fieldSep}%aI${fieldSep}%an${fieldSep}%s${recordSep}`;
    const range = `${lineStart},${lineEnd}:${file}`;

    let raw: string;
    try {
      // -s suppresses the diff body; --no-patch is the modern alias but -s
      // is supported by every git that supports -L.
      raw = await this.git.raw(['log', '-s', `-L${range}`, `--format=${format}`, `-n${limit}`]);
    } catch {
      return [];
    }

    const records = raw.split(recordSep).map((r) => r.trim()).filter(Boolean);
    return records.map((record) => {
      const [, sha, date, author, subject] = record.split(fieldSep);
      return { sha, date, author, subject };
    }).filter((r) => r.sha);
  }

  async getLog(branch?: string): Promise<Array<{ hash: string; message: string; date: string }>> {
    this.requireGit('get log');
    const def = branch ? await this.resolveDefaultBranch() : undefined;
    const options = branch ? { from: def, to: branch } : {};
    const log = await this.git.log(options);
    return log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
    }));
  }
}
