import fs from 'node:fs';
import path from 'node:path';
import {
  buildVerificationMatrixRows,
  extractAcceptanceCriteria,
  renderMatrixMarkdown,
} from './verificationMatrix.js';

export function fillVerificationMatrix(artifactsDir, capabilities) {
  const contractPath = path.join(artifactsDir, 'feature-contract.md');
  const planPath = path.join(artifactsDir, 'verification-plan.md');
  if (!fs.existsSync(planPath)) throw new Error('verification-plan.md not found');
  const contract = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, 'utf8') : '';
  const ac = extractAcceptanceCriteria(contract);
  const rows = buildVerificationMatrixRows(ac, capabilities);
  const matrix = renderMatrixMarkdown(rows);

  let content = fs.readFileSync(planPath, 'utf8');
  const matrixHeader = '## Verification matrix';
  if (content.includes(matrixHeader)) {
    content = content.replace(
      /## Verification matrix[\s\S]*?(?=\n### Matrix guidance|\n## Manual checks)/,
      `${matrixHeader}\n\n${matrix.trim()}\n\n`
    );
  } else {
    content += `\n\n${matrixHeader}\n\n${matrix}\n`;
  }

  fs.writeFileSync(planPath, content);
  return { path: planPath, acceptanceCriteriaCount: ac.length, rowCount: rows.length };
}

export function fillVerificationPlanStrategy(artifactsDir, strategySection) {
  const planPath = path.join(artifactsDir, 'verification-plan.md');
  let content = fs.readFileSync(planPath, 'utf8');
  if (content.includes('## Test Strategy')) {
    content = content.replace(
      /## Test Strategy[\s\S]*?(?=\n## Automated checks|\n## Verification matrix)/,
      `${strategySection.trim()}\n\n`
    );
  } else {
    const marker = content.includes('## Automated checks') ? '## Automated checks' : '## Verification matrix';
    content = content.replace(marker, `${strategySection.trim()}\n\n${marker}`);
  }
  fs.writeFileSync(planPath, content);
  return planPath;
}
