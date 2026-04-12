# Workforce Profile Consumption Plan — RelayAssistant

> Specifies the direct Workforce npm-provenance-publisher profile consumption path.
> Identifies the exact missing export, confirms BLOCKER-WF-001, and documents what
> the publish workflow does in the interim.
> Date: 2026-04-12

---

## Required Consumption

The RelayAssistant publish infrastructure MUST consume the Workforce npm-provenance-publisher profile directly from the Workforce repository as an authoritative, versioned, programmatic source — not via copy-paste of persona data into this repo.

**Profile location (filesystem):**
```
workforce/personas/npm-provenance-publisher.json
```

**Profile location (authoritative):**
```
/Users/khaliqgant/Projects/AgentWorkforce/workforce/personas/npm-provenance-publisher.json
```

---

## Current Consumption Capability Assessment

### What the Workforce repo currently exports

| Export | Package | Published | Contains Personas |
|--------|---------|-----------|-------------------|
| `@agentworkforce/workload-router` | `workforce/packages/workload-router` | YES (npm) | NO — routing profiles only |
| `personas/*.json` (flat files) | None | NO | YES |

### Inspection results

- `workforce/package.json` — root `package.json` is `"private": true`; no personas package
- `workforce/packages/` — contains only `workload-router`; no personas package
- `workforce/personas/` — flat directory of JSON files with no `package.json`, no exports, no index
- `workforce/prpm.lock` — exists but contains no personas registry entries
- `@agentworkforce/workload-router/files` — includes `routing-profiles/` directory, NOT `personas/`

**Conclusion: No consumable export surface exists for `workforce/personas/npm-provenance-publisher.json`.**

---

## BLOCKER-WF-001: Confirmed

**Status:** ACTIVE BLOCKER

**Description:** The Workforce `npm-provenance-publisher` persona (`workforce/personas/npm-provenance-publisher.json`) has no consumable export surface. There is no npm package, no prpm registry entry, no HTTP endpoint, and no CLI tool that allows downstream repositories to programmatically consume this profile.

**Missing export:**
```
MISSING: @agentworkforce/personas  (npm package — does not exist)
MISSING: prpm registry entry for @workforce/npm-provenance-publisher
MISSING: HTTP endpoint for persona fetch
MISSING: personas/ export in @agentworkforce/workload-router
```

**Exact file that would need to exist (preferred path):**
```
workforce/packages/personas/package.json   ← does not exist
workforce/packages/personas/src/index.ts   ← does not exist
```

**Exact import that would need to work (preferred):**
```typescript
import { npmProvenancePublisher } from '@agentworkforce/personas';
```
This import **does not work** today. The package does not exist on npm.

---

## Resolution Options (in priority order)

### Option 1: Publish `@agentworkforce/personas` npm package (PREFERRED)

**What needs to be created in the Workforce repo:**

```
workforce/packages/personas/
  package.json           ← new package: @agentworkforce/personas
  src/
    index.ts             ← exports all personas as typed objects
    npm-provenance-publisher.ts  ← typed re-export of the JSON
  tsconfig.json
```

`package.json` minimum required content:
```json
{
  "name": "@agentworkforce/personas",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "https://github.com/AgentWorkforce/workforce"
  }
}
```

`src/index.ts` minimum required content:
```typescript
export { default as npmProvenancePublisher } from './personas/npm-provenance-publisher.json' assert { type: 'json' };
// ... other personas
```

**Who needs to act:** Workforce repo maintainers.
**Downstream consumption once resolved:**
```typescript
import { npmProvenancePublisher } from '@agentworkforce/personas';
// Use npmProvenancePublisher.tiers, .skills, etc.
```

---

### Option 2: Register in prpm registry

**What needs to happen:**
- Register `@workforce/npm-provenance-publisher` in the prpm registry at `prpm.dev`
- Update `workforce/prpm.lock` to include the personas registry entry

**Downstream consumption once resolved:**
```bash
prpm install @workforce/npm-provenance-publisher
```

**Who needs to act:** Workforce repo maintainers + prpm registry admin.

---

### Option 3: Expose via stable HTTP endpoint

**What needs to happen:**
- Serve `workforce/personas/npm-provenance-publisher.json` at a stable, versioned URL
- Example: `https://raw.githubusercontent.com/AgentWorkforce/workforce/main/personas/npm-provenance-publisher.json`

**Note:** GitHub raw URLs are technically usable as a stopgap, but are not versioned by semver, can be disrupted by repo moves, and provide no schema validation. This is acceptable as an interim measure only.

**Downstream consumption (interim stopgap only):**
```yaml
# In publish.yml build job:
- name: Fetch Workforce npm-provenance-publisher profile
  run: |
    curl -fsSL "https://raw.githubusercontent.com/AgentWorkforce/workforce/main/personas/npm-provenance-publisher.json" \
      -o /tmp/npm-provenance-publisher.json
    echo "Profile fetched: $(cat /tmp/npm-provenance-publisher.json | node -p 'JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).id')"
```

**Recommendation:** Do NOT implement this as the permanent solution. Use only as an interim bridge while Option 1 is implemented.

---

## Current State: What the Publish Workflow Does Instead

Because BLOCKER-WF-001 is unresolved, the `publish.yml` workflow **does not import the Workforce profile at runtime**. Instead:

1. **Provenance requirements are extracted and hardcoded** in the workflow implementation, with explicit comments citing the Workforce profile as the authoritative source:
   - `permissions: id-token: write` (from profile: required for OIDC)
   - `npm install -g npm@latest` before publish (from profile: prevents stale-runner OIDC failures)
   - `npm publish --provenance` (from profile: mandatory for all production publishes)
   - `repository.url` validation (from profile: required for provenance linking)

2. **The workflow includes a comment** on the `permissions` block referencing the Workforce profile:
   ```yaml
   # Required for npm OIDC provenance attestation.
   # Source: Workforce npm-provenance-publisher profile
   # (workforce/personas/npm-provenance-publisher.json — consumed via filesystem
   #  in workflow orchestration; direct package consumption blocked by BLOCKER-WF-001)
   ```

3. **Profile system prompts and tier configuration are NOT copied** into this repo. Only the concrete technical requirements (permissions, flags, npm upgrade) are extracted and implemented.

4. **The `prpm/npm-trusted-publishing` skill** referenced in the profile SHOULD be applied once prpm is available. Until then, the manual trusted publisher registration process (Task P1-6 in the implementation plan) is the equivalent.

---

## What MUST NOT Happen (Regardless of Blocker Status)

- **DO NOT** copy `workforce/personas/npm-provenance-publisher.json` into this repo as `docs/`, `config/`, or any local file
- **DO NOT** copy the profile's `systemPrompt` contents into workflow files or documentation as if they were this repo's own content
- **DO NOT** treat the interim extracted requirements as a permanent substitute — they must be superseded by direct consumption once BLOCKER-WF-001 is resolved
- **DO NOT** use the GitHub raw URL stopgap (Option 3) as a permanent solution

---

## Handoff Requirements for Workforce Team

To resolve BLOCKER-WF-001, the Workforce team needs to deliver:

1. **A consumable package** (Option 1 preferred) that exports persona JSON with:
   - npm package name: `@agentworkforce/personas` (or add to `@agentworkforce/workload-router`)
   - Stable, versioned export: `import { npmProvenancePublisher } from '@agentworkforce/personas'`
   - Published to npm with `--access public`
   - `repository.url` set to the Workforce GitHub repo

2. **A changelog entry** or release note when the package is published, so downstream repos can pin to a specific version

3. **A schema or TypeScript type** for the persona structure, so consumers can validate the profile shape at import time

Once delivered, update the RelayAssistant publish workflow to:
- Add `@agentworkforce/personas` to the root `package.json` devDependencies
- Import the profile in a pre-publish validation step
- Assert that required provenance fields are present before proceeding with publish

---

## Blocker Tracking

| Field | Value |
|-------|-------|
| Blocker ID | BLOCKER-WF-001 |
| Status | ACTIVE |
| Owner | Workforce repo maintainers |
| Impact | Cannot consume npm-provenance-publisher profile programmatically |
| Workaround | Hardcoded extracted requirements with source attribution comment |
| Resolution required for | Phase 4, Task P4-1 (publish-infrastructure-implementation-plan.md) |
| Blocking Phase 1? | NO — Phase 1 can proceed with the workaround |
| Blocking Phase 2? | NO — First publish can proceed with the workaround |

---

WORKFORCE_PROFILE_CONSUMPTION_PLAN_READY
