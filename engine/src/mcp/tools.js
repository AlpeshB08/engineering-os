/**
 * MCP tool handlers for the Engineering OS /feature workflow.
 *
 * These are deliberately transport-free so they can be unit-tested without the MCP SDK.
 * Two hard constraints shape this module:
 *
 * 1. The MCP stdio transport owns stdout. The engine's command functions print the turn
 *    for human CLI use, so every engine call is wrapped in `captureOutput` — anything they
 *    print is captured, never written to stdout, which would corrupt the protocol frame.
 * 2. A tool call must never take the server down. Engine functions set `process.exitCode`
 *    on failure and can throw; both are contained here and surfaced as structured results.
 */

import { cmdFeatureStart, cmdFeatureContinue } from '../feature.js';
import { buildFeatureTurn, initFeatureSession } from '../featureLifecycle.js';
import { loadState } from '../state.js';
import { consumerRoot, frameworkHome } from '../paths.js';
import {
  buildGuardManifest,
  evaluateMutationAuthorization,
  isEosInitialized,
  isImplementationPermitted,
} from '../guard.js';

/** Run `fn` with console output captured and process.exitCode preserved. */
export async function captureOutput(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const lines = [];
  const sink = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  console.log = sink;
  console.error = sink;
  try {
    const result = await fn();
    return { ok: true, result, output: lines.join('\n') };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), output: lines.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

function context(options = {}) {
  return {
    root: options.root || consumerRoot(),
    home: options.home || frameworkHome(),
  };
}

/** Start a /feature run from Jira, Figma and/or a plain task description. */
export async function featureStart(args = {}, options = {}) {
  const { root, home } = context(options);
  const captured = await captureOutput(() =>
    cmdFeatureStart(root, home, {
      jira: args.jira,
      figma: args.figma,
      context: args.context,
    })
  );
  if (!captured.ok) return { ok: false, error: captured.error };
  const started = captured.result || {};
  return {
    ok: true,
    stage: started.stage ?? null,
    awaiting: started.awaiting ?? null,
    blocked: Boolean(started.blocked),
    phase: started.phase ?? null,
    turn: started.turn ?? null,
  };
}

/** Advance the active run: answer a question, confirm a stage, or submit implementation. */
export async function featureContinue(args = {}, options = {}) {
  const { root, home } = context(options);
  const captured = await captureOutput(() =>
    cmdFeatureContinue(root, home, {
      answer: args.answer,
      confirm: args.confirm,
      decision: args.decision,
      option: args.option,
      implemented: args.implemented,
      summary: args.summary,
      testsCreated: args.testsCreated,
    })
  );
  if (!captured.ok) return { ok: false, error: captured.error };
  const result = captured.result || {};
  return {
    ok: Boolean(result.ok),
    action: result.action ?? null,
    error: result.ok ? null : result.error || result.reason || captured.output || null,
    turn: result.turn ?? null,
  };
}

/** Read the current turn without mutating the run. */
export async function featureStatus(_args = {}, options = {}) {
  const { root } = context(options);
  const captured = await captureOutput(async () => {
    if (!isEosInitialized(root)) {
      return { initialized: false, turn: null };
    }
    const state = loadState(root);
    if (state?.active_run) initFeatureSession(state.active_run);
    return { initialized: true, turn: buildFeatureTurn(root, state, null) };
  });
  if (!captured.ok) return { ok: false, error: captured.error };
  return { ok: true, ...captured.result };
}

/** Check whether application mutation is currently authorized (optionally for a path). */
export async function guardCheck(args = {}, options = {}) {
  const { root } = context(options);
  const captured = await captureOutput(async () => {
    const eosInitialized = isEosInitialized(root);
    const run = eosInitialized ? loadState(root)?.active_run || null : null;
    if (args.path) {
      const check = evaluateMutationAuthorization({
        root,
        filePath: args.path,
        run,
        eosInitialized,
      });
      return { permitted: Boolean(check.ok), reason: check.reason || null, path: args.path };
    }
    const permission = run
      ? isImplementationPermitted(run)
      : { ok: false, reason: 'No active governed workflow run.' };
    return {
      permitted: Boolean(permission.ok),
      reason: permission.reason || null,
      manifest: buildGuardManifest(run),
    };
  });
  if (!captured.ok) return { ok: false, error: captured.error };
  return { ok: true, ...captured.result };
}

export const TOOL_HANDLERS = {
  feature_start: featureStart,
  feature_continue: featureContinue,
  feature_status: featureStatus,
  guard_check: guardCheck,
};
