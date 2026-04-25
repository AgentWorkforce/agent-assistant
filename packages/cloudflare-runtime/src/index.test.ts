import { describe, expect, it } from 'vitest';

import { handleCfQueue, handleCfTurnQueue } from './index.js';
import { handleCfQueue as executorHandleCfQueue } from './executor/cf-turn-executor.js';

describe('package entrypoints', () => {
  it('exports the real queue executor as handleCfQueue', () => {
    expect(handleCfQueue).toBe(executorHandleCfQueue);
  });

  it('keeps handleCfTurnQueue as an alias of the same executor', () => {
    expect(handleCfTurnQueue).toBe(executorHandleCfQueue);
  });
});
