/** Keep everyday conversation on a short model path; explicit device tasks use the tool agent. */
export const WAKE = /^\s*(?:hey\s+)?(?:tj|t\s*j|tee\s+jay|ti\s+jee|ٹی\s*جے)(?=$|[\s,.:;!?،؛۔؟-])[\s,.:;!?،؛۔؟-]*/i;

/** A spoken name starts a short natural follow-up window without a button press. */
export class HandsFreeWakeGate {
  private activeUntil = 0;
  constructor(private followUpMs = 60_000) {}
  accepts(text: string, now = Date.now()): boolean {
    if (WAKE.test(text)) { this.activeUntil = now + this.followUpMs; return true; }
    if (now < this.activeUntil) { this.activeUntil = now + this.followUpMs; return true; }
    return false;
  }
  reset() { this.activeUntil = 0; }
}

/** Release a short first voice fragment even when the model delays punctuation. */
export function takeSpeakableChunk(pending: string): string | null {
  const sentence = pending.match(/^[\s\S]*?[.!?۔؟](?=\s|$)/);
  if (sentence && sentence[0].trim().length >= 12) return sentence[0];
  if (pending.length < 90) return null;
  const cutoff = pending.lastIndexOf(' ', 90);
  return cutoff >= 55 ? pending.slice(0, cutoff + 1) : null;
}

export function isComputerIntent(text: string): boolean {
  return /\b(?:open|close|click|type|write|press|scroll|search|read|inspect|screenshot|screen|window|file|folder|browser|website|tab|app|send|email|message|download|upload|save|delete|create|edit|run|execute|install|launch|task|workflow|calendar|schedule|remind|play|pause|volume|settings|copy|paste|find|move|rename|share|post|submit|purchase|buy|login|navigate|switch|computer|desktop|notepad|calculator|document|record|capture)\b|\b(?:khol(?:o|na)?|band\s+karo|likh(?:o|na)?|parh(?:o|na)?|dekho|bhejo|chalao|dhoondo|badlo|hatao|screen|tasveer|screenshot|computer|file|folder|browser|email|message)\b|(?:کھولو|بند کرو|لکھو|پڑھو|دیکھو|بھیجو|چلاؤ|ڈھونڈو|بدلو|ہٹاؤ|اسکرین|کمپیوٹر|فائل|براؤزر|ای میل)/i.test(text);
}

/** Read the focused app's accessibility tree locally, without invoking a model. */
export function isScreenObservationCommand(text: string): boolean {
  return /^(?:what(?:'s| is) (?:on|visible on) (?:the |my )?screen|what do you see(?: on (?:the |my )?screen)?|(?:please )?(?:read|describe|inspect|observe)(?: (?:the|my))? screen|observe|(?:mere |meri )?screen (?:par |pe )?(?:kya (?:hai|likha hai)|dekho|parho)|(?:mere |meri )?screen (?:dekho|parho)|(?:اسکرین|سکرین) (?:پر )?(?:کیا ہے|کیا لکھا ہے|دیکھو|پڑھو))$/i.test(text.trim());
}

/** A separate, explicit request because visual reading sends a screenshot to a model provider. */
export function isVisualScreenCommand(text: string): boolean {
  return /^(?:visually (?:read|describe|inspect) (?:the |my )?screen|read (?:the |my )?screen (?:with|using) vision|use vision to (?:read|describe) (?:the |my )?screen|screen (?:ki tasveer se parho|ka screenshot dekh kar batao)|(?:اسکرین|سکرین) کی تصویر (?:پڑھو|دیکھو))$/i.test(text.trim());
}
