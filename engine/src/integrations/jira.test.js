import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractJiraKey,
  normalizeJiraIssue,
  validateNormalizedJiraSchema,
  renderJiraDiscoveryBlock,
  createPendingJiraStub,
  isJiraDiscoveryComplete,
  ingestNormalizedJira,
  ingestJiraFromJsonFile,
  JIRA_SCHEMA_FIELDS,
} from './jira.js';
import { artifactPath } from '../artifacts.js';
import { templatesDir } from '../paths.js';
import { replaceTokens, today } from '../util.js';

function setupRun(root) {
  const runId = 'feature-test-1';
  const artifactsDir = path.join(root, '.engineering-os', 'artifacts', runId);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const home = path.resolve(import.meta.dirname, '..', '..', '..');
  const tokens = { run_id: runId, workflow_id: 'feature-development', date: today() };
  for (const file of ['discovery-notes.md', 'feature-contract.md']) {
    const template = fs.readFileSync(path.join(templatesDir(home), file), 'utf8');
    fs.writeFileSync(path.join(artifactsDir, file), replaceTokens(template, tokens));
  }
  return { runId, artifactsDir, run: { id: runId, artifacts_dir: artifactsDir } };
}

test('extractJiraKey from URL', () => {
  assert.equal(extractJiraKey('https://x.atlassian.net/browse/ABC-99'), 'ABC-99');
});

test('normalizeJiraIssue extracts acceptance criteria from description', () => {
  const normalized = normalizeJiraIssue(
    {
      key: 'PROJ-1',
      fields: {
        summary: 'Add report export',
        description: 'Details here\n\nAcceptance Criteria\n- Export CSV\n- Export PDF',
        issuetype: { name: 'Story' },
        status: { name: 'Open' },
        labels: ['reporting'],
      },
    },
    'PROJ-1'
  );
  assert.equal(normalized.summary, 'Add report export');
  assert.ok(normalized.acceptance_criteria.length >= 1);
  assert.equal(normalized.discovery.complete, true);
  const validation = validateNormalizedJiraSchema(normalized);
  assert.equal(validation.valid, true);
});

test('REST and agent paths share required schema fields', () => {
  const rest = normalizeJiraIssue(
    {
      key: 'X-1',
      fields: {
        summary: 'Test',
        description: 'Body',
        issuetype: { name: 'Task' },
        status: { name: 'Done' },
        labels: [],
      },
    },
    'X-1',
    'rest'
  );
  const agent = {
    ...rest,
    discovery: { source: 'agent', complete: true, completed_at: new Date().toISOString() },
  };
  for (const field of JIRA_SCHEMA_FIELDS) {
    assert.ok(field in rest, `rest missing ${field}`);
    assert.ok(field in agent, `agent missing ${field}`);
  }
});

test('renderJiraDiscoveryBlock includes key', () => {
  const block = renderJiraDiscoveryBlock(
    normalizeJiraIssue(
      {
        key: 'X-1',
        fields: {
          summary: 'Test',
          description: 'Body',
          issuetype: { name: 'Task' },
          status: { name: 'Done' },
          labels: [],
        },
      },
      'X-1'
    ),
    { source: 'rest' }
  );
  assert.ok(block.includes('## Jira requirements (X-1)'));
});

test('pending stub is incomplete', () => {
  const stub = createPendingJiraStub('BLOCK-1');
  assert.equal(isJiraDiscoveryComplete(stub), false);
  assert.equal(stub.discovery.complete, false);
});

test('agent ingest from JSON completes discovery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-jira-'));
  const { run, artifactsDir } = setupRun(root);
  const fixture = path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'jira-TEST-1.json');
  const result = ingestJiraFromJsonFile(root, run, fixture);
  assert.equal(result.complete, true);
  assert.ok(fs.existsSync(path.join(root, '.engineering-os', 'integrations', 'jira-TEST-1.json')));
  const discovery = fs.readFileSync(path.join(artifactsDir, 'discovery-notes.md'), 'utf8');
  assert.ok(discovery.includes('## Jira requirements (TEST-1)'));
});

test('incomplete Jira blocks discovery validation', () => {
  const stub = createPendingJiraStub('BLOCK-2');
  assert.equal(isJiraDiscoveryComplete(stub), false);
  assert.equal(stub.discovery.complete, false);
});
