import { describe, expect, it } from 'vitest';

import { classifySlackIngressEvent } from './slack-ingress.js';

describe('classifySlackIngressEvent', () => {
  it('classifies app mentions', () => {
    expect(
      classifySlackIngressEvent({
        type: 'event_callback',
        team_id: 'T1',
        event: { type: 'app_mention', channel: 'C1', user: 'U1', text: '<@U_SAGE> hi', ts: '1.1' },
      }),
    ).toMatchObject({ kind: 'mention', channel: 'C1', userId: 'U1', teamId: 'T1', ts: '1.1' });
  });

  it('classifies direct messages', () => {
    expect(
      classifySlackIngressEvent({
        type: 'event_callback',
        team_id: 'T1',
        event: { type: 'message', channel_type: 'im', channel: 'D1', user: 'U1', text: 'hi', ts: '2.1' },
      }),
    ).toMatchObject({ kind: 'direct_message', channel: 'D1', userId: 'U1' });
  });

  it('classifies thread replies', () => {
    expect(
      classifySlackIngressEvent({
        type: 'event_callback',
        team_id: 'T1',
        event: { type: 'message', channel: 'C1', user: 'U1', text: 'follow up', ts: '3.2', thread_ts: '3.1' },
      }),
    ).toMatchObject({ kind: 'thread_reply', channel: 'C1', threadTs: '3.1' });
  });

  it('ignores bot messages', () => {
    expect(
      classifySlackIngressEvent({
        type: 'event_callback',
        event: { type: 'message', subtype: 'bot_message', channel: 'C1', text: 'hi' },
      }),
    ).toMatchObject({ kind: 'ignore' });
  });
});
