import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readyFixtures, writeFixtureBundle } from '../fixtures/verifyFixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const CLI = path.join(REPO_ROOT, 'engine/src/cli.js');

const NPM_ENV_PREFIXES = ['npm_', 'NPM_'];
const NPM_ENV_EXACT = new Set([
  'INIT_CWD',
  'npm_command',
  'npm_execpath',
  'npm_node_execpath',
  'npm_lifecycle_event',
  'npm_lifecycle_script',
  'npm_package_name',
  'npm_package_version',
  'npm_package_json',
]);

function sanitizeInheritedEnv(sourceEnv) {
  const env = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined) continue;
    if (NPM_ENV_EXACT.has(key)) continue;
    if (NPM_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}

function buildSubprocessEnv(cwd) {
  const npmCache = path.join(cwd, '.npm-cache');
  const tmpDir = path.join(cwd, '.tmp');
  fs.mkdirSync(npmCache, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  return {
    ...sanitizeInheritedEnv(process.env),
    ENGINEERING_OS_HOME: REPO_ROOT,
    TMPDIR: tmpDir,
    NPM_CONFIG_CACHE: npmCache,
    npm_config_cache: npmCache,
  };
}

export function mkFrontendRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-test-'));
  fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'components', 'ui'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.npm-cache'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.npmrc'), 'cache=.npm-cache\n');
  // E2E tests exercise AC evidence and final readiness via production runEngineeringChecks().
  // Scripts invoke node directly so checks do not depend on undeclared node_modules binaries.
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'eos-test-app',
      dependencies: { react: '19.0.0' },
      devDependencies: { vite: '6.0.0', vitest: '2.0.0', eslint: '9.0.0' },
      scripts: {
        lint: 'node -e "process.exit(0)"',
        test: 'node -e "process.exit(0)"',
        build: 'node -e "process.exit(0)"',
      },
    })
  );
  fs.writeFileSync(path.join(dir, 'vite.config.ts'), 'export default {}');
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  fs.writeFileSync(path.join(dir, 'src', 'pages', 'Home.tsx'), 'export default function Home() { return null; }');
  fs.writeFileSync(
    path.join(dir, 'src', 'components', 'ui', 'Button.tsx'),
    'export function Button() { return null; }'
  );
  return dir;
}

export function runEos(cwd, args, { expectFail = false } = {}) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: buildSubprocessEnv(cwd),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (expectFail) {
      throw new Error(`Expected failure but succeeded: eos ${args.join(' ')}`);
    }
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    if (!expectFail && err.status === undefined) throw err;
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || '',
    };
  }
}

export function fixturePath(name) {
  return path.join(REPO_ROOT, 'engine/test/fixtures', name);
}

export function loadState(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.engineering-os', 'state.json'), 'utf8'));
}

function requireSuccessfulEos(repo, args, label) {
  const result = runEos(repo, args);
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stdout}\n${result.stderr}`);
  }
  return result;
}

export function seedVerifyReadyRun(repo, { fixtures = readyFixtures } = {}) {
  // Keep this verification fixture scoped to an isolated feature. The generic
  // frontend repo includes a shared component for regression tests, which would
  // legitimately require separate REG scenarios unrelated to these AC fixtures.
  fs.rmSync(path.join(repo, 'src', 'components', 'ui', 'Button.tsx'), { force: true });

  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'TEST-1']);
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-TEST-1.json')]);

  const pendingIds = () =>
    Object.values(loadState(repo).active_run?.workflow_decisions || {})
      .filter((d) => d.status === 'pending')
      .map((d) => d.id);
  if (pendingIds().includes('e2e-automation')) {
    requireSuccessfulEos(
      repo,
      ['decision', 'answer', 'e2e-automation', '--option', 'proceed_without_e2e'],
      'e2e-automation decision'
    );
  }
  if (pendingIds().includes('backend-dependency')) {
    requireSuccessfulEos(
      repo,
      ['decision', 'answer', 'backend-dependency', '--option', 'fe_only_stub'],
      'backend-dependency decision'
    );
  }

  const runId = loadState(repo).active_run.id;
  const fixtureOverrides = fixtures(runId);

  // Planning evidence must exist before approval, but implementation files are
  // deliberately withheld until the authoritative implement transition.
  writeFixtureBundle(repo, 'verify-ready', {
    runId,
    overrides: { 'verification-plan.md': fixtureOverrides['verification-plan.md'] },
    files: ['verification-plan.md'],
  });
  requireSuccessfulEos(repo, ['gate', 'contract-approval', '--approve'], 'contract-approval gate');
  requireSuccessfulEos(repo, ['gate', 'plan-approval', '--approve'], 'plan-approval gate');
  requireSuccessfulEos(repo, ['complete-phase'], 'approve-to-implement transition');

  const implementationState = loadState(repo).active_run;
  if (
    implementationState?.current_phase !== 'implement' ||
    !implementationState.implementation_entered_at
  ) {
    throw new Error('verify fixture did not enter implementation through complete-phase');
  }

  writeFixtureBundle(repo, 'verify-ready', {
    runId,
    overrides: fixtureOverrides,
    files: ['verification-evidence.md', 'review-notes.md'],
  });
  requireSuccessfulEos(repo, ['complete-phase'], 'implement-to-verify transition');

  const transitioned = loadState(repo).active_run;
  if (
    transitioned?.current_phase !== 'verify' ||
    !transitioned.completed_phases?.includes('implement')
  ) {
    throw new Error(
      `verify fixture failed to complete implementation (current=${transitioned?.current_phase || 'none'})`
    );
  }
  return { runId, state: loadState(repo) };
}
