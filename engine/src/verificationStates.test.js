import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFICATION_STATE,
  normalizeVerificationState,
  resolveE2eVerificationState,
  satisfiesVerificationGate,
} from './verificationStates.js';

test('normalizeVerificationState maps legacy values', () => {
  assert.equal(normalizeVerificationState('Passed'), VERIFICATION_STATE.PASS);
  assert.equal(normalizeVerificationState('NotRun'), VERIFICATION_STATE.NOT_RUN);
  assert.equal(normalizeVerificationState('NotRequired'), VERIFICATION_STATE.NOT_APPLICABLE);
});

test('satisfiesVerificationGate accepts PASS and NOT_APPLICABLE only', () => {
  assert.equal(satisfiesVerificationGate(VERIFICATION_STATE.PASS), true);
  assert.equal(satisfiesVerificationGate(VERIFICATION_STATE.NOT_APPLICABLE), true);
  assert.equal(satisfiesVerificationGate(VERIFICATION_STATE.NOT_RUN), false);
  assert.equal(satisfiesVerificationGate(VERIFICATION_STATE.MANUAL_REQUIRED), false);
});

test('resolveE2eVerificationState never converts NOT_AVAILABLE to PASS', () => {
  assert.equal(
    resolveE2eVerificationState({
      e2eRequired: true,
      e2eAvailable: false,
      e2eConfigured: false,
      manualQaSelected: false,
      executed: false,
      passed: false,
    }),
    VERIFICATION_STATE.NOT_AVAILABLE
  );
  assert.equal(
    resolveE2eVerificationState({
      e2eRequired: true,
      e2eAvailable: false,
      e2eConfigured: false,
      manualQaSelected: true,
      executed: false,
      passed: false,
    }),
    VERIFICATION_STATE.MANUAL_REQUIRED
  );
});
