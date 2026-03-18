// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { EncodingInfo, LineEnding } from '../shared/types.js';
import { EncodingError } from '../shared/errors.js';

const BOM = '\uFEFF';

/**
 * Validate that a buffer contains valid UTF-8.
 * Throws EncodingError if invalid sequences are found.
 */
export function validateUtf8(buffer: Buffer, filePath: string): void {
  // Node.js TextDecoder with fatal: true will throw on invalid UTF-8
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    decoder.decode(buffer);
  } catch {
    // Find approximate byte offset of the invalid sequence
    for (let i = 0; i < buffer.length; i++) {
      try {
        decoder.decode(buffer.subarray(0, i + 1));
      } catch {
        throw new EncodingError(filePath, i);
      }
    }
    throw new EncodingError(filePath);
  }
}

/**
 * Detect the line ending style used in a string.
 * Returns the most common line ending, defaulting to '\n'.
 */
export function detectLineEnding(content: string): LineEnding {
  const crlf = (content.match(/\r\n/g) || []).length;
  const cr = (content.match(/\r(?!\n)/g) || []).length;
  const lf = (content.match(/(?<!\r)\n/g) || []).length;

  if (crlf >= lf && crlf >= cr && crlf > 0) return '\r\n';
  if (cr > lf && cr > 0) return '\r';
  return '\n';
}

/**
 * Detect encoding metadata from raw content.
 */
export function detectEncoding(content: string): EncodingInfo {
  return {
    hasBom: content.startsWith(BOM),
    lineEnding: detectLineEnding(content),
  };
}

/**
 * Normalise content on read (inbound):
 * - Strip BOM
 * - Normalise line endings to \n
 * - Apply NFC Unicode normalisation
 */
export function normaliseInbound(content: string): string {
  let result = content;

  // Strip BOM
  if (result.startsWith(BOM)) {
    result = result.slice(1);
  }

  // Normalise line endings to \n
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // NFC Unicode normalisation
  result = result.normalize('NFC');

  return result;
}

/**
 * Normalise content on write (outbound):
 * - Apply NFC Unicode normalisation
 * - Convert line endings to the target style
 * - No BOM added
 */
export function normaliseOutbound(content: string, lineEnding: LineEnding = '\n'): string {
  // NFC normalisation
  let result = content.normalize('NFC');

  // Ensure internal \n first, then convert to target
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (lineEnding !== '\n') {
    result = result.replace(/\n/g, lineEnding);
  }

  return result;
}

/**
 * Read and normalise a file buffer into a string.
 * Validates UTF-8, strips BOM, normalises line endings and Unicode.
 * Returns the normalised content and detected encoding info.
 */
export function decodeAndNormalise(
  buffer: Buffer,
  filePath: string,
): { content: string; encoding: EncodingInfo } {
  validateUtf8(buffer, filePath);
  const raw = buffer.toString('utf-8');
  const encoding = detectEncoding(raw);
  const content = normaliseInbound(raw);
  return { content, encoding };
}
