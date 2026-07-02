import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { defaultConfig, setConfigOverride } from './config';
import { isSessionPaused, shouldSkipAutoAuth } from './session';

describe('session', () => {
  beforeEach(() => {
    setConfigOverride(defaultConfig());
  });

  afterEach(() => {
    setConfigOverride(null);
  });

  it('shouldSkipAutoAuth when sessionPaused', () => {
    expect(shouldSkipAutoAuth({ ...defaultConfig(), sessionPaused: true })).toBe(true);
    expect(shouldSkipAutoAuth({ ...defaultConfig(), sessionPaused: false })).toBe(false);
  });

  it('isSessionPaused when sessionPaused and no token', () => {
    setConfigOverride({ ...defaultConfig(), sessionPaused: true });
    expect(isSessionPaused()).toBe(true);
  });

  it('isSessionPaused false when paired', () => {
    setConfigOverride({ ...defaultConfig(), token: 'x', deviceId: 'd', sessionPaused: false });
    expect(isSessionPaused()).toBe(false);
  });
});
