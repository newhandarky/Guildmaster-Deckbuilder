import type { SessionPersistenceStatus } from '../../../adapters/game-session.js';
import { sessionPersistenceText } from './persistence-copy.js';

type Props = {
  persistence: SessionPersistenceStatus;
};

export function SessionPersistenceLabel({ persistence }: Props) {
  return <span className={`save-status save-status-${persistence.state}`} data-testid="save-status">
    本機：{sessionPersistenceText(persistence)}
  </span>;
}
