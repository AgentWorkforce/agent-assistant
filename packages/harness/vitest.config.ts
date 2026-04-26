import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const workspacePackageRoot = (name: string) =>
  fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agent-assistant/connectivity': workspacePackageRoot('connectivity'),
      '@agent-assistant/core': workspacePackageRoot('core'),
      '@agent-assistant/coordination': workspacePackageRoot('coordination'),
      '@agent-assistant/traits': workspacePackageRoot('traits'),
      '@agent-assistant/turn-context': workspacePackageRoot('turn-context'),
      '@agent-assistant/vfs': workspacePackageRoot('vfs'),
    },
  },
  test: {
    environment: 'node',
  },
});
