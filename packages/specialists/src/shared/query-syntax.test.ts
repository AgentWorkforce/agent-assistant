import { describe, expect, it } from 'vitest';

import { parseQuery } from './query-syntax.js';

describe('parseQuery', () => {
  it('keeps bare text as query text', () => {
    expect(parseQuery('open pull requests')).toEqual({
      text: 'open pull requests',
      filters: {},
    });
  });

  it('extracts mixed free text and recognized filters', () => {
    expect(parseQuery('retry state:open repo:AgentWorkforce/sage')).toEqual({
      text: 'retry',
      filters: {
        state: ['open'],
        repo: ['AgentWorkforce/sage'],
      },
    });
  });

  it('collects repeated keys in order', () => {
    expect(parseQuery('label:bug label:security')).toEqual({
      text: '',
      filters: {
        label: ['bug', 'security'],
      },
    });
  });

  it('extracts type filters', () => {
    expect(parseQuery('type:pr')).toEqual({
      text: '',
      filters: {
        type: ['pr'],
      },
    });
  });

  it('leaves unknown keys in query text', () => {
    expect(parseQuery('foo:bar')).toEqual({
      text: 'foo:bar',
      filters: {},
    });
  });
});
