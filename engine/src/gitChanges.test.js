import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  captureImplementationBaseline,
  getChangedFilesFromGit,
  getImplementationChangedFiles,
} from './gitChanges.js';
import { runIntelScan } from './intelligence/dna.js';
import { generateGraphs } from './intelligence/graphs.js';
import { frameworkHome } from './paths.js';
import { runPostImplementationRegressionReconciliation } from './intelligence/regressionReconciliation.js';

function runGit(cwd, args) {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
  });
}

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-git-'));
  runGit(dir, ['init']);
  runGit(dir, ['config', 'user.email', 'test@example.com']);
  runGit(dir, ['config', 'user.name', 'Test User']);
  return dir;
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commitAll(dir, message) {
  runGit(dir, ['add', '-A']);
  runGit(dir, ['commit', '-m', message]);
}

function captureBaseline(dir) {
  const run = {};
  const sha = captureImplementationBaseline(dir, run);
  assert.ok(sha);
  assert.equal(run.implementation_baseline_ref, sha);
  return run;
}

function makeSharedComponentRepo() {
  const dir = makeGitRepo();
  writeFile(dir, 'package.json', JSON.stringify({ dependencies: { react: '19' } }));
  writeFile(dir, 'src/components/ui/Button.tsx', 'export const Button = () => null;\n');
  writeFile(
    dir,
    'src/components/UserCard.tsx',
    "import { Button } from '@/components/ui/Button';\nexport const UserCard = () => <Button />;\n"
  );
  writeFile(
    dir,
    'src/pages/UsersPage.tsx',
    "import { UserCard } from '@/components/UserCard';\nexport default function UsersPage(){ return <UserCard/> }\n"
  );
  writeFile(
    dir,
    'src/pages/TeamDetails.tsx',
    "import { Button } from '@/components/ui/Button';\nexport default function TeamDetails(){ return <Button/> }\n"
  );
  fs.mkdirSync(path.join(dir, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.engineering-os', 'state.json'),
    JSON.stringify({
      version: 1,
      initialized_at: new Date().toISOString(),
      capabilities: {},
      archetype: 'frontend',
      active_run: null,
    })
  );
  commitAll(dir, 'baseline');
  return dir;
}

const regressionStrategy = {
  required: true,
  automatedRequired: true,
  manualRequired: true,
  label: 'Automated + Manual',
};

test('A: uncommitted tracked modification is detected', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/a.ts', 'export const a = 1;\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);
  writeFile(dir, 'src/a.ts', 'export const a = 2;\n');

  const result = getImplementationChangedFiles(dir, run);
  assert.deepEqual(result.files, ['src/a.ts']);
  assert.equal(result.source, 'git');
});

test('B: staged modification is detected', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/b.ts', 'export const b = 1;\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);
  writeFile(dir, 'src/b.ts', 'export const b = 2;\n');
  runGit(dir, ['add', 'src/b.ts']);

  const result = getImplementationChangedFiles(dir, run);
  assert.deepEqual(result.files, ['src/b.ts']);
});

test('C: untracked file is detected', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/existing.ts', 'export const existing = 1;\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);
  writeFile(dir, 'src/new.ts', 'export const created = 1;\n');

  const result = getImplementationChangedFiles(dir, run);
  assert.deepEqual(result.files, ['src/new.ts']);
});

test('D: uncommitted deletion is detected', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/remove.ts', 'export const remove = 1;\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);
  fs.unlinkSync(path.join(dir, 'src/remove.ts'));

  const result = getImplementationChangedFiles(dir, run);
  assert.deepEqual(result.files, ['src/remove.ts']);
});

test('E: committed post-baseline change is detected', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/c.ts', 'export const c = 1;\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);
  writeFile(dir, 'src/c.ts', 'export const c = 2;\n');
  commitAll(dir, 'post-baseline commit');

  const result = getImplementationChangedFiles(dir, run);
  assert.deepEqual(result.files, ['src/c.ts']);
});

test('F: no changes after baseline returns empty list', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/stable.ts', 'export const stable = 1;\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);

  const result = getImplementationChangedFiles(dir, run);
  assert.deepEqual(result.files, []);
});

test('G: changedFilesOverride remains unchanged', () => {
  const dir = makeGitRepo();
  const result = getImplementationChangedFiles(
    dir,
    {},
    { changedFiles: ['./src/override.ts', 'src/other.ts'] }
  );
  assert.deepEqual(result.files, ['src/override.ts', 'src/other.ts']);
  assert.equal(result.source, 'override');
});

test('Engineering OS metadata is excluded from Git and override implementation changes', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/app.ts', 'export const app = 1;\n');
  writeFile(dir, '.engineering-os/state.json', '{}\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);
  writeFile(dir, 'src/app.ts', 'export const app = 2;\n');
  writeFile(dir, '.engineering-os/state.json', '{"changed":true}\n');
  writeFile(dir, '.engineering-os/artifacts/run/verification-plan.md', '# plan\n');

  const gitResult = getImplementationChangedFiles(dir, run);
  assert.deepEqual(gitResult.files, ['src/app.ts']);

  const overrideResult = getImplementationChangedFiles(dir, {}, {
    changedFiles: ['.engineering-os/state.json', './src/app.ts'],
  });
  assert.deepEqual(overrideResult.files, ['src/app.ts']);
});

test('Git baseline arguments are not evaluated by a shell', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/app.ts', 'export const app = 1;\n');
  commitAll(dir, 'baseline');
  const marker = path.join(dir, 'injected');

  getChangedFilesFromGit(dir, { baseRef: `HEAD;touch ${marker}` });
  assert.equal(fs.existsSync(marker), false);
});

test('combination: modified + staged + untracked + committed changes deduplicated', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/modified.ts', 'export const modified = 1;\n');
  writeFile(dir, 'src/staged.ts', 'export const staged = 1;\n');
  writeFile(dir, 'src/committed.ts', 'export const committed = 1;\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);

  writeFile(dir, 'src/modified.ts', 'export const modified = 2;\n');
  writeFile(dir, 'src/staged.ts', 'export const staged = 2;\n');
  runGit(dir, ['add', 'src/staged.ts']);
  writeFile(dir, 'src/untracked.ts', 'export const untracked = 1;\n');
  writeFile(dir, 'src/committed.ts', 'export const committed = 2;\n');
  commitAll(dir, 'committed change');
  writeFile(dir, 'src/committed.ts', 'export const committed = 3;\n');

  const result = getImplementationChangedFiles(dir, run);
  assert.deepEqual(result.files, [
    'src/committed.ts',
    'src/modified.ts',
    'src/staged.ts',
    'src/untracked.ts',
  ]);
});

test('combination: deleted + untracked files together', () => {
  const dir = makeGitRepo();
  writeFile(dir, 'src/delete-me.ts', 'export const gone = 1;\n');
  commitAll(dir, 'baseline');
  const run = captureBaseline(dir);
  fs.unlinkSync(path.join(dir, 'src/delete-me.ts'));
  writeFile(dir, 'src/replacement.ts', 'export const replacement = 1;\n');

  const result = getImplementationChangedFiles(dir, run);
  assert.deepEqual(result.files, ['src/delete-me.ts', 'src/replacement.ts']);
});

test('integration: uncommitted shared component change drives reconciliation', () => {
  const dir = makeSharedComponentRepo();
  runIntelScan(dir, frameworkHome());
  generateGraphs(dir);
  commitAll(dir, 'intelligence artifacts');
  const run = captureBaseline(dir);

  writeFile(
    dir,
    'src/components/ui/Button.tsx',
    'export const Button = () => <button data-testid="changed" />;\n'
  );

  const changed = getImplementationChangedFiles(dir, run);
  assert.deepEqual(changed.files, ['src/components/ui/Button.tsx']);

  const result = runPostImplementationRegressionReconciliation({
    root: dir,
    planText: `## Regression Scenarios

- REG-001: changed \`src/components/ui/Button.tsx\` → consumer \`src/pages/UsersPage.tsx\` — verify existing behavior [high risk, automated, manual QA]
`,
    run,
    regressionStrategy,
  });

  assert.ok(result.changedFiles.includes('src/components/ui/Button.tsx'));
  assert.ok(
    result.reconciledScenarios.some((s) => s.consumerPath.includes('TeamDetails'))
  );
  const teamScenario = result.newlyDiscovered.find((s) => s.consumerPath.includes('TeamDetails'));
  assert.ok(teamScenario);
  assert.match(teamScenario.regId, /^REG-\d{3}$/);
  assert.ok(result.qaScope.some((q) => /TeamDetails/.test(q.label)));
});
