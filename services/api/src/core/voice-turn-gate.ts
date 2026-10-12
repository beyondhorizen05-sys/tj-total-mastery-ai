/** Supersedes stale microphone turns when the user barges in or ends a session. */
export class VoiceTurnGate {
  private generation = 0;

  begin(): number { return ++this.generation; }
  invalidate(): void { this.generation++; }
  isCurrent(generation: number): boolean { return generation === this.generation; }
}
