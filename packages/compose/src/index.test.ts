import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

describe('@despawn/compose', () => {
  it('exports a valid non-empty VERSION string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
