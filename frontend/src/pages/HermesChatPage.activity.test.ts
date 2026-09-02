import { describe, expect, it } from 'vitest';
import { createResponseActivity } from '../hermes/activity';
import { applySessionActivity } from './HermesChatPage';

describe('canonical session activity presentation', () => {
  it('presents internal thinking as reasoning and closes it on completion', () => {
    const running = applySessionActivity(createResponseActivity(), {
      type: 'tool.started',
      toolName: '_thinking',
    });

    expect(running.items).toEqual([
      expect.objectContaining({ label: 'Reasoning', kind: 'reasoning', status: 'running' }),
    ]);

    const completed = applySessionActivity(running, { type: 'assistant.completed' });
    expect(completed.status).toBe('completed');
    expect(completed.items[0].status).toBe('completed');
  });
});
