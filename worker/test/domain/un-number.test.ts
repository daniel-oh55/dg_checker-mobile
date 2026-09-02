import { describe, expect, it } from 'vitest';
import { normalizeUnNumber } from '../../src/domain/un-number';

describe('normalizeUnNumber', () => {
  it('accepts a plain 4-digit UNNO', () => {
    expect(normalizeUnNumber('3077')).toBe('3077');
  });

  it('strips a UN prefix', () => {
    expect(normalizeUnNumber('UN3077')).toBe('3077');
  });

  it('strips a UN prefix followed by whitespace', () => {
    expect(normalizeUnNumber('UN 3077')).toBe('3077');
  });

  it('is case-insensitive on the prefix', () => {
    expect(normalizeUnNumber('un 3077')).toBe('3077');
  });

  it('zero-pads a short number', () => {
    expect(normalizeUnNumber('4')).toBe('0004');
  });

  it('accepts an already zero-padded number', () => {
    expect(normalizeUnNumber('0004')).toBe('0004');
  });

  it('rejects an empty string', () => {
    expect(normalizeUnNumber('')).toBeNull();
  });

  it('rejects a bare UN prefix with no digits', () => {
    expect(normalizeUnNumber('UN')).toBeNull();
  });

  it('rejects a number with too many digits', () => {
    expect(normalizeUnNumber('12345')).toBeNull();
  });

  it('rejects non-digit characters', () => {
    expect(normalizeUnNumber('30A7')).toBeNull();
  });

  it('rejects a negative number', () => {
    expect(normalizeUnNumber('-1')).toBeNull();
  });

  it('rejects whitespace-only input', () => {
    expect(normalizeUnNumber('   ')).toBeNull();
  });
});
