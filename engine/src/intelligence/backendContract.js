/**
 * Guidance constants for backend contract intelligence.
 * Never invent backend implementation.
 */

export const BACKEND_CONTRACT_SECTIONS = [
  'required_contracts',
  'payload_changes',
  'response_changes',
  'validation_rules',
  'sorting',
  'filtering',
  'pagination',
  'exports',
  'permissions',
  'backward_compatibility',
  'implementation_questions',
];

export const BACKEND_RULES = [
  'Only document contracts evidenced by OpenAPI, existing clients, server source, or explicit human input.',
  'If backend availability is no or unknown, mark status unknown/missing and define stub strategy.',
  'Do not invent endpoints, fields, status codes, or auth models.',
  'Backward compatibility must be assessed before breaking response/payload changes.',
];

export function backendAvailabilityFromDna(dna) {
  const caps = dna?.capabilities || {};
  if (caps['backend-source']?.present) return 'yes';
  if (caps['api-client-only']?.present) return 'unknown';
  return 'unknown';
}
