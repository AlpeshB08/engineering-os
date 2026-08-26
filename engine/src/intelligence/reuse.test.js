import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepository } from './scan.js';
import { runIntelScan } from './dna.js';
import { rankReuse } from './reuse.js';
import { generateGraphs } from './graphs.js';
import { analyzeChangeImpact } from './changeImpact.js';
import { buildContextPack } from './context.js';
import { searchKnowledge, buildKnowledgeIndex } from './knowledge.js';
import { frameworkHome } from '../paths.js';

function makeFeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-intel-'));
  fs.mkdirSync(path.join(dir, 'src/components/ui'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/hooks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/store'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/pages'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      dependencies: { react: '19.0.0', axios: '1.0.0' },
      devDependencies: { vite: '6.0.0', vitest: '3.0.0' },
      scripts: { build: 'vite build', test: 'vitest' },
    })
  );
  fs.writeFileSync(path.join(dir, 'src/components/ui/Button.tsx'), 'export const Button = () => null;\n');
  fs.writeFileSync(
    path.join(dir, 'src/components/UserCard.tsx'),
    "import { Button } from '@/components/ui/Button';\nexport const UserCard = () => <Button />;\n"
  );
  fs.writeFileSync(path.join(dir, 'src/hooks/useUser.ts'), 'export function useUser() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'src/store/userStore.ts'), 'export const useUserStore = () => ({});\n');
  fs.writeFileSync(path.join(dir, 'src/api/users.ts'), "import axios from 'axios';\nexport const getUsers = () => axios.get('/users');\n");
  fs.writeFileSync(
    path.join(dir, 'src/pages/UsersPage.tsx'),
    "import { UserCard } from '@/components/UserCard';\nexport default function UsersPage(){ return <UserCard/> }\n"
  );
  return dir;
}

test('scan classifies inventory categories', () => {
  const dir = makeFeFixture();
  const dna = scanRepository(dir);
  assert.ok(dna.counts.design_system >= 1);
  assert.ok(dna.counts.components >= 1);
  assert.ok(dna.counts.hooks >= 1);
  assert.ok(dna.counts.stores >= 1);
  assert.ok(dna.counts.apis >= 1);
  assert.ok(dna.counts.routes >= 1);
});

test('intel scan writes project dna', () => {
  const dir = makeFeFixture();
  const home = frameworkHome();
  // init minimal eos dir
  fs.mkdirSync(path.join(dir, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.engineering-os', 'state.json'),
    JSON.stringify({ version: 1, initialized_at: new Date().toISOString(), capabilities: {}, archetype: 'unknown', active_run: null })
  );
  const result = runIntelScan(dir, home);
  assert.ok(fs.existsSync(result.outputs.dnaJson));
  assert.ok(fs.existsSync(result.outputs.dnaMd));
  assert.equal(result.archetype, 'frontend');
});

test('reuse ranks button candidate highly', () => {
  const dir = makeFeFixture();
  const home = frameworkHome();
  fs.mkdirSync(path.join(dir, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.engineering-os', 'state.json'),
    JSON.stringify({ version: 1, initialized_at: new Date().toISOString(), capabilities: {}, archetype: 'frontend', active_run: null })
  );
  runIntelScan(dir, home);
  const result = rankReuse(dir, 'button component ui');
  assert.ok(result.candidates.length >= 1);
  assert.ok(['reuse', 'adapt'].includes(result.recommendation));
  assert.ok(result.candidates[0].path.includes('Button'));
});

test('graphs and change-impact run', () => {
  const dir = makeFeFixture();
  const home = frameworkHome();
  fs.mkdirSync(path.join(dir, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.engineering-os', 'state.json'),
    JSON.stringify({ version: 1, initialized_at: new Date().toISOString(), capabilities: {}, archetype: 'frontend', active_run: null })
  );
  runIntelScan(dir, home);
  const graphs = generateGraphs(dir);
  assert.ok(graphs['shared-components']);
  const impact = analyzeChangeImpact(dir, 'src/components/ui/Button.tsx');
  assert.equal(impact.target, 'src/components/ui/Button.tsx');
});

test('knowledge search finds backend lessons', () => {
  const home = frameworkHome();
  const dir = makeFeFixture();
  fs.mkdirSync(path.join(dir, '.engineering-os', 'knowledge-base'), { recursive: true });
  buildKnowledgeIndex(home, dir);
  const hits = searchKnowledge(home, dir, 'backend invent contract', 10);
  assert.ok(hits.length >= 1);
});

test('context pack stays relatively small', () => {
  const dir = makeFeFixture();
  const home = frameworkHome();
  fs.mkdirSync(path.join(dir, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.engineering-os', 'state.json'),
    JSON.stringify({
      version: 1,
      initialized_at: new Date().toISOString(),
      capabilities: {},
      archetype: 'frontend',
      active_run: {
        id: 't',
        workflow_id: 'feature-development',
        current_phase: 'plan',
        phase_index: 3,
        artifacts_dir: path.join(dir, '.engineering-os', 'artifacts', 't'),
        completed_phases: [],
        gates: {},
        flags: {},
        status: 'active',
      },
    })
  );
  fs.mkdirSync(path.join(dir, '.engineering-os', 'artifacts', 't'), { recursive: true });
  runIntelScan(dir, home);
  const pack = buildContextPack({
    root: dir,
    frameworkHome: home,
    state: JSON.parse(fs.readFileSync(path.join(dir, '.engineering-os', 'state.json'), 'utf8')),
    workflow: { id: 'feature-development' },
    phaseId: 'plan',
  });
  assert.ok(pack.bytes < 20000);
  assert.ok(fs.existsSync(pack.path));
});
