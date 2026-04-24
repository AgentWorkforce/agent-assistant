import { describe, expect, it } from 'vitest';
import { USING_RELAYFILE_VFS_SKILL } from './using-relayfile-vfs.js';

describe('USING_RELAYFILE_VFS_SKILL', () => {
  it('is a non-empty string', () => {
    expect(typeof USING_RELAYFILE_VFS_SKILL).toBe('string');
    expect(USING_RELAYFILE_VFS_SKILL.length).toBeGreaterThan(0);
  });

  it('contains the load-bearing phrases', () => {
    expect(USING_RELAYFILE_VFS_SKILL).toContain('workspace_list');
    expect(USING_RELAYFILE_VFS_SKILL).toContain('/github/repos');
    expect(USING_RELAYFILE_VFS_SKILL).toContain('cite');
    expect(USING_RELAYFILE_VFS_SKILL).toContain('/_conventions/');
  });
});
