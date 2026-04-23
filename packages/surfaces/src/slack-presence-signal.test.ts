import { describe, expect, it } from 'vitest';

import { classifySlackPresenceSignal } from './slack-presence-signal.js';

const workspaceId = 'T1';

describe('classifySlackPresenceSignal', () => {
  it("classifies away presence_change events", () => {
    expect(
      classifySlackPresenceSignal(
        {
          type: 'event_callback',
          event: {
            type: 'presence_change',
            user: 'U1',
            presence: 'away',
          },
        },
        workspaceId,
      ),
    ).toEqual({
      kind: 'slack.presence',
      workspaceId,
      subjectId: 'U1',
      payload: { presence: 'away' },
    });
  });

  it("classifies active presence_change events", () => {
    expect(
      classifySlackPresenceSignal(
        {
          type: 'event_callback',
          event: {
            type: 'presence_change',
            user: 'U1',
            presence: 'active',
          },
        },
        workspaceId,
      ),
    ).toEqual({
      kind: 'slack.presence',
      workspaceId,
      subjectId: 'U1',
      payload: { presence: 'active' },
    });
  });

  it("classifies user_status_changed events", () => {
    expect(
      classifySlackPresenceSignal(
        {
          type: 'event_callback',
          event: {
            type: 'user_status_changed',
            user: {
              id: 'U1',
              profile: {
                status_text: 'Heads down',
                status_emoji: ':spiral_calendar_pad:',
              },
            },
          },
        },
        workspaceId,
      ),
    ).toEqual({
      kind: 'slack.status',
      workspaceId,
      subjectId: 'U1',
      payload: {
        status_text: 'Heads down',
        status_emoji: ':spiral_calendar_pad:',
      },
    });
  });

  it("ignores unrelated event types", () => {
    expect(
      classifySlackPresenceSignal(
        {
          type: 'event_callback',
          event: { type: 'message', user: 'U1', text: 'hello' },
        },
        workspaceId,
      ),
    ).toBeNull();
  });

  it("ignores payloads without an event object", () => {
    expect(classifySlackPresenceSignal({ type: 'event_callback' }, workspaceId)).toBeNull();
  });

  it("ignores presence_change events without a user", () => {
    expect(
      classifySlackPresenceSignal(
        {
          type: 'event_callback',
          event: { type: 'presence_change', presence: 'away' },
        },
        workspaceId,
      ),
    ).toBeNull();
  });

  it("ignores user_status_changed events with malformed nested users", () => {
    expect(
      classifySlackPresenceSignal(
        {
          type: 'event_callback',
          event: { type: 'user_status_changed', user: 'U1' },
        },
        workspaceId,
      ),
    ).toBeNull();
  });

  it("ignores non-object payloads", () => {
    expect(classifySlackPresenceSignal('event_callback', workspaceId)).toBeNull();
  });
});
