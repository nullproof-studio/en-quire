// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitRequiredError } from '../shared/errors.js';
import { detectGit } from './detector.js';

export class GitOperations {
  private git: SimpleGit;
  private _available: boolean;
  private _configuredDefault: string | null;
  private _defaultBranch?: string;

  constructor(
    documentRoot: string,
    forceEnabled?: boolean | null,
    configuredDefaultBranch?: string | null,
  ) {
    this.git = simpleGit(documentRoot);
    const detection = detectGit(documentRoot);
    this._available = forceEnabled === false ? false : detection.available;
    this._configuredDefault = configuredDefaultBranch ?? null;
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
   * Merge a proposal branch into the default branch with safety guarantees:
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
