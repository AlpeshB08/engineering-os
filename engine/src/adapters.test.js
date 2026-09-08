import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { frameworkHome } from './paths.js';

const HOME = frameworkHome();
const read = (rel) => fs.readFileSync(path.join(HOME, rel), 'utf8');

test('every shipped adapter exists with its README', () => {
  for (const dir of ['cursor', 'claude-code', 'copilot', 'generic', 'agents-md', 'skill']) {
    const abs = path.join(HOME, 'adapters', dir);
    assert.ok(fs.existsSync(abs), `adapters/${dir} is missing`);
    assert.ok(fs.existsSync(path.join(abs, 'README.md')), `adapters/${dir}/README.md is missing`);
  }
});

test('AGENTS.md adapter states the workflow and the hard rules', () => {
  const content = read('adapters/agents-md/AGENTS.md');
  // the ordered flow
  for (const marker of ['Intake', 'Clarify recursively', 'Testing strategy', 'Test cases before code', 'Regression']) {
    assert.match(content, new RegExp(marker, 'i'), `AGENTS.md should describe: ${marker}`);
  }
  // the rules that keep the workflow honest
  assert.match(content, /--confirm test-cases/);
  assert.match(content, /--implemented/);
  assert.match(content, /Never\*{0,2} run `npm`|Never\*{0,2} run/i);
  assert.match(content, /\.engineering-os\/` is local|gitignored/i);
});

test('SKILL.md has valid frontmatter with a triggering description', () => {
  const content = read('adapters/skill/engineering-os-feature/SKILL.md');
  assert.ok(content.startsWith('---\n'), 'SKILL.md must start with YAML frontmatter');
  const raw = content.slice(4, content.indexOf('\n---', 4));
  const meta = YAML.parse(raw);
  assert.equal(meta.name, 'engineering-os-feature');
  assert.equal(typeof meta.description, 'string');
  assert.ok(meta.description.length > 40, 'description must be specific enough to trigger on');
  // body must drive the real CLI, not a made-up process
  assert.match(content, /eos feature --jira/);
  assert.match(content, /--confirm test-cases/);
});

test('adapters never instruct the agent to run build/test tooling directly', () => {
  const files = [
    'adapters/agents-md/AGENTS.md',
    'adapters/skill/engineering-os-feature/SKILL.md',
    'adapters/generic/ENGINEERING_OS.md',
    'adapters/cursor/.cursor/commands/feature.md',
    'adapters/claude-code/.claude/commands/feature.md',
  ];
  for (const rel of files) {
    const content = read(rel);
    assert.match(
      content,
      /never\s*\*{0,2}\s*run\*{0,2}\s*`?npm/i,
      `${rel} must forbid running build/test tooling directly`
    );
    assert.match(content, /--implemented/, `${rel} must point at the EOS test-execution path`);
  }
});
