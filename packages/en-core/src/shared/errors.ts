// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

export class EnquireError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EnquireError';
    this.code = code;
  }
}

export class NotFoundError extends EnquireError {
  constructor(
    public readonly resource: 'file' | 'section' | 'root',
    public readonly target: string,
    public readonly candidates?: string[],
    formatHint?: string,
  ) {
    const fmt = formatHint ? ` ${formatHint}` : '';
    const hint = candidates?.length
      ? ` Did you mean: ${candidates.join(', ')}?`
      : '';
    super('not_found', `${resource} not found: "${target}".${fmt}${hint}`);
    this.name = 'NotFoundError';
  }
}

export class AddressResolutionError extends EnquireError {
  constructor(
    public readonly address: string,
    public readonly reason: string,
    public readonly candidates?: string[],
  ) {
    const hint = candidates?.length
      ? ` Possible matches: ${candidates.join(', ')}`
      : '';
    super('address_resolution_error', `Cannot resolve section address "${address}": ${reason}.${hint}`);
    this.name = 'AddressResolutionError';
  }
}

export class PermissionDeniedError extends EnquireError {
  constructor(
    public readonly caller: string,
    public readonly permission: string,
    public readonly path: string,
  ) {
    super(
      'permission_denied',
      `Permission denied: "${permission}" access required for the requested path.`,
    );
    this.name = 'PermissionDeniedError';
  }
}

export class GitRequiredError extends EnquireError {
  constructor(operation: string) {
    super(
      'proposal_requires_git',
      `${operation} requires a git repository. Run 'git init' in the document root to enable governance features, or use mode: 'write' for direct edits.`,
    );
    this.name = 'GitRequiredError';
  }
}

export class EncodingError extends EnquireError {
  constructor(
    public readonly filePath: string,
    public readonly byteOffset?: number,
  ) {
    const offsetInfo = byteOffset !== undefined ? ` at byte offset ${byteOffset}` : '';
    super(
      'encoding_error',
      `File contains invalid UTF-8${offsetInfo}. en-quire requires valid UTF-8 documents.`,
    );
    this.name = 'EncodingError';
  }
}

export class ValidationError extends EnquireError {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super('validation_error', message);
    this.name = 'ValidationError';
  }
}

export class PreconditionFailedError extends EnquireError {
  constructor(
    public readonly file: string,
    public readonly current_etag: string,
    message: string,
  ) {
    super('precondition_failed', message);
    this.name = 'PreconditionFailedError';
  }
}

export class PathTraversalError extends EnquireError {
  constructor(public readonly path: string) {
    super(
      'path_traversal',
      `Path attempts to escape the document root. All paths must resolve within the document root.`,
    );
    this.name = 'PathTraversalError';
  }
}

export class MergeConflictError extends EnquireError {
  constructor(
    public readonly branch: string,
    public readonly conflicts: string[],
  ) {
    const list = conflicts.length ? conflicts.map((c) => `  - ${c}`).join('\n') : '  (no paths reported)';
    super(
      'merge_conflict',
      `Proposal "${branch}" cannot be merged cleanly into the default branch — ` +
      `it conflicts with concurrent changes in:\n${list}\n` +
      `Rebase the proposal onto the latest default branch (or reject and re-propose) before approving.`,
    );
    this.name = 'MergeConflictError';
  }
}
