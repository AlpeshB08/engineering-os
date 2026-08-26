import fs from 'node:fs';
import path from 'node:path';
import { extractAcceptanceCriteria } from './intelligence/verificationMatrix.js';
import { validateVerificationPlanTestPlanning } from './intelligence/testStrategy.js';
import { isJiraDiscoveryComplete, loadNormalizedJira } from './integrations/jira.js';
import { isFigmaDiscoveryComplete, loadFigmaDiscovery, validateFigmaDiscoveryContent } from './integrations/figma.js';
import { ensureDir, fileExists, intelligenceDir, templatesDir } from './paths.js';
import { replaceTokens, today } from './util.js';
import { hasPendingWorkflowDecisions } from './workflowDecisions.js';

const ARTIFACT_TEMPLATE_MAP = {
  'repository-profile': 'repository-profile.md',
  'project-dna': 'project-dna.md',
  'discovery-notes': 'discovery-notes.md',
  'feature-contract': 'feature-contract.md',
  'implementation-plan': 'implementation-plan.md',
  'verification-plan': 'verification-plan.md',
  'backend-dependency': 'backend-dependency.md',
  'verification-evidence': 'verification-evidence.md',
  'review-notes': 'review-notes.md',
  'delivery-preparation': 'delivery-preparation.md',
  'decision-log': 'decision-log.md',
  'audit-report': 'audit-report.md',
  report: 'report.md',
  'feature-impact': 'feature-impact.md',
  'reuse-analysis': 'reuse-analysis.md',
  'context-package': 'context-package.md',
};

const COMPLETE_STATUSES = new Set([
  'ready',
  'ready-for-approval',
  'approved',
  'executed',
  'complete',
  'signed-off',
]);

const INTEL_ROOT_ARTIFACTS = new Set(['repository-profile', 'project-dna']);

export function artifactFileName(artifactId) {
  return ARTIFACT_TEMPLATE_MAP[artifactId] || `${artifactId}.md`;
}

export function artifactPath(artifactsDir, artifactId) {
  return path.join(artifactsDir, artifactFileName(artifactId));
}

export function seedArtifact(frameworkRoot, artifactsDir, artifactId, tokens) {
  if (INTEL_ROOT_ARTIFACTS.has(artifactId)) return null;
  const templateName = ARTIFACT_TEMPLATE_MAP[artifactId];
  if (!templateName) return null;
  const templatePath = path.join(templatesDir(frameworkRoot), templateName);
  if (!fileExists(templatePath)) {
    throw new Error(`Missing template: ${templatePath}`);
  }
  ensureDir(artifactsDir);
  const dest = artifactPath(artifactsDir, artifactId);
  if (fileExists(dest)) return dest;
  const raw = fs.readFileSync(templatePath, 'utf8');
  fs.writeFileSync(dest, replaceTokens(raw, tokens));
  return dest;
}

export function seedRunArtifacts(frameworkRoot, artifactsDir, workflow, tokens) {
  const needed = new Set(['decision-log']);
  for (const step of workflow.phases) {
    for (const a of step.required_artifacts || []) {
      if (!INTEL_ROOT_ARTIFACTS.has(a)) needed.add(a);
    }
  }
  const created = [];
  for (const id of needed) {
    const p = seedArtifact(frameworkRoot, artifactsDir, id, tokens);
    if (p) created.push(p);
  }
  return created;
}

export function defaultTokens({ runId, workflowId }) {
  return {
    run_id: runId,
    workflow_id: workflowId,
    date: today(),
    repo_root: process.cwd(),
  };
}

export function resolveArtifactPath(artifactsDir, artifactId, eosRoot) {
  if (artifactId === 'repository-profile') {
    return path.join(eosRoot, 'repository-profile.md');
  }
  if (artifactId === 'project-dna') {
    return path.join(eosRoot, 'intelligence', 'project-dna.md');
  }
  return artifactPath(artifactsDir, artifactId);
}

export function artifactExists(artifactsDir, artifactId, eosRoot) {
  if (artifactId === 'repository-profile') {
    return fileExists(path.join(eosRoot, 'repository-profile.md'));
  }
  if (artifactId === 'project-dna') {
    return fileExists(path.join(eosRoot, 'intelligence', 'project-dna.md'));
  }
  return fileExists(artifactPath(artifactsDir, artifactId));
}

export function readArtifactStatus(content) {
  const m = content.match(/EOS_ARTIFACT_STATUS:\s*([a-z-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function countImpactPaths(content, sectionHeader) {
  const section = content.split(sectionHeader)[1]?.split('\n## ')[0] || '';
  return (section.match(/^- `/gm) || []).length;
}

function validateDiscoveryNotes(content, intake, consumerRoot) {
  if (intake?.jira?.key) {
    if (!content.includes('## Jira requirements')) return false;
    const normalized = loadNormalizedJira(consumerRoot, intake.jira.key);
    if (!normalized || !isJiraDiscoveryComplete(normalized)) return false;
  }
  if (intake?.figma?.url) {
    const figmaCheck = validateFigmaDiscoveryContent(content);
    if (!figmaCheck.valid) return false;
  }
  return content.trim().length > 150 && !content.includes('_(fill');
}

function validateFeatureContract(content) {
  const problem = content.split('## Problem')[1]?.split('\n## ')[0] || '';
  if (problem.trim().length < 10 || problem.includes('_(fill')) return false;
  const ac = extractAcceptanceCriteria(content);
  return ac.length >= 1;
}

function validateImplementationPlan(content) {
  const steps =
    content.split('## Implementation steps')[1]?.split('\n## ')[0] ||
    content.split('## Proposed changes')[1]?.split('\n## ')[0] ||
    '';
  return (
    (/^\s*\d+\./m.test(steps) || /### Step \d+/m.test(steps)) &&
    !steps.includes('_(fill')
  );
}

function validateVerificationPlanDeep(content, contractContent) {
  const hasStrategy =
    content.includes('## Test Strategy') &&
    /Unit Tests:\s*(Required|Not Required)/i.test(content) &&
    /E2E Tests:\s*(Required|Not Required)/i.test(content) &&
    /Manual QA:\s*(Required|Not Required)/i.test(content);
  const hasScenarios = content.includes('## Test Scenarios');
  const hasMatrix =
    content.includes('## Verification matrix') &&
    content.includes('| AC |') &&
    !/\| AC1 \| \| \| \| \| \| \| \| \|/.test(content);
  const acCount = extractAcceptanceCriteria(contractContent).length;
  const matrixRows = (content.match(/\| AC\d+/g) || []).length;
  const matrixOk = acCount === 0 || matrixRows >= acCount;
  const planning = validateVerificationPlanTestPlanning(content, contractContent);
  return hasStrategy && hasScenarios && hasMatrix && matrixOk && planning.ok;
}

export function validateVerificationPlanIssues(content, contractContent) {
  const issues = [];
  if (!content.includes('## Test Strategy')) issues.push('verification-plan: missing Test Strategy');
  if (!/Manual QA:\s*(Required|Not Required)/i.test(content)) {
    issues.push('verification-plan: missing Manual QA decision');
  }
  if (!content.includes('## Test Scenarios')) issues.push('verification-plan: missing Test Scenarios');
  const acCount = extractAcceptanceCriteria(contractContent).length;
  const matrixRows = (content.match(/\| AC\d+/g) || []).length;
  if (acCount > 0 && matrixRows < acCount) {
    issues.push('verification-plan: verification matrix missing AC rows');
  }
  const planning = validateVerificationPlanTestPlanning(content, contractContent);
  if (!planning.ok) issues.push(...planning.issues.map((i) => `verification-plan: ${i}`));
  return issues;
}

export function validatePlanBundle(run, state, eosRoot) {
  const consumerRoot = path.dirname(eosRoot);
  const intake = state?.feature_intake;
  const artifacts = [
    'discovery-notes',
    'feature-contract',
    'feature-impact',
    'reuse-analysis',
    'backend-dependency',
    'verification-plan',
    'implementation-plan',
  ];
  const artifactStatus = {};
  const issues = [];
  let contractContent = '';

  for (const id of artifacts) {
    let ok = artifactLooksComplete(run.artifacts_dir, id, eosRoot, { intake, consumerRoot });
    if (id === 'feature-contract') {
      const p = artifactPath(run.artifacts_dir, id);
      if (fileExists(p)) contractContent = fs.readFileSync(p, 'utf8');
    }
    if (id === 'verification-plan' && contractContent) {
      const p = artifactPath(run.artifacts_dir, id);
      const content = fs.readFileSync(p, 'utf8');
      ok = validateVerificationPlanDeep(content, contractContent);
      if (!ok) {
        issues.push(...validateVerificationPlanIssues(content, contractContent));
      }
    }
    artifactStatus[id] = ok;
    if (!ok) {
      if (id === 'verification-plan' && contractContent) {
        // detailed verification-plan issues already appended
      } else {
        issues.push(id);
      }
    }
  }

  if (run.blocked) issues.push('run_blocked');
  if (hasPendingWorkflowDecisions(run)) issues.push('pending_workflow_decisions');
  return { ok: issues.length === 0, issues, artifactStatus };
}

export function artifactLooksComplete(artifactsDir, artifactId, eosRoot, ctx = null) {
  let p;
  if (artifactId === 'repository-profile') {
    p = path.join(eosRoot, 'repository-profile.md');
  } else if (artifactId === 'project-dna') {
    p = path.join(eosRoot, 'intelligence', 'project-dna.md');
  } else {
    p = artifactPath(artifactsDir, artifactId);
  }
  if (!fileExists(p)) return false;
  const content = fs.readFileSync(p, 'utf8');
  if (artifactId === 'repository-profile') {
    return content.includes('Archetype:') && content.trim().length > 80;
  }
  if (artifactId === 'project-dna') {
    return content.includes('Project DNA') && content.trim().length > 80;
  }
  if (artifactId === 'decision-log') {
    return content.trim().length > 40;
  }
  if (artifactId === 'discovery-notes' && ctx?.intake) {
    return validateDiscoveryNotes(content, ctx.intake, ctx.consumerRoot || path.dirname(eosRoot));
  }
  if (artifactId === 'feature-contract') {
    return validateFeatureContract(content);
  }
  if (artifactId === 'implementation-plan') {
    return validateImplementationPlan(content);
  }
  if (artifactId === 'verification-plan') {
    const contractPath = artifactPath(artifactsDir, 'feature-contract');
    const contractContent = fileExists(contractPath) ? fs.readFileSync(contractPath, 'utf8') : '';
    return validateVerificationPlanDeep(content, contractContent);
  }
  if (artifactId === 'context-package') {
    return content.includes('Pack path:') || COMPLETE_STATUSES.has(readArtifactStatus(content) || '');
  }
  const status = readArtifactStatus(content);
  if (!status) {
    return content.trim().length > 200 && !content.includes('_(fill');
  }
  return COMPLETE_STATUSES.has(status);
}

export function markArtifactStatus(filePath, status) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (/EOS_ARTIFACT_STATUS:\s*[a-z-]+/i.test(content)) {
    content = content.replace(
      /EOS_ARTIFACT_STATUS:\s*[a-z-]+/i,
      `EOS_ARTIFACT_STATUS: ${status}`
    );
  } else {
    content = content.replace(
      /^# .+$/m,
      (m) => `${m}\n\n<!-- EOS_ARTIFACT_STATUS: ${status} -->`
    );
  }
  fs.writeFileSync(filePath, content);
}
