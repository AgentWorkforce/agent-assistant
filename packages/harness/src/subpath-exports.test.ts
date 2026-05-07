import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildIntegrationsLayer,
  createBashToolRegistry,
  createWorkspaceToolRegistry,
} from './index.js';
import { createNestedSubagentRunner } from './registries/index.js';

describe('package subpath export hygiene', () => {
  it('declares additive public subpaths for split harness surfaces', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(fileURLToPath(new URL('..', import.meta.url)), 'package.json'), 'utf8'),
    ) as { exports: Record<string, { import: string; types: string }> };

    expect(pkg.exports['./registries']).toEqual({
      import: './dist/registries/index.js',
      types: './dist/registries/index.d.ts',
    });
    expect(pkg.exports['./router']).toEqual({
      import: './dist/router/index.js',
      types: './dist/router/index.d.ts',
    });
    expect(pkg.exports['./prompt']).toEqual({
      import: './dist/prompt/index.js',
      types: './dist/prompt/index.d.ts',
    });
    expect(pkg.exports['./runtime-policy']).toEqual({
      import: './dist/runtime-policy/index.js',
      types: './dist/runtime-policy/index.d.ts',
    });
    expect(pkg.exports['./mcp']).toEqual({
      import: './dist/mcp/index.js',
      types: './dist/mcp/index.d.ts',
    });
  });

  it('exports the nested runner from the registries subpath', () => {
    expect(createNestedSubagentRunner).toEqual(expect.any(Function));
  });

  it('keeps deprecated root imports compatible with one warning per symbol', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      createBashToolRegistry({ allowedCommands: [] });
      createBashToolRegistry({ allowedCommands: [] });
      createWorkspaceToolRegistry({});
      createWorkspaceToolRegistry({});
      buildIntegrationsLayer({});
      buildIntegrationsLayer({});
      expect(warn).toHaveBeenCalledTimes(3);
      expect(warn.mock.calls[0]?.[0]).toContain('@agent-assistant/harness/registries');
      expect(warn.mock.calls[1]?.[0]).toContain('createWorkspaceToolRegistry');
      expect(warn.mock.calls[1]?.[0]).toContain('@agent-assistant/harness/registries');
      expect(warn.mock.calls[2]?.[0]).toContain('@agent-assistant/harness/prompt');
    } finally {
      warn.mockRestore();
    }
  });
});
