/** Pure guards for out-of-order chat requests and explicit conversation choices. */
export function initialConversationId(
  conversations: ReadonlyArray<{ id: string }>,
  explicitSelection: boolean,
  activeConversationId: string | null,
): string | null {
  return !explicitSelection && activeConversationId === null ? conversations[0]?.id ?? null : null;
}

export function canApplyConversationMessages(
  requestId: number,
  currentRequestId: number,
  requestedConversationId: string,
  activeConversationId: string | null,
): boolean {
  return requestId === currentRequestId && requestedConversationId === activeConversationId;
}

export function canAttachConversationReply(
  submittedConversationId: string | null,
  responseConversationId: string | null | undefined,
  activeConversationId: string | null,
): boolean {
  return activeConversationId === (responseConversationId ?? submittedConversationId);
}
