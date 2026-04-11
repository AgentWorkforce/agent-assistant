Implemented the v1 connectivity package under `packages/connectivity/` with the required shape:

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `src/types.ts`
- `src/connectivity.ts`
- `src/connectivity.test.ts`
- `README.md`

What’s included:
- TypeScript-first v1 signal envelope and public types
- In-memory connectivity runtime with:
  - signal emit/get/query/resolve/advanceStep
  - validation and class-specific confidence bounds
  - salience-related suppression behavior within v1 scope
  - audience semantics (`self`, `coordinator`, `selected`, `all`)
  - suppression for step/time windows
  - supersession, expiry, and resolution lifecycle
  - escalation hook interface only, with no routing implementation
- Tests covering core behavior and intended first workflows:
  - narrowcast attention
  - reviewer conflict
  - specialist handoff
  - blocker uncertainty routing escalation
- README rewritten as actual package documentation and ending with `CONNECTIVITY_PACKAGE_IMPLEMENTED`

Verification completed:
- `npm test` passed in `packages/connectivity`
- `npm run build` passed in `packages/connectivity`

Artifacts produced:
- Source package files under `packages/connectivity/`
- No generated `node_modules` or `dist` left in the package directory after verification
