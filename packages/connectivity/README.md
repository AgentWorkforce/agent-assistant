# `@agent-assistant/connectivity`

`@agent-assistant/connectivity` implements the v1 in-process signaling layer for internal assistant coordination. It provides a bounded signal vocabulary, validation, suppression, lifecycle management, audience resolution hooks, and an escalation hook that routing can implement without handing routing ownership to this package.

## Scope

This package owns:

- the canonical `ConnectivitySignal` envelope and supporting TypeScript types
- synchronous `emit()` with validation, ID assignment, timestamps, suppression, and supersession
- an in-memory per-thread signal log with `get()` and `query()`
- lifecycle transitions for `resolved`, `superseded`, and `expired`
- audience semantics for `self`, `coordinator`, `selected`, and `all`
- callback subscriptions through `onSignal()` and `offSignal()`
- escalation hook interfaces that routing may implement

This package does not own:

- routing decisions or mode application
- coordinator work assignment or synthesis policy
- transport, queues, or cross-process delivery
- cloud telemetry or persistence
- product-specific signal classes beyond the v1 catalog

## Install Shape

The package is TypeScript-first and builds to `dist/`.

```ts
import {
  createConnectivityLayer,
  type ConnectivitySignal,
  type EmitSignalInput,
} from '@agent-assistant/connectivity';
```

## Signal Model

v1 includes five message classes and eleven signal classes:

- `attention.raise`
- `confidence.high`
- `confidence.medium`
- `confidence.low`
- `confidence.blocker`
- `conflict.active`
- `conflict.resolved`
- `handoff.ready`
- `handoff.partial`
- `escalation.interrupt`
- `escalation.uncertainty`

`confidence` is numeric and bounded to `0.0..1.0` when present. It is required for all `confidence.*` and `conflict.*` signals, and class-specific ranges are enforced for the confidence signal classes:

- `confidence.high`: `0.8..1.0`
- `confidence.medium`: `0.4..0.79`
- `confidence.low`: `0.1..0.39`
- `confidence.blocker`: `0.0`

Optional fields follow exact optional property semantics in TypeScript. Omit `confidence`, `details`, `replaces`, and `expiresAtStep` when they do not apply instead of passing them as explicit `undefined` values.

## Constants

The package intentionally exports the runtime constant catalogs alongside the union types:

- `MESSAGE_CLASSES`
- `MESSAGE_CLASS_TO_SIGNAL_PREFIX`
- `SIGNAL_AUDIENCES`
- `SIGNAL_CLASSES`
- `SIGNAL_EVENTS`
- `SIGNAL_PRIORITIES`
- `SIGNAL_STATES`
- `TERMINAL_STATES`

These are part of the intended v1 surface so downstream packages can share the same canonical vocabulary for exhaustive checks, switch guards, and test fixtures without duplicating local arrays.

## Core API

### `createConnectivityLayer(config?)`

Creates a thread-aware in-memory layer.

```ts
const layer = createConnectivityLayer({
  suppressionConfig: { basis: 'step' },
  routingEscalationHook: {
    onEscalation(signal) {
      if (signal.signalClass === 'escalation.uncertainty') {
        return 'deep';
      }
    },
  },
});
```

### `emit(input)`

Creates a validated signal, assigns `id`, `emittedAt`, and initial `state`, then stores it in the thread log.

Key behaviors:

- validates required fields and class consistency
- suppresses duplicates within the configured suppression window
- bypasses suppression for `priority='critical'`
- bypasses suppression for high-priority escalation signals when the summary changes
- supersedes the target of `replaces` before storing the new signal
- invokes the routing escalation hook for `escalation.interrupt` and `escalation.uncertainty`
- fires `onSignal(signal, 'emitted')` synchronously

### `resolve(signalId)`

Moves a signal to `resolved`. It is idempotent for already-resolved signals and throws for `expired` or `superseded` signals.

### `get(signalId)` and `query(query)`

`get()` returns a single signal or `null`. `query()` reads a thread slice with filters for source, class, priority, state, and time boundaries. By default, `query()` returns only `emitted` and `active` signals.

### `advanceStep(threadId)`

Increments the thread step counter. Signals with `expiresAtStep <= currentStep` become `expired`, and `onSignal(signal, 'expired')` fires for each.

### `registerSelectedResolver(resolver)`

Registers the coordination-owned resolver used for `audience='selected'`. The resolver is invoked during emit. Connectivity computes the audience result but does not deliver or persist recipients.

### `onSignal(callback)` / `offSignal(callback)`

Registers or removes synchronous callbacks for:

- `emitted`
- `superseded`
- `resolved`
- `expired`

If one callback throws, the error is logged and later callbacks still run.

## Lifecycle and Convergence

Signals move through:

```text
emitted -> active -> superseded
                  -> expired
                  -> resolved
```

`active` is reached after at least one `onSignal` callback fires for a newly emitted signal. Convergence stays intentionally lightweight in v1: the package gives coordination the primitives it needs to converge a thread without taking coordination ownership itself.

Those primitives are:

- `replaces` for supersession when a newer signal obsoletes an older one
- `resolve()` for explicit closure after synthesis or arbitration
- `advanceStep()` plus `expiresAtStep` for stale transient signals
- `query()` for checking unresolved conflicts, escalations, and current confidence state

## Suppression

Duplicate detection uses the logical key:

```text
threadId + source + signalClass + audience
```

Duplicates are suppressed only when the existing signal is still non-terminal.

Supported suppression modes:

- `basis: 'step'`
  `advanceStep()` resets the suppression window
- `basis: 'time'`
  uses a sliding `windowMs`, defaulting to `5000`

## Routing Boundary

Connectivity exposes a routing hook interface only:

```ts
interface RoutingEscalationHook {
  onEscalation(signal: ConnectivitySignal): 'cheap' | 'fast' | 'deep' | void;
}
```

Connectivity does not store the returned mode, does not choose routing modes, and does not import a routing implementation. The hook exists so routing can react to escalation signals without blurring package ownership.

## Example

```ts
import { createConnectivityLayer } from '@agent-assistant/connectivity';

const layer = createConnectivityLayer();

layer.onSignal((signal, event) => {
  console.log(event, signal.signalClass, signal.summary);
});

const confidence = layer.emit({
  threadId: 'thread-42',
  source: 'specialist:reviewer',
  audience: 'coordinator',
  messageClass: 'confidence',
  signalClass: 'confidence.high',
  priority: 'normal',
  confidence: 0.92,
  summary: 'Review completed with stable evidence',
});

layer.emit({
  threadId: 'thread-42',
  source: 'specialist:reviewer',
  audience: 'selected',
  messageClass: 'handoff',
  signalClass: 'handoff.ready',
  priority: 'normal',
  summary: 'Downstream writer can synthesize the reviewed draft',
});

layer.resolve(confidence.id);
```

## Development

Run inside `packages/connectivity`:

```sh
npm install
npm test
npm run build
```

The test suite covers the intended first workflows:

- narrowcast attention
- reviewer conflict
- specialist handoff
- blocker uncertainty routing escalation

CONNECTIVITY_PACKAGE_IMPLEMENTED
