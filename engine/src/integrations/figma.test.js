import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseFigmaUrl,
  createPendingFigmaStub,
  isFigmaDiscoveryComplete,
  validateFigmaDiscoveryContent,
  ingestFigmaDiscovery,
  ingestFigmaFromJsonFile,
  validateNormalizedFigmaSchema,
  seedContractFromFigma,
  deriveAcceptanceCriteriaFromFigma,
} from './figma.js';
import { templatesDir } from '../paths.js';
import { replaceTokens, today } from '../util.js';

function setupRun(root) {
  const runId = 'figma-test-1';
  const artifactsDir = path.join(root, '.engineering-os', 'artifacts', runId);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const home = path.resolve(import.meta.dirname, '..', '..', '..');
  const tokens = { run_id: runId, workflow_id: 'feature-development', date: today() };
  const template = fs.readFileSync(path.join(templatesDir(home), 'discovery-notes.md'), 'utf8');
  fs.writeFileSync(path.join(artifactsDir, 'discovery-notes.md'), replaceTokens(template, tokens));
  return { artifactsDir, run: { id: runId, artifacts_dir: artifactsDir } };
}

test('parseFigmaUrl extracts design URL', () => {
  const parsed = parseFigmaUrl('See https://www.figma.com/design/abc/My-File for mockups');
  assert.ok(parsed?.url.includes('figma.com/design'));
});

test('no URL means discovery step is not required at intake level', () => {
  assert.equal(parseFigmaUrl(''), null);
});

test('URL requires complete discovery', () => {
  const stub = createPendingFigmaStub('https://www.figma.com/design/x/y');
  assert.equal(isFigmaDiscoveryComplete(stub), false);
});

test('complete agent JSON writes meaningful design content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-figma-'));
  const { run, artifactsDir } = setupRun(root);
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'figma-discovery.json'),
      'utf8'
    )
  );
  const result = ingestFigmaDiscovery(root, run, fixture);
  assert.equal(result.complete, true);
  const discovery = fs.readFileSync(path.join(artifactsDir, 'discovery-notes.md'), 'utf8');
  assert.ok(discovery.includes('## Design requirements (Figma)'));
  assert.equal(validateFigmaDiscoveryContent(discovery).valid, true);
});

test('ingestFigmaFromJsonFile rejects empty normalized content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-figma-'));
  const { run } = setupRun(root);
  const fixturePath = path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'figma-empty.json');
  const result = ingestFigmaFromJsonFile(root, run, fixturePath);
  assert.equal(result.complete, false);
  assert.ok(result.errors.length);
});

test('ingestFigmaFromJsonFile rejects malformed JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-figma-'));
  const bad = path.join(root, 'bad.json');
  fs.writeFileSync(bad, '{invalid');
  assert.throws(() => ingestFigmaFromJsonFile(root, null, bad), /Invalid Figma JSON/);
});

test('ingestFigmaFromJsonFile accepts valid content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-figma-'));
  const { run } = setupRun(root);
  const fixturePath = path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'figma-discovery.json');
  const result = ingestFigmaFromJsonFile(root, run, fixturePath);
  assert.equal(result.complete, true);
});

test('URL-only stub fails validation', () => {
  const content = `## Design requirements (Figma)

- **URL:** https://www.figma.com/design/x/y
- **Discovery complete:** no
`;
  assert.equal(validateFigmaDiscoveryContent(content).valid, false);
});

test('failed required discovery is not complete', () => {
  const stub = createPendingFigmaStub('https://www.figma.com/design/x/y');
  assert.equal(validateNormalizedFigmaSchema(stub).valid, true);
  assert.equal(isFigmaDiscoveryComplete(stub), false);
});

test('Figma seeds contract from ui_requirements and does not invent extra ACs', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'figma-discovery.json'),
      'utf8'
    )
  );
  assert.deepEqual(deriveAcceptanceCriteriaFromFigma(fixture), ['Primary export CTA in page header']);
  const seeded = seedContractFromFigma(
    '# Feature Contract\n\n## Problem\n\n<!-- What problem are we solving? -->\n\n## Scope — In\n\n-\n\n## Acceptance Criteria\n\n1.\n\n## UX / API Notes\n\n<!-- UI flows -->\n\n## Non-Goals\n\n-\n',
    fixture
  );
  assert.match(seeded, /Primary export CTA in page header/);
  assert.match(seeded, /Items list/);
  assert.equal(deriveAcceptanceCriteriaFromFigma({ screens: ['Only a screen'] }).length, 0);
});
