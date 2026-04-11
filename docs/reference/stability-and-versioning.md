# Stability and Versioning

Date: 2026-04-11

## Current Stage

This repo is in a docs-first research stage.

Current status:
- package boundaries are proposed, not implemented
- API names shown in docs are illustrative, not stable contracts
- consumer adoption should begin only after Phase 1 package extraction starts producing real interfaces

## Stability Intent

Once packages begin implementation, the goal should be:

- stable package boundaries before broad product adoption
- cautious API evolution in `core`, `sessions`, `memory`, `surfaces`, `coordination`, `connectivity`, `proactive`, and `policy`
- explicit release notes for breaking changes

## Proposed Versioning Policy

### Phase 0 — research/docs-first
- versioning is informal
- docs may change substantially as boundaries sharpen

### Phase 1 — first package extraction
- use pre-1.0 versions
- treat every package contract as provisional but intentional
- announce all breaking changes in CHANGELOG/release notes

### Phase 2 — first real consumer adoption
- stabilize the most reused package boundaries first:
  - `core`
  - `sessions`
  - `memory`
  - `surfaces`
- keep more experimental layers clearly marked if needed:
  - `connectivity`
  - `coordination`
  - `proactive`

### Phase 3 — multi-product production use
- promote mature packages to 1.0 once they have held across multiple consumers without repeated contract churn

## Consumer Guidance

Consumers such as Sage, MSD, and NightCTO should prefer:
- stable package boundaries for foundational contracts
- adapter layers inside product repos for experimental integration points
- explicit upgrade steps when package contracts change

## Change Communication

When implementation begins, every release should include:
- what changed
- which packages changed
- whether changes are breaking or additive
- which consumers are expected to be affected
