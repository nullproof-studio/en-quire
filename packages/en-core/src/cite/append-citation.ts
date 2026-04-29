// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

/**
 * Build the new document body that includes a citation reference line in
 * the Citations section. Pure: takes the old body, the formatted reference
 * line (already validated by format.ts), and the configured section
 * heading; returns the new body. The handler then routes this through
 * executeWrite() so git/index/etag concerns stay in one place.
 *
 * Behaviour:
 *  - If a top-level heading matching `sectionHeading` (case-insensitive)
 *    already exists, the new line is appended to that section's body.
 *  - Otherwise a new `## {sectionHeading}` section is appended at the end
 *    of the document.
 *
 * Content-free contract: this function never invents or transforms text.
 * The reference line is inserted verbatim. The only added bytes are the
 * heading framing when the section is new.
 */
export function buildCitationAppend(
  before: string,
  referenceLine: string,
  sectionHeading: string,
): string {
  const headingRegex = buildHeadingRegex(sectionHeading);
  const match = headingRegex.exec(before);
  if (match) {
    return appendInsideExistingSection(before, match, referenceLine);
  }
  return appendNewSection(before, sectionHeading, referenceLine);
}

function buildHeadingRegex(heading: string): RegExp {
  // Match a line that starts with one or more `#`, a single space, then the
  // heading text (case-insensitive), trailing optional whitespace, then end
  // of line. Anchored to a line start so we don't match heading-shaped text
  // inside a paragraph.
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\n)(#{1,6})\\s+${escaped}\\s*(?=\\n|$)`, 'im');
}

function appendInsideExistingSection(
  body: string,
  match: RegExpExecArray,
  referenceLine: string,
): string {
  const headingLineStart = match[1] === '\n' ? match.index + 1 : match.index;
  // Find the end of the heading line.
  const afterHeading = body.indexOf('\n', headingLineStart);
  const headingEnd = afterHeading === -1 ? body.length : afterHeading;
  // The Citations section runs until the next heading at the same level or
  // higher. Find that boundary.
  const headingHashes = match[2];
  const sectionEnd = findNextHeadingOfLevelOrHigher(body, headingEnd, headingHashes.length);

  // Extract the section body and trim trailing whitespace before splicing.
  const sectionStart = headingEnd;
  const beforeSection = body.slice(0, sectionStart);
  const sectionBody = body.slice(sectionStart, sectionEnd);
  const afterSection = body.slice(sectionEnd);

  // Strip trailing whitespace/newlines from the existing section body so we
  // can re-add a deterministic single blank line + the new reference line.
  const trimmed = sectionBody.replace(/\s+$/, '');
  const newSectionBody = `${trimmed}\n\n${referenceLine}\n`;

  return beforeSection + newSectionBody + afterSection;
}

function findNextHeadingOfLevelOrHigher(
  body: string,
  fromOffset: number,
  level: number,
): number {
  // Search line-by-line from fromOffset for the next heading of level <= level.
  // Returns the offset of the line start, or body.length if none.
  let i = fromOffset;
  while (i < body.length) {
    const lineEnd = body.indexOf('\n', i);
    const end = lineEnd === -1 ? body.length : lineEnd;
    const line = body.slice(i, end);
    const m = /^(#{1,6})\s+\S/.exec(line);
    if (m && m[1].length <= level) {
      return i;
    }
    if (lineEnd === -1) return body.length;
    i = lineEnd + 1;
  }
  return body.length;
}

function appendNewSection(body: string, heading: string, referenceLine: string): string {
  const trimmed = body.replace(/\s+$/, '');
  const lead = trimmed.length === 0 ? '' : '\n';
  return `${trimmed}${lead}\n## ${heading}\n\n${referenceLine}\n`;
}
