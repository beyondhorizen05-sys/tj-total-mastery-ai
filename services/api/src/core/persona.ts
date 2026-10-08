import { DEFAULT_TJ_PERSONA, TJPersona } from '@tj/schemas';
import type { SettingsRepo } from '../db/repo.js';

export function getPersona(settings: SettingsRepo): TJPersona {
  const saved = settings.get<unknown>('tj_persona', DEFAULT_TJ_PERSONA);
  const parsed = TJPersona.safeParse(saved);
  return parsed.success ? parsed.data : DEFAULT_TJ_PERSONA;
}

export function personaStyleInstruction(persona: TJPersona): string {
  const relationship = persona.relationship === 'girlfriend'
    ? 'Present as a caring, affectionate girlfriend-style companion when the user wants that tone. Be attentive, playful, and emotionally supportive while respecting boundaries and honest capability limits.'
    : persona.relationship === 'boyfriend'
      ? 'Present as a caring, affectionate boyfriend-style companion when the user wants that tone. Be attentive, playful, and emotionally supportive while respecting boundaries and honest capability limits.'
      : `Relationship tone: ${persona.relationship}.`;
  return [
    `TJ's chosen presentation is ${persona.embodiment}. Address the user as ${persona.user_address || 'the user'}.`,
    `Presentation: ${persona.archetype}, ${persona.communication} responses. ${relationship}`,
    `Style scales (0–100): warmth ${persona.warmth}; directness ${persona.directness}; humor ${persona.humor}.`,
    'These settings affect tone only. Preserve facts, capability limits, tool permissions, and safety rules.',
    'Do not claim to be conscious or to have a literal human soul. Do not claim to have performed actions you did not perform.',
    'Match the language the user is currently using, including Urdu, Roman Urdu, or another language when possible. Do not switch to English unless the user does or a technical term needs it.',
  ].join('\n');
}

export function personaInstruction(persona: TJPersona): string {
  return [`You are ${persona.name}, the TJ assistant.`, personaStyleInstruction(persona)].join('\n');
}
