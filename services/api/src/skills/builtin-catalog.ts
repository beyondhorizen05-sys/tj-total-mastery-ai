import type { TextSkillManifest } from './service.js';

/** Reviewed, text-only playbooks adapted from linked public GitHub skills. */
export const BUILTIN_SKILL_CATALOG: Array<{ filename: string; manifest: TextSkillManifest }> = [
  {
    filename: 'safe-binary-triage-plan.json',
    manifest: {
      id: 'safe-binary-triage-plan', version: '1.0.0',
      description: 'Prepare a cautious binary triage plan from a public reverse-engineering skill; no scripts or binary execution are included. Source: https://github.com/juank115/reverse-engineerskill (MIT).',
      input_schema: { type: 'object', properties: { target: { type: 'string', maxLength: 1500 }, objective: { type: 'string', maxLength: 3000 } }, required: ['target', 'objective'], additionalProperties: false },
      output_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      permissions: [], execution: { method: 'text_template', template: 'Safe analysis plan (adapted from https://github.com/juank115/reverse-engineerskill):\nUser-supplied target: {{target}}\nObjective: {{objective}}\n\nBefore analysis, confirm authorization and scope. Prefer static metadata, hashes, imports, strings, and format identification first; treat heuristics as leads, not proof. Do not execute the target, unpack/run unknown code, evade protections, or access third-party systems. If dynamic work is essential, identify the isolated lab and explicit user approval needed. Report evidence, inference, limitations, and next safe steps separately.' },
      dependencies: [], network_access: false, file_access: false, os_privileges: false, secrets_required: [],
    },
  },
  {
    filename: 'software-architecture-analysis.json',
    manifest: {
      id: 'software-architecture-analysis', version: '1.0.0',
      description: 'Create an evidence-grounded architecture map from supplied code or source analysis. Adapted from https://github.com/magnus919/agent-skills (MIT).',
      input_schema: { type: 'object', properties: { target: { type: 'string', maxLength: 1500 }, evidence: { type: 'string', maxLength: 4096 }, objective: { type: 'string', maxLength: 3000 } }, required: ['target', 'evidence', 'objective'], additionalProperties: false },
      output_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      permissions: [], execution: { method: 'text_template', template: 'Architecture analysis brief (adapted from https://github.com/magnus919/agent-skills):\nTarget: {{target}}\nUser objective: {{objective}}\nSupplied evidence: {{evidence}}\n\nProduce an evidence-grounded map of components, data flow, boundaries, important dependencies, privacy/security-relevant flows, and unknowns. Label each statement as observed evidence, inference, or unverified. Do not invent missing details or treat names/strings as proof of behavior. Recommend clean-room design ideas only at the level requested; do not copy proprietary code or assets. Identify the additional evidence needed to verify uncertain claims.' },
      dependencies: [], network_access: false, file_access: false, os_privileges: false, secrets_required: [],
    },
  },
];
