/**
 * Canonical verification states — truthful execution reporting.
 * Internal legacy values (Passed, NotRun, …) map to these via normalizeVerificationState().
 */

export const VERIFICATION_STATE = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_RUN: 'NOT_RUN',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  MANUAL_REQUIRED: 'MANUAL_REQUIRED',
  BLOCKED: 'BLOCKED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

/** Final delivery statuses beyond verify.js FINAL_STATUSES */
export const DELIVERY_STATUS = {
  READY_FOR_REVIEW: 'READY FOR REVIEW',
  NOT_READY: 'NOT READY',
  BLOCKED: 'BLOCKED',
  IMPLEMENTED_BUT_VERIFICATION_PENDING: 'IMPLEMENTED_BUT_VERIFICATION_PENDING',
};

const LEGACY_TO_CANONICAL = {
  pass: VERIFICATION_STATE.PASS,
  passed: VERIFICATION_STATE.PASS,
  fail: VERIFICATION_STATE.FAIL,
  failed: VERIFICATION_STATE.FAIL,
  notrun: VERIFICATION_STATE.NOT_RUN,
  'not run': VERIFICATION_STATE.NOT_RUN,
  notrequired: VERIFICATION_STATE.NOT_APPLICABLE,
  'not required': VERIFICATION_STATE.NOT_APPLICABLE,
  notavailable: VERIFICATION_STATE.NOT_AVAILABLE,
  'not available': VERIFICATION_STATE.NOT_AVAILABLE,
  manualrequired: VERIFICATION_STATE.MANUAL_REQUIRED,
  'manual required': VERIFICATION_STATE.MANUAL_REQUIRED,
  blocked: VERIFICATION_STATE.BLOCKED,
  notapplicable: VERIFICATION_STATE.NOT_APPLICABLE,
  'not applicable': VERIFICATION_STATE.NOT_APPLICABLE,
  planned: VERIFICATION_STATE.NOT_RUN,
  partial: VERIFICATION_STATE.NOT_RUN,
  missing: VERIFICATION_STATE.NOT_RUN,
};

const CANONICAL_TO_LEGACY = {
  [VERIFICATION_STATE.PASS]: 'Passed',
  [VERIFICATION_STATE.FAIL]: 'Failed',
  [VERIFICATION_STATE.NOT_RUN]: 'NotRun',
  [VERIFICATION_STATE.NOT_AVAILABLE]: 'NotAvailable',
  [VERIFICATION_STATE.MANUAL_REQUIRED]: 'ManualRequired',
  [VERIFICATION_STATE.BLOCKED]: 'Blocked',
  [VERIFICATION_STATE.NOT_APPLICABLE]: 'NotRequired',
};

export function normalizeVerificationState(value) {
  if (!value) return VERIFICATION_STATE.NOT_RUN;
  const raw = String(value).trim();
  if (Object.values(VERIFICATION_STATE).includes(raw)) return raw;
  const key = raw.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return LEGACY_TO_CANONICAL[key] || LEGACY_TO_CANONICAL[raw.toLowerCase()] || VERIFICATION_STATE.NOT_RUN;
}

export function toLegacyExecutionState(canonical) {
  return CANONICAL_TO_LEGACY[normalizeVerificationState(canonical)] || 'NotRun';
}

export function isTerminalPass(state) {
  return normalizeVerificationState(state) === VERIFICATION_STATE.PASS;
}

export function isOutstandingVerification(state) {
  const normalized = normalizeVerificationState(state);
  return [
    VERIFICATION_STATE.NOT_RUN,
    VERIFICATION_STATE.FAIL,
    VERIFICATION_STATE.NOT_AVAILABLE,
    VERIFICATION_STATE.MANUAL_REQUIRED,
    VERIFICATION_STATE.BLOCKED,
  ].includes(normalized);
}

export function satisfiesVerificationGate(state) {
  const normalized = normalizeVerificationState(state);
  return normalized === VERIFICATION_STATE.PASS || normalized === VERIFICATION_STATE.NOT_APPLICABLE;
}

/**
 * Resolve E2E verification truth from strategy + capability + execution.
 */
export function resolveE2eVerificationState({ e2eRequired, e2eAvailable, e2eConfigured, manualQaSelected, executed, passed }) {
  if (!e2eRequired) return VERIFICATION_STATE.NOT_APPLICABLE;
  if (manualQaSelected) return VERIFICATION_STATE.MANUAL_REQUIRED;
  if (!e2eAvailable && !e2eConfigured) return VERIFICATION_STATE.NOT_AVAILABLE;
  if (!executed) return VERIFICATION_STATE.NOT_RUN;
  return passed ? VERIFICATION_STATE.PASS : VERIFICATION_STATE.FAIL;
}
