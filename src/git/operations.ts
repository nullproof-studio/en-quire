// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitRequiredError } from '../shared/errors.js';
import { detectGit } from './detector.js';

export class GitOperations {
  private git: SimpleGit;
  private _available: boolean;

  constructor(documentRoot: string, forceEnabled?: boolean | null) {
    this.git = simpleGit(documentRoot);
    const detection = detectGit(documentRoot);
    this._available = forceEnabled === false ? false : detection.available;
  }

  get available(): boolean {
    return this._available;
  }

  private requireGit(operation: string): void {
    if (!this._available) {
      throw new GitRequiredError(operation);
    }
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

  async switchToMain(): Promise<void> {
    this.requireGit('switch to main');
    // Try 'main' first, fall back to 'master'
    try {
      await this.git.checkout('main');
    } catch {
      await this.git.checkout('master');
    }
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
    return await this.git.diff(['main...', branch]);
  }

  async getModifiedFiles(): Promise<string[]> {
    this.requireGit('get modified files');
    const status = await this.git.status();
    return [...status.modified, ...status.not_added, ...status.created];
  }

  async getLog(branch?: string): Promise<Array<{ hash: string; message: string; date: string }>> {
    this.requireGit('get log');
    const options = branch ? { from: 'main', to: branch } : {};
    const log = await this.git.log(options);
    return log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
    }));
  }
}
