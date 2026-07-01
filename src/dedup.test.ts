import { describe, expect, test } from 'bun:test';

import { Deduper, TagDeduper } from './dedup';

describe('dedup', () => {
  test('first read of a key is accepted', () => {
    const d = new Deduper(1000);
    expect(d.accept('A')).toBe(true);
  });

  test('repeated reads within the window are dropped', () => {
    const d = new Deduper(1000);
    const now = Date.now();
    expect(d.accept('A', now)).toBe(true);
    expect(d.accept('A', now + 100)).toBe(false);
    expect(d.accept('A', now + 500)).toBe(false);
  });

  test('read after the window expires is accepted again', () => {
    const d = new Deduper(1000);
    const now = Date.now();
    expect(d.accept('A', now)).toBe(true);
    expect(d.accept('A', now + 1001)).toBe(true);
  });

  test('distinct keys are independent', () => {
    const d = new Deduper(1000);
    expect(d.accept('A')).toBe(true);
    expect(d.accept('B')).toBe(true);
    expect(d.accept('A')).toBe(false);
  });

  test('prune removes expired entries', () => {
    const d = new Deduper(1000);
    const now = Date.now();
    d.accept('A', now);
    d.accept('B', now);
    expect(d.prune(now + 2000)).toBe(2);
  });

  test('TagDeduper is a Deduper keyed by EPC', () => {
    const d = new TagDeduper(500);
    expect(d.accept('e28011052000')).toBe(true);
    expect(d.accept('e28011052000')).toBe(false);
    expect(d.accept('e2801105200f')).toBe(true);
  });
});
