// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import {
  validateUtf8,
  detectLineEnding,
  normaliseInbound,
  normaliseOutbound,
  decodeAndNormalise,
} from '../../../src/document/encoding.js';
import { EncodingError } from '../../../src/shared/errors.js';

describe('encoding', () => {
  describe('validateUtf8', () => {
    it('accepts valid UTF-8', () => {
      const buf = Buffer.from('Hello, World! 🚀', 'utf-8');
      expect(() => validateUtf8(buf, 'test.md')).not.toThrow();
    });

    it('rejects invalid UTF-8', () => {
      // 0xFF is not valid UTF-8
      const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xff]);
      expect(() => validateUtf8(buf, 'test.md')).toThrow(EncodingError);
    });
  });

  describe('detectLineEnding', () => {
    it('detects LF', () => {
      expect(detectLineEnding('line1\nline2\nline3')).toBe('\n');
    });

    it('detects CRLF', () => {
      expect(detectLineEnding('line1\r\nline2\r\nline3')).toBe('\r\n');
    });

    it('detects CR', () => {
      expect(detectLineEnding('line1\rline2\rline3')).toBe('\r');
    });

    it('defaults to LF for empty content', () => {
      expect(detectLineEnding('')).toBe('\n');
    });
  });

  describe('normaliseInbound', () => {
    it('strips BOM', () => {
      expect(normaliseInbound('\uFEFFHello')).toBe('Hello');
    });

    it('normalises CRLF to LF', () => {
      expect(normaliseInbound('line1\r\nline2')).toBe('line1\nline2');
    });

    it('normalises CR to LF', () => {
      expect(normaliseInbound('line1\rline2')).toBe('line1\nline2');
    });

    it('applies NFC normalisation', () => {
      // e + combining acute accent → precomposed é
      const decomposed = 'e\u0301';
      const result = normaliseInbound(decomposed);
      expect(result).toBe('\u00e9');
    });

    it('preserves emoji', () => {
      expect(normaliseInbound('🚀 test')).toBe('🚀 test');
    });
  });

  describe('normaliseOutbound', () => {
    it('applies NFC normalisation', () => {
      const decomposed = 'e\u0301';
      const result = normaliseOutbound(decomposed);
      expect(result).toBe('\u00e9');
    });

    it('converts to CRLF when requested', () => {
      expect(normaliseOutbound('line1\nline2', '\r\n')).toBe('line1\r\nline2');
    });

    it('defaults to LF', () => {
      expect(normaliseOutbound('line1\nline2')).toBe('line1\nline2');
    });
  });

  describe('decodeAndNormalise', () => {
    it('processes a valid UTF-8 buffer', () => {
      const buf = Buffer.from('# Hello\n\nWorld\n', 'utf-8');
      const { content, encoding } = decodeAndNormalise(buf, 'test.md');
      expect(content).toBe('# Hello\n\nWorld\n');
      expect(encoding.hasBom).toBe(false);
      expect(encoding.lineEnding).toBe('\n');
    });

    it('strips BOM and detects original encoding', () => {
      const buf = Buffer.from('\uFEFF# Hello\r\nWorld\r\n', 'utf-8');
      const { content, encoding } = decodeAndNormalise(buf, 'test.md');
      expect(content).toBe('# Hello\nWorld\n');
      expect(encoding.hasBom).toBe(true);
      expect(encoding.lineEnding).toBe('\r\n');
    });

    it('throws on invalid UTF-8', () => {
      const buf = Buffer.from([0xff, 0xfe]);
      expect(() => decodeAndNormalise(buf, 'bad.md')).toThrow(EncodingError);
    });
  });
});
