import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARTIFACT_CLASS,
  classifyEosRelativePath,
  ensureConsumerGitignore,
  executeCleanup,
  isAutomaticCleanupEligible,
  isValidRunId,
  planCleanup,
} from './cleanup.js';
import { saveState, defaultState } from './state.js';
import { eosDir } from './paths.js';
import { DELIVERY_STATUS } from './verificationStates.js';

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eos-cleanup-'));
}

function completedFeature(root, runId = 'feature-development-complete') {
  const eos = eosDir(root);
  const artifactDir = path.join(eos, 'artifacts', runId);
  fs.mkdirSync(artifactDir, { recursive: true });
  const run = {
    id: runId,
    workflow_id: 'feature-development',
    status: 'completed',
    artifacts_dir: artifactDir,
    current_phase: 'completed',
    phase_index: 9,
    implementation_entered_at: '2026-08-25T00:00:00.000Z',
    completed_phases: [
      'bootstrap',
      'discover',
      'contract',
      'plan',
      'approve',
      'implement',
      'verify',
      'review',
      'deliver',
    ],
    gates: {
      'delivery-signoff': {
        status: 'approved',
        run_id: runId,
      },
    },
    verification_result: {
      run_id: runId,
      status: DELIVERY_STATUS.READY_FOR_REVIEW,
      reasons: [],
      verified_at: '2026-08-25T01:00:00.000Z',
    },
    feature_session: {
      completion: {
        run_id: runId,
        implementation: { summary: 'Shipped export', files_changed: ['src/Export.tsx'] },
        unit: { cases: ['AC1-T01: export'], results: [{ name: 'unit tests', status: 'Passed' }] },
        e2e: { applicable: false, cases: [], results: [] },
        manual_qa: { applicable: false, confirmed: false, cases: [] },
        regression: { cases: [], case_results: [] },
        verification: { status: DELIVERY_STATUS.READY_FOR_REVIEW },
        review: { status: 'confirmed' },
        delivery: { status: 'signed-off' },
        unresolved: [],
        cleanup: { status: 'pending' },
      },
    },
  };
  const state = defaultState();
  state.active_run = run;
  state.feature_intake = {
    jira: { key: 'TEST-1' },
    figma: { url: 'https://www.figma.com/design/test/file' },
    context: 'Test feature',
  };
  saveState(root, state);
  return { eos, artifactDir, run, state };
}

function writeRunArtifacts(artifactDir) {
  fs.writeFileSync(path.join(artifactDir, 'feature-contract.md'), '# contract\n');
  fs.writeFileSync(path.join(artifactDir, 'verification-evidence.md'), '# evidence\n');
  fs.writeFileSync(path.join(artifactDir, 'delivery-preparation.md'), '# delivery\n');
}

test('classifies feature delivery as durable and intermediate artifacts as runtime', () => {
  assert.equal(
    classifyEosRelativePath(
      '.engineering-os/artifacts/run-1/delivery-preparation.md',
      { workflowId: 'feature-development' }
    ).class,
    ARTIFACT_CLASS.DELIVERABLE
  );
  assert.equal(
    classifyEosRelativePath(
      '.engineering-os/artifacts/run-1/verification-plan.md',
      { workflowId: 'feature-development' }
    ).class,
    ARTIFACT_CLASS.RUNTIME
  );
  assert.equal(
    classifyEosRelativePath('.engineering-os/repository-profile.md').class,
    ARTIFACT_CLASS.PERMANENT
  );
});

test('successful verified feature automatically removes temporary artifacts only', () => {
  const root = makeRoot();
  const { eos, artifactDir, run } = completedFeature(root);
  writeRunArtifacts(artifactDir);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export default function App() {}');
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cursor', 'hooks.json'), '{}');
  fs.writeFileSync(path.join(eos, 'repository-profile.md'), '# profile\n');
  fs.mkdirSync(path.join(eos, 'test-setup-staging', run.id), { recursive: true });
  fs.mkdirSync(path.join(eos, 'integrations'), { recursive: true });
  fs.writeFileSync(path.join(eos, 'integrations', 'jira-TEST-1.json'), '{}');
  fs.writeFileSync(
    path.join(eos, 'integrations', 'figma-discovery.json'),
    JSON.stringify({ url: 'https://www.figma.com/design/test/file' })
  );
  fs.mkdirSync(path.join(eos, 'intelligence', 'context'), { recursive: true });
  fs.writeFileSync(
    path.join(eos, 'intelligence', 'context', 'feature-development-deliver.md'),
    `# Context\n\n- **Run:** ${run.id}\n`
  );

  const result = executeCleanup(root, { runId: run.id, automatic: true });
  assert.deepEqual(result.errors, []);
  assert.equal(fs.existsSync(path.join(artifactDir, 'feature-contract.md')), false);
  assert.equal(fs.existsSync(path.join(artifactDir, 'verification-evidence.md')), false);
  assert.equal(fs.existsSync(path.join(artifactDir, 'delivery-preparation.md')), true);
  assert.equal(fs.existsSync(path.join(eos, 'test-setup-staging', run.id)), false);
  assert.equal(fs.existsSync(path.join(eos, 'integrations', 'jira-TEST-1.json')), false);
  assert.equal(fs.existsSync(path.join(eos, 'integrations', 'figma-discovery.json')), false);
  assert.equal(
    fs.existsSync(path.join(eos, 'intelligence', 'context', 'feature-development-deliver.md')),
    false
  );
  assert.equal(fs.existsSync(path.join(root, 'src', 'App.tsx')), true);
  assert.equal(fs.existsSync(path.join(root, '.cursor', 'hooks.json')), true);
  assert.equal(fs.existsSync(path.join(eos, 'repository-profile.md')), true);

  const state = JSON.parse(fs.readFileSync(path.join(eos, 'state.json'), 'utf8'));
  assert.equal(state.active_run, null);
  assert.equal(state.completed_runs.length, 1);
  assert.equal(state.completed_runs[0].final_status, DELIVERY_STATUS.READY_FOR_REVIEW);
  assert.equal(state.completed_runs[0].feature.jira_key, 'TEST-1');
  assert.equal(state.last_completion.run_id, run.id);
  assert.match(state.last_completion.implementation.summary, /Shipped export/);
  assert.equal(state.completed_runs[0].completion.run_id, run.id);
});

test('automatic cleanup preserves implementation-complete verification-incomplete feature', () => {
  const root = makeRoot();
  const { artifactDir, run } = completedFeature(root);
  writeRunArtifacts(artifactDir);
  run.status = 'active';
  run.current_phase = 'verify';
  run.completed_phases = ['implement'];
  run.verification_result = {
    run_id: run.id,
    status: DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING,
  };
  const state = defaultState();
  state.active_run = run;
  saveState(root, state);

  const result = executeCleanup(root, { runId: run.id, automatic: true });
  assert.equal(result.removed.length, 0);
  assert.equal(fs.existsSync(path.join(artifactDir, 'feature-contract.md')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(eosDir(root), 'state.json'))).active_run.id, run.id);
});

test('BLOCKED active feature artifacts are preserved', () => {
  const root = makeRoot();
  const eos = eosDir(root);
  const runId = 'feature-development-blocked';
  const artifactDir = path.join(eos, 'artifacts', runId);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'feature-contract.md'), '# contract');
  const state = defaultState();
  state.active_run = {
    id: runId,
    workflow_id: 'feature-development',
    status: 'active',
    blocked: true,
    current_phase: 'plan',
    phase_index: 3,
    artifacts_dir: artifactDir,
  };
  saveState(root, state);

  const result = executeCleanup(root, { runId });
  assert.equal(result.removed.length, 0);
  assert.ok(result.toPreserve.some((item) => item.path.endsWith('feature-contract.md')));
});

test('FAILED feature is preserved automatically and removable manually', () => {
  const root = makeRoot();
  const { artifactDir, run } = completedFeature(root, 'feature-development-failed');
  writeRunArtifacts(artifactDir);
  run.status = 'failed';
  const state = defaultState();
  state.active_run = run;
  saveState(root, state);

  const automatic = executeCleanup(root, { runId: run.id, automatic: true });
  assert.equal(automatic.removed.length, 0);
  assert.equal(fs.existsSync(path.join(artifactDir, 'feature-contract.md')), true);

  const manual = executeCleanup(root, { runId: run.id });
  assert.deepEqual(manual.errors, []);
  assert.equal(fs.existsSync(path.join(artifactDir, 'feature-contract.md')), false);
  assert.equal(fs.existsSync(path.join(artifactDir, 'delivery-preparation.md')), false);
});

test('cleanup is idempotent', () => {
  const root = makeRoot();
  const { artifactDir, run } = completedFeature(root);
  writeRunArtifacts(artifactDir);
  executeCleanup(root, { runId: run.id, automatic: true });
  const second = executeCleanup(root, { runId: run.id });
  assert.equal(second.removed.length, 0);
  assert.equal(fs.existsSync(path.join(artifactDir, 'delivery-preparation.md')), true);
});

test('dry-run exactly reports removals and preserved durable artifact without modifying', () => {
  const root = makeRoot();
  const { artifactDir, run } = completedFeature(root);
  writeRunArtifacts(artifactDir);
  const result = executeCleanup(root, { runId: run.id, dryRun: true });
  assert.ok(result.removed.some((item) => item.path.endsWith('feature-contract.md')));
  assert.ok(result.toPreserve.some((item) => item.path.endsWith('delivery-preparation.md')));
  assert.equal(fs.existsSync(path.join(artifactDir, 'feature-contract.md')), true);
});

test('cleanup --run isolation leaves other completed run untouched', () => {
  const root = makeRoot();
  const first = completedFeature(root, 'feature-development-first');
  writeRunArtifacts(first.artifactDir);
  const secondDir = path.join(first.eos, 'artifacts', 'feature-development-second');
  fs.mkdirSync(secondDir, { recursive: true });
  fs.writeFileSync(path.join(secondDir, 'feature-contract.md'), '# second');
  first.state.completed_runs.push({
    id: 'feature-development-second',
    workflow_id: 'feature-development',
    status: 'completed',
    artifacts_dir: secondDir,
  });
  saveState(root, first.state);

  executeCleanup(root, { runId: first.run.id });
  assert.equal(fs.existsSync(path.join(first.artifactDir, 'feature-contract.md')), false);
  assert.equal(fs.existsSync(path.join(secondDir, 'feature-contract.md')), true);
});

test('missing run is a safe no-op and malicious run IDs are rejected', () => {
  const root = makeRoot();
  fs.mkdirSync(eosDir(root), { recursive: true });
  assert.equal(isValidRunId('../src'), false);
  assert.throws(() => planCleanup(root, { runId: '../src' }), /Invalid run ID/);
  const missing = executeCleanup(root, { runId: 'missing-run' });
  assert.equal(missing.removed.length, 0);
  assert.match(missing.notes[0], /does not exist/);
});

test('cleanup cannot escape .engineering-os through symlinks', () => {
  const root = makeRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-outside-'));
  const { eos, run } = completedFeature(root, 'feature-development-symlink');
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  fs.mkdirSync(path.join(eos, 'test-setup-staging'), { recursive: true });
  fs.symlinkSync(outside, path.join(eos, 'test-setup-staging', run.id));

  assert.throws(() => executeCleanup(root, { runId: run.id }), /symlink escape/);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(JSON.parse(fs.readFileSync(path.join(eos, 'state.json'))).active_run.id, run.id);
});

test('unrelated .engineering-os project files are preserved', () => {
  const root = makeRoot();
  const { eos, artifactDir, run } = completedFeature(root);
  writeRunArtifacts(artifactDir);
  fs.mkdirSync(path.join(eos, 'knowledge-base', 'patterns'), { recursive: true });
  fs.writeFileSync(path.join(eos, 'knowledge-base', 'patterns', 'keep.md'), '# keep');
  fs.mkdirSync(path.join(eos, 'intelligence'), { recursive: true });
  fs.writeFileSync(path.join(eos, 'intelligence', 'project-dna.json'), '{}');

  executeCleanup(root, { runId: run.id, automatic: true });
  assert.equal(fs.existsSync(path.join(eos, 'knowledge-base', 'patterns', 'keep.md')), true);
  assert.equal(fs.existsSync(path.join(eos, 'intelligence', 'project-dna.json')), true);
});

test('eos init gitignore block is idempotent and includes all runtime paths', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  assert.equal(ensureConsumerGitignore(root).changed, true);
  assert.equal(ensureConsumerGitignore(root).changed, false);
  const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  // The whole .engineering-os/ directory is ignored (local, regenerable state).
  assert.match(content, /^\.engineering-os\/$/m);
  assert.equal((content.match(/managed by eos init/g) || []).length, 1);
});

test('automatic cleanup eligibility requires verification, implementation, and delivery', () => {
  const root = makeRoot();
  const { run } = completedFeature(root);
  assert.equal(isAutomaticCleanupEligible(run).ok, true);
  delete run.implementation_entered_at;
  assert.equal(isAutomaticCleanupEligible(run).ok, false);
});
