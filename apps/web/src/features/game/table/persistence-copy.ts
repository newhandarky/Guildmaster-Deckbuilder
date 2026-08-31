import type { SessionPersistenceStatus } from '../../../adapters/game-session.js';

const persistenceCopy: Record<SessionPersistenceStatus['state'], string> = {
  fresh: '新對局 · 尚未保存',
  restored: '已恢復本機進度',
  saving: '儲存中',
  saved: '已保存',
  'memory-only': '僅保留在此分頁',
};

export function sessionPersistenceText(persistence: SessionPersistenceStatus): string {
  return persistenceCopy[persistence.state];
}
