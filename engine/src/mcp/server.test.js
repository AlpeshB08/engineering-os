import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { toolDefinitions, createServer } from './server.js';
import { TOOL_HANDLERS } from './tools.js';

test('every declared MCP tool has a handler and a usable schema', () => {
  const defs = toolDefinitions(z);
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, ['feature_continue', 'feature_start', 'feature_status', 'guard_check']);
  for (const def of defs) {
    assert.ok(TOOL_HANDLERS[def.name], `no handler registered for ${def.name}`);
    assert.ok(def.config.description.length > 30, `${def.name} needs a descriptive description`);
    assert.equal(typeof def.config.inputSchema, 'object');
  }
});

test('feature_continue exposes every confirmation stage of the workflow', () => {
  const def = toolDefinitions(z).find((d) => d.name === 'feature_continue');
  const confirmValues = def.config.inputSchema.confirm._def.innerType.options;
  assert.deepEqual(
    [...confirmValues].sort(),
    ['delivery', 'manual-qa', 'regression', 'review', 'test-cases', 'testing-strategy']
  );
});

test('createServer registers all tools without a live transport', async () => {
  const server = await createServer({ sdk: await import('@modelcontextprotocol/sdk/server/mcp.js').then(async (m) => ({ McpServer: m.McpServer, z: (await import('zod')).z })) });
  assert.ok(server, 'server instance created');
  // registering the same tool twice would throw, proving each name was registered once
  assert.throws(() => server.registerTool('feature_start', { description: 'dup' }, () => {}));
});
