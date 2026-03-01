import { describe, it, expect } from 'vitest';
import { registerPrompts } from './prompts.js';

function createMockServer() {
  const prompts: { name: string; handler: Function }[] = [];
  return {
    prompt: (name: string, _desc: string, _schema: any, handler: Function) => {
      prompts.push({ name, handler });
    },
    prompts,
  };
}

describe('registerPrompts', () => {
  it('registers a prompt named memory_context', () => {
    const mock = createMockServer();
    registerPrompts(mock as any);

    expect(mock.prompts).toHaveLength(1);
    expect(mock.prompts[0].name).toBe('memory_context');
  });

  it('handler without topic returns instruction text', () => {
    const mock = createMockServer();
    registerPrompts(mock as any);

    const result = mock.prompts[0].handler({});
    const text: string = result.messages[0].content.text;

    expect(text).toContain('memory_save');
    expect(text).toContain('memory_search');
    expect(text).not.toContain('The user wants to discuss');
  });

  it('handler with topic includes topic in output', () => {
    const mock = createMockServer();
    registerPrompts(mock as any);

    const result = mock.prompts[0].handler({ topic: 'quantum physics' });
    const text: string = result.messages[0].content.text;

    expect(text).toContain('quantum physics');
    expect(text).toContain('The user wants to discuss: quantum physics');
  });
});
