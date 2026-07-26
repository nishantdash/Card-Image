// Deprecated shim.
//
// The blocklists, matching and redaction now live in shared/guardrails/ so that
// the serverless function in api/ runs the identical implementation. Import from
// there instead:
//
//   import { scanText, redactText, sanitizePrompt } from '../../shared/guardrails/index.js';
//
// Kept only so any straggling import keeps resolving.
export { sanitizePrompt, scanText, redactText } from '../../shared/guardrails/index.js';
export { CATEGORIES as RESTRICTED } from '../../shared/guardrails/index.js';
