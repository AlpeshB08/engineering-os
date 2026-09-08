#!/usr/bin/env node
/**
 * Engineering OS MCP server (stdio).
 *
 * Exposes the /feature workflow as typed MCP tools so an agent drives the workflow through
 * a tool contract instead of choosing to type CLI commands — steps cannot be silently
 * skipped or free-styled.
 *
 * The MCP SDK is imported lazily and declared as an optional dependency: the core `eos`
 * CLI never imports this file, so a missing SDK can never break normal usage.
 */

import { consumerRoot, frameworkHome } from '../paths.js';
import { TOOL_HANDLERS } from './tools.js';

const SDK_HINT =
  'The MCP server needs the optional dependency @modelcontextprotocol/sdk. Install it with: npm install @modelcontextprotocol/sdk';

export async function loadSdk() {
  try {
    const [{ McpServer }, { StdioServerTransport }, { z }] = await Promise.all([
      import('@modelcontextprotocol/sdk/server/mcp.js'),
      import('@modelcontextprotocol/sdk/server/stdio.js'),
      import('zod'),
    ]);
    return { McpServer, StdioServerTransport, z };
  } catch (error) {
    const err = new Error(`${SDK_HINT}\nOriginal error: ${error?.message || error}`);
    err.code = 'EOS_MCP_SDK_MISSING';
    throw err;
  }
}

/** Tool definitions, kept declarative so they can be asserted in tests. */
export function toolDefinitions(z) {
  return [
    {
      name: 'feature_start',
      config: {
        title: 'Start /feature',
        description:
          'Start the Engineering OS /feature workflow from a Jira key, a Figma URL and/or a plain task description. Returns the first conversational turn.',
        inputSchema: {
          jira: z.string().optional().describe('Jira issue key or URL'),
          figma: z.string().optional().describe('Figma file/design URL'),
          context: z.string().optional().describe('Plain task or bug description'),
        },
      },
    },
    {
      name: 'feature_continue',
      config: {
        title: 'Continue /feature',
        description:
          'Advance the active run in the same conversation: answer a clarification, confirm a stage (testing-strategy, test-cases, manual-qa, regression, review, delivery), or submit implementation evidence. EOS runs the real tests when implemented=true.',
        inputSchema: {
          answer: z.string().optional().describe('Free-text answer to the current question'),
          confirm: z
            .enum(['testing-strategy', 'test-cases', 'manual-qa', 'regression', 'review', 'delivery'])
            .optional()
            .describe('Explicit confirmation for the current stage'),
          decision: z.string().optional().describe('Workflow decision id to answer'),
          option: z.string().optional().describe('Chosen option id for that decision'),
          implemented: z.boolean().optional().describe('Submit implementation evidence'),
          summary: z.string().optional().describe('Implementation summary'),
          testsCreated: z.string().optional().describe('Comma-separated test files created'),
        },
      },
    },
    {
      name: 'feature_status',
      config: {
        title: 'Read /feature status',
        description:
          'Read the current conversational turn (stage, awaiting, questions, test cases, regression) without mutating the run.',
        inputSchema: {},
      },
    },
    {
      name: 'guard_check',
      config: {
        title: 'Check mutation authorization',
        description:
          'Check whether application code may be modified right now, optionally for a specific path.',
        inputSchema: { path: z.string().optional().describe('Repository-relative file path') },
      },
    },
  ];
}

function asToolResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export async function createServer(options = {}) {
  const { McpServer, z } = options.sdk || (await loadSdk());
  const root = options.root || consumerRoot();
  const home = options.home || frameworkHome();

  const server = new McpServer({ name: 'engineering-os', version: '0.2.0' });

  for (const { name, config } of toolDefinitions(z)) {
    const handler = TOOL_HANDLERS[name];
    server.registerTool(name, config, async (args = {}) => {
      // Handlers already contain their own failures; this guard is the last resort so a
      // tool error is reported to the client instead of terminating the server.
      try {
        return asToolResult(await handler(args, { root, home }));
      } catch (error) {
        return asToolResult({ ok: false, error: error?.message || String(error) });
      }
    });
  }

  return server;
}

export async function main() {
  const { StdioServerTransport } = await loadSdk();
  const server = await createServer();
  await server.connect(new StdioServerTransport());
}

const isDirectRun =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exit(1);
  });
}
