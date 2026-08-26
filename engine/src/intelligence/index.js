export { runIntelScan, loadDna, dnaJsonPath, dnaMdPath } from './dna.js';
export { scanRepository } from './scan.js';
export { generateGraphs, loadAllGraphs } from './graphs.js';
export {
  analyzeChangeImpact,
  renderChangeImpactMarkdown,
} from './changeImpact.js';
export { rankReuse, writeReuseAnalysis, renderReuseAnalysisMarkdown } from './reuse.js';
export {
  generateFeatureImpact,
  writeFeatureImpact,
  renderFeatureImpactMarkdown,
} from './impact.js';
export { buildContextPack } from './context.js';
export {
  buildKnowledgeIndex,
  searchKnowledge,
  scaffoldKnowledgeEntry,
} from './knowledge.js';
export {
  extractAcceptanceCriteria,
  buildVerificationMatrixRows,
  renderMatrixMarkdown,
} from './verificationMatrix.js';
export { BACKEND_RULES, backendAvailabilityFromDna } from './backendContract.js';
export { scaffoldBackendDependency } from './backendScaffold.js';
export { fillVerificationMatrix, fillVerificationPlanStrategy } from './verifyPlan.js';
export {
  decideTestStrategy,
  generateUnitScenarios,
  generateE2eScenarios,
  generateManualScenarios,
  renderTestStrategySection,
  renderTestScenariosSection,
  applyTestStrategyToVerificationPlan,
  applyTestScenariosToPlan,
  analyzeFeatureRisk,
  parseImpactSignals,
  parseScenariosFromPlan,
  scenariosForAc,
  validateVerificationPlanTestPlanning,
  formatScenarioId,
  SCENARIO_ID_RE,
} from './testStrategy.js';
export {
  detectTestCapabilities,
  detectRepositoryEcosystem,
  resolveTestStrategyWithCapabilities,
  isTestCapabilityDecisionPending,
  classifyTestExecutionFailure,
  computeRiskAutomationNeeds,
  buildSetupProposal,
  buildPackageManagerCommand,
  evaluateReuseDecision,
  isAutomationAvailable,
  applyApprovedTestCapabilitySetup,
  executeApprovedTestCapabilitySetup,
  verifyTestCapabilitySetup,
  applyApprovedSetupWithVerification,
  recordTestCapabilityDecision,
  renderApprovalRequest,
  CAPABILITY_STATUS,
  SETUP_VERIFICATION,
  FAILURE_CLASS,
} from './testCapabilities.js';
export {
  preferStableSelector,
  shouldUsePageObjectModel,
  generateE2eTestFromScenario,
  generatePageObjectStub,
  buildE2eExplorationGuide,
  diagnoseE2eFailure,
  applyLimitedE2eTestFix,
  renderE2eAutomationSection,
  renderE2eExecutionEvidenceBlock,
  isBrittleSelector,
} from './e2eCapability.js';
export { generateUnitTestFromScenario } from './unitTestGeneration.js';
export {
  buildRegressionImpact,
  decideRegressionStrategy,
  generateRegressionScenarios,
  generateQaRegressionScope,
  formatRegId,
  REG_SCENARIO_ID_RE,
  validateRegressionPlanPlanning,
} from './regressionImpact.js';
