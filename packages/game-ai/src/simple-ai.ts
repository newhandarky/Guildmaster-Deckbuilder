import type { CommandEnvelope, GameCommand, PlayerView } from '@guildmaster/game-protocol';

export type AiStrategy = { id: string; chooseCommand: (view: PlayerView, legalCommands: readonly GameCommand[]) => GameCommand | undefined };

function rank(command: GameCommand): number {
  if (command.type === 'ATTACK_TARGET') return 1;
  if (command.type === 'PLAY_ADVENTURER') return 2;
  if (command.type === 'EQUIP_ITEM') return 3;
  if (command.type === 'USE_ITEM') return 4;
  if (command.type === 'BUY_CARD') return 5;
  if (command.type === 'SELECT_BONDS') return 0;
  if (command.type === 'REFRESH_MARKET') return 6;
  return 99;
}

export const simpleAiStrategy: AiStrategy = {
  id: 'ai:simple-v1',
  chooseCommand: (view, legalCommands) => {
    void view;
    return [...legalCommands].sort((left, right) => rank(left) - rank(right))[0];
  }
};

export function asEnvelope(view: PlayerView, actorId: string, command: GameCommand, commandId = `ai-${view.revision + 1}-${command.type.toLowerCase()}`): CommandEnvelope {
  return { protocolVersion: 1, gameId: view.gameId, commandId, actorId, expectedRevision: view.revision, command };
}
