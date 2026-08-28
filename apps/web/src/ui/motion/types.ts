import type { DomainEvent, PlayerView } from '@guildmaster/game-protocol';

export type PresentationTransitionBatch = {
  batchId: string;
  gameId: string;
  fromRevision: number;
  toRevision: number;
  source: 'human' | 'cpu';
  events: readonly DomainEvent[];
  before: PlayerView;
  after: PlayerView;
};

export type PublicCardProjection = ReadonlyMap<string, string>;

export type CardZoneTransition = {
  cardId: string;
  from?: string;
  to?: string;
  kind: 'enter' | 'move' | 'leave';
};
