import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeatureIntake, parseJiraReference, parseFigmaUrl } from './intake.js';

test('parseJiraReference from key', () => {
  const r = parseJiraReference('PROJ-123');
  assert.equal(r.key, 'PROJ-123');
  assert.equal(r.source, 'key');
});

test('parseJiraReference from URL', () => {
  const r = parseJiraReference('https://acme.atlassian.net/browse/ENG-42');
  assert.equal(r.key, 'ENG-42');
  assert.equal(r.source, 'url');
});

test('parseFigmaUrl', () => {
  const r = parseFigmaUrl('See https://www.figma.com/design/abc/My-File?node-id=1-2');
  assert.ok(r.url.includes('figma.com/design/abc'));
});

test('parseFeatureIntake combines fields', () => {
  const intake = parseFeatureIntake({
    jira: 'PROJ-1',
    figma: 'https://figma.com/design/x/y',
    context: 'extra',
  });
  assert.equal(intake.jira.key, 'PROJ-1');
  assert.ok(intake.figma.url);
  assert.equal(intake.context, 'extra');
});

test('task description can seed concrete acceptance criteria without inventing extras', async () => {
  const { deriveAcceptanceCriteriaFromContext, seedContractFromTaskDescription, isContractSufficient } = await import('./intake.js');
  const concrete = 'Add a logout button that returns the user to the login page.';
  assert.deepEqual(deriveAcceptanceCriteriaFromContext(concrete), [concrete]);
  assert.deepEqual(deriveAcceptanceCriteriaFromContext('improve dashboard'), []);
  const contract = seedContractFromTaskDescription(
    '# Feature Contract\n\n## Problem\n\n<!-- What problem are we solving? -->\n\n## Scope — In\n\n-\n\n## Acceptance Criteria\n\n1.\n2.\n\n## Non-Goals\n\n-\n',
    concrete
  );
  assert.equal(isContractSufficient(contract), true);
  assert.match(contract, /logout button/);
  assert.equal(isContractSufficient(contract), true);
});
