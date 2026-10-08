import { z } from 'zod';

// The persona describes presentation only. Permissions and model routing remain independent.
export const TJPersona = z.object({
  embodiment: z.enum(['core', 'female', 'male']).default('core'),
  name: z.string().trim().min(1).max(32).default('TJ'),
  user_address: z.string().trim().max(32).default(''),
  archetype: z.enum(['warm', 'executive', 'mentor', 'confident']).default('warm'),
  communication: z.enum(['concise', 'balanced', 'detailed']).default('balanced'),
  relationship: z.enum(['professional', 'friendly', 'coach', 'girlfriend', 'boyfriend']).default('friendly'),
  warmth: z.number().int().min(0).max(100).default(70),
  directness: z.number().int().min(0).max(100).default(65),
  humor: z.number().int().min(0).max(100).default(25),
  voice_id: z.string().trim().max(120).nullable().default(null),
  locked: z.boolean().default(true),
});
export type TJPersona = z.infer<typeof TJPersona>;
export const DEFAULT_TJ_PERSONA: TJPersona = TJPersona.parse({});
