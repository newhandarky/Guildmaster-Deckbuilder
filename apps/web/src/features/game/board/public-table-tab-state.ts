/** A public row change is new only when it introduces a card the player has not viewed. */
export function hasUnviewedCardIds(viewed: readonly string[] | undefined, current: readonly string[]): boolean {
  return viewed !== undefined && current.some((cardId) => !viewed.includes(cardId));
}
