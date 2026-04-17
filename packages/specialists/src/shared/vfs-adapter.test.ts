import { describe, expect, it } from 'vitest';

import { matchesFilters } from './vfs-adapter.js';

describe('matchesFilters', () => {
  it('matches filters against VFS entry properties', () => {
    expect(
      matchesFilters(
        {
          path: '/issues/1',
          type: 'file',
          properties: {
            state: 'open',
            repo: 'AgentWorkforce/sage',
          },
        },
        {
          state: ['open'],
          repo: ['AgentWorkforce/sage'],
        },
      ),
    ).toBe(true);
  });

  it('rejects entries missing a requested property value', () => {
    expect(
      matchesFilters(
        {
          path: '/issues/2',
          type: 'file',
          properties: {
            state: 'closed',
          },
        },
        {
          state: ['open'],
        },
      ),
    ).toBe(false);
  });
});
