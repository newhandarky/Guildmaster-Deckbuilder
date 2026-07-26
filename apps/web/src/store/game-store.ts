import type { GameCommand } from '@guildmaster/game-protocol';
import { create } from 'zustand';
import { LocalGameSession, type SessionUpdate } from '../adapters/local-session/LocalGameSession.js';
import { ruleset } from '../app/ruleset.js';

const session = new LocalGameSession(ruleset);

type GameStore = SessionUpdate & { submit: (command: GameCommand) => void; restart: () => void };

function current(): SessionUpdate { return session.current(); }

export const useGameStore = create<GameStore>((set) => ({
  ...current(),
  submit: (command) => set(session.submit(command)),
  restart: () => set(session.restart())
}));
