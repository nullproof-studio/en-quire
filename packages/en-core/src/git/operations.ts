// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { simpleGit, type SimpleGit } from 'simple-git';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  private _documentRoot: string;

  constructor(
    documentRoot: string,
    forceEnabled?: boolean | null,
    configuredDefaultBranch?: string | null,
    remote?: string | null,
    pushProposals?: boolean | null,
    prHook?: string | null,
  ) {
    this._documentRoot = documentRoot;
    this.git = simpleGit(documentRoot);
    const detection = detectGit(documentRoot);
    this._available = forceEnabled === false ? false : detection.available;
    this._configuredDefault = configuredDefaultBranch ?? null;
    this._remote = remote ?? null;
    this._pushProposals = pushProposals === true;
    this._prHook = prHook ?? null;
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
   * Run the configured `git.pr_hook` command with per-token substitution
   * of `{branch}`, `{file}`, and `{caller}`. The command is tokenised FIRST,
   * then each token is substituted individually, so a substituted value that
   * contains whitespace or shell metacharacters cannot split into new argv
   * entries. Uses `execFile` (never `exec`), so the shell is never invoked.
   *
   * Returns `{ ran: false }` quietly when the hook is not configured. Hook
   * failures (non-zero exit, missing command, timeout) surface as warnings,
   * never thrown — a failed hook must not roll back the proposal commit
   * that already landed.
   */
  async runPrHook(subs: { branch: string; file: string; caller: string }): Promise<{ ran: boolean; warning?: string }> {
    if (!this._prHook) return { ran: false };

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
