import type { SessionPersistenceStatus } from '../../../adapters/game-session.js';

type Props = {
  persistence: SessionPersistenceStatus;
};

const persistenceCopy: Record<SessionPersistenceStatus['state'], string> = {
  fresh: '新對局 · 尚未保存',
  restored: '已恢復本機進度',
  saved: '已保存',
  'memory-only': '僅保留在此分頁',
};

export function SessionPersistenceLabel({ persistence }: Props) {
  return <span className={`save-status save-status-${persistence.state}`} data-testid="save-status">
    本機：{persistenceCopy[persistence.state]}
  </span>;
}
