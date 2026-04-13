# Contributing to Agent Assistant SDK

Thank you for your interest in contributing. This guide covers everything you need to get started.

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Setup

```bash
git clone <repo-url>
cd relay-agent-assistant
npm install
```

### Verify the install

```bash
npx vitest run
```

You should see passing tests across the implemented packages (core, sessions, surfaces, traits, routing, proactive, policy). Connectivity and coordination tests may be blocked if workspace install is incomplete — see [docs/current-state.md](docs/current-state.md) for current blockers.

> **Note:** `@agent-assistant/memory` is excluded from the workspace install because it depends on `@agent-relay/memory` (relay foundation infrastructure) which is not yet publicly available. This is expected.

---

## Development Flow

This repo follows a **spec → implement → review** flow:

1. Write or update a spec in `docs/specs/` and mark it `IMPLEMENTATION_READY`
2. Implement against the spec — code and tests
3. Submit a PR; a review verdict is written before merge
4. Packages that pass review are marked `SPEC_RECONCILED` or `IMPLEMENTATION_READY`

**New packages require a spec before implementation begins.** Open an issue to discuss scope if you are proposing a new package.

---

## PR Process

1. **Run tests before opening a PR:**
   ```bash
   npx vitest run
   ```
   All existing tests must pass.

2. **New behavior requires new tests.** The test count in [docs/current-state.md](docs/current-state.md) must stay accurate.

3. **Spec first for new packages.** If your PR introduces a new `packages/` directory, it must include a corresponding spec in `docs/specs/`.

4. **Keep PRs focused.** One logical change per PR. Separate refactors from features.

5. **Sign your commits** with a DCO sign-off:
   ```
   git commit -s -m "feat: your change description"
   ```
   By signing, you certify that you wrote the contribution or have the right to submit it under the MIT license (per the [Developer Certificate of Origin](https://developercertificate.org/)).

---

## Code Style

- **TypeScript strict mode** — `"strict": true` in all `tsconfig.json` files
- **ESM modules** — all packages use `"type": "module"`
- **No circular dependencies** — packages may not import from packages that depend on them
- **No `any`** — use `unknown` and narrow, or open an issue if a type is genuinely impossible to express

Run typecheck:
```bash
cd packages/<package-name>
npx tsc --noEmit
```

---

## Test Requirements

- All existing tests must pass (`npx vitest run` from repo root)
- New exported behavior must have corresponding tests
- Tests should be deterministic and not depend on network or filesystem state
- Use `vitest` — do not add new test frameworks

---

## Reporting Issues

Open a GitHub issue with:
- A clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Node.js and npm version (`node --version`, `npm --version`)

For security issues, do not open a public issue — contact the maintainers directly.

---

## Package Structure

Each package under `packages/` follows this layout:

```
packages/<name>/
  src/
    index.ts        # public API surface
    types.ts        # exported types
  tests/
    <name>.test.ts
  package.json
  tsconfig.json
```

The public API is everything exported from `src/index.ts`. Internal modules are not part of the contract.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
