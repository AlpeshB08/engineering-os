import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlanBundle, artifactPath } from './artifacts.js';
import { templatesDir } from './paths.js';
import { replaceTokens, today } from './util.js';

function seedBundle(root, { withJira = true, withFigma = false } = {}) {
  const eosRoot = path.join(root, '.engineering-os');
  const runId = 'bundle-test';
  const artifactsDir = path.join(eosRoot, 'artifacts', runId);
  fs.mkdirSync(path.join(eosRoot, 'integrations'), { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  const home = path.resolve(import.meta.dirname, '..', '..');
  const tokens = { run_id: runId, workflow_id: 'feature-development', date: today() };

  const files = [
    'discovery-notes.md',
    'feature-contract.md',
    'feature-impact.md',
    'reuse-analysis.md',
    'backend-dependency.md',
    'verification-plan.md',
    'implementation-plan.md',
  ];
  for (const file of files) {
    const template = fs.readFileSync(path.join(templatesDir(home), file), 'utf8');
    fs.writeFileSync(path.join(artifactsDir, file), replaceTokens(template, tokens));
  }

  let contract = fs.readFileSync(artifactPath(artifactsDir, 'feature-contract'), 'utf8');
  contract = contract.replace(
    /## Problem[\s\S]*?(?=\n## )/,
    '## Problem\n\nExport items to CSV\n\n'
  );
  contract = contract.replace(
    /## Acceptance Criteria[\s\S]*?(?=\n## )/,
    '## Acceptance Criteria\n\n1. Export button visible\n2. CSV download works\n\n'
  );
  fs.writeFileSync(artifactPath(artifactsDir, 'feature-contract'), contract);

  let discovery = fs.readFileSync(artifactPath(artifactsDir, 'discovery-notes'), 'utf8');
  discovery += `\n## Jira requirements (TEST-1)\n\nSummary and AC content here with enough length to pass validation.\n\nAcceptance criteria listed.\n`;
  if (withFigma) {
    discovery += `\n## Design requirements (Figma)\n\n### Screens\n- Items list\n`;
  }
  fs.writeFileSync(artifactPath(artifactsDir, 'discovery-notes'), discovery);

  if (withJira) {
    fs.writeFileSync(
      path.join(eosRoot, 'integrations', 'jira-TEST-1.json'),
      JSON.stringify({
        key: 'TEST-1',
        summary: 'Export',
        description: 'Export items',
        acceptance_criteria: ['Export button visible', 'CSV download works'],
        discovery: { complete: true, source: 'agent' },
      })
    );
  }

  if (withFigma) {
    fs.writeFileSync(
      path.join(eosRoot, 'integrations', 'figma-discovery.json'),
      JSON.stringify({
        url: 'https://www.figma.com/design/x/y',
        screens: ['Items list'],
        discovery: { complete: true, source: 'agent' },
      })
    );
  }

  let plan = fs.readFileSync(artifactPath(artifactsDir, 'verification-plan'), 'utf8');
  plan = plan.replace('Unit Tests: Not Required', 'Unit Tests: Required');
  plan = plan.replace('Manual QA: Required', 'Manual QA: Required');
  plan = plan.replace(
    '### Unit test scenarios\n\n- _(not required)_',
    '### Unit test scenarios\n\n- AC1-T01: Unit happy path — Export button visible\n- AC2-T01: Unit happy path — CSV download works'
  );
  plan = plan.replace(
    '### Manual test scenarios\n\n- _(not required)_',
    '### Manual test scenarios\n\n- AC1-M01: Manual verification — Export button visible\n- AC2-M01: Manual verification — CSV download works'
  );
  plan = plan.replace(
    '| AC1 | | | | | | | | |',
    '| AC1: Export button visible | x | | | | | | | |\n| AC2: CSV download works | x | | | | | | | |'
  );
  fs.writeFileSync(artifactPath(artifactsDir, 'verification-plan'), plan);

  let impl = fs.readFileSync(artifactPath(artifactsDir, 'implementation-plan'), 'utf8');
  impl = impl.replace(
    /## Implementation steps[\s\S]*?(?=\n## )/,
    '## Implementation steps\n\n1. Add export button\n2. Wire CSV download\n\n'
  );
  fs.writeFileSync(artifactPath(artifactsDir, 'implementation-plan'), impl);

  for (const id of ['feature-impact', 'reuse-analysis', 'backend-dependency']) {
    const p = artifactPath(artifactsDir, id);
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace('draft', 'ready');
    fs.writeFileSync(p, c);
  }

  const run = {
    id: runId,
    artifacts_dir: artifactsDir,
    blocked: false,
  };
  const state = {
    feature_intake: {
      jira: withJira ? { key: 'TEST-1' } : null,
      figma: withFigma ? { url: 'https://www.figma.com/design/x/y' } : null,
    },
  };
  return { run, state, eosRoot };
}

test('validatePlanBundle rejects incomplete bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-art-'));
  const { run, state, eosRoot } = seedBundle(root, { withJira: true });
  let plan = fs.readFileSync(artifactPath(run.artifacts_dir, 'verification-plan'), 'utf8');
  plan = plan.replace('## Test Scenarios', '');
  fs.writeFileSync(artifactPath(run.artifacts_dir, 'verification-plan'), plan);
  const result = validatePlanBundle(run, state, eosRoot);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => String(i).includes('verification-plan')));
});

test('validatePlanBundle passes complete bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-art-'));
  const { run, state, eosRoot } = seedBundle(root, { withJira: true, withFigma: true });
  const result = validatePlanBundle(run, state, eosRoot);
  assert.equal(result.ok, true);
});
