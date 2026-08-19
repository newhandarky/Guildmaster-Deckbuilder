import type { ReactNode } from 'react';

export type CardIconKey =
  | 'profession-melee'
  | 'profession-tank'
  | 'profession-ranged'
  | 'profession-mage'
  | 'profession-support'
  | 'card-type-starter'
  | 'card-type-item'
  | 'card-type-equipment'
  | 'card-type-enemy'
  | 'card-type-boss'
  | 'card-type-helper'
  | 'card-type-bond'
  | 'card-type-standard'
  | 'metric-combat'
  | 'metric-purchase'
  | 'metric-honor-star';

function iconPaths(iconKey: CardIconKey): ReactNode {
  switch (iconKey) {
    case 'profession-melee':
      return <><path d="m5 4 14 16M19 4 5 20" /><path d="m4 4 4 1-3 3-1-4Zm16 0-4 1 3 3 1-4ZM4 20l4-1-3-3-1 4Zm16 0-4-1 3-3 1 4Z" /></>;
    case 'profession-tank':
      return <><path d="M12 2.7 20 6v5.2c0 5-3.2 8.4-8 10.1-4.8-1.7-8-5.1-8-10.1V6l8-3.3Z" /><path d="M12 7v9M8.5 11.5h7" /></>;
    case 'profession-ranged':
      return <><path d="M7 3c5 4.8 5 13.2 0 18M7 3c-4 5-4 13 0 18M5 12h14" /><path d="m16 9 3 3-3 3" /></>;
    case 'profession-mage':
      return <><path d="m12 2 2.1 6.2L20 5l-3.2 5.9L23 13l-6.2 2.1L20 21l-5.9-3.2L12 24l-2.1-6.2L4 21l3.2-5.9L1 13l6.2-2.1L4 5l5.9 3.2L12 2Z" /><circle cx="12" cy="13" r="2.8" /></>;
    case 'profession-support':
      return <><path d="M12 20s-6.5-3.8-6.5-9.2A3.8 3.8 0 0 1 12 8.2a3.8 3.8 0 0 1 6.5 2.6C18.5 16.2 12 20 12 20Z" /><path d="M6.5 9.5 2 7v5l4 2m11.5-4.5L22 7v5l-4 2" /></>;
    case 'card-type-starter':
      return <><path d="m12 2 2.1 6.2L20 10l-5.9 2.1L12 19l-2.1-6.9L4 10l5.9-1.8L12 2Z" /><path d="M5 17h4m6 0h4" /></>;
    case 'card-type-item':
      return <><path d="M9 3h6M10 3v5l-4 7.3A3.8 3.8 0 0 0 9.3 21h5.4a3.8 3.8 0 0 0 3.3-5.7L14 8V3" /><path d="M7.8 14h8.4" /></>;
    case 'card-type-equipment':
      return <><path d="M4 13V9a8 8 0 0 1 16 0v4" /><path d="M3 13h18v5H3zM8 13V9m8 4V9" /></>;
    case 'card-type-enemy':
      return <><path d="M4 4c0 6 3 8 8 8S20 10 20 4M6 20c1-5 3-8 6-8s5 3 6 8" /><path d="m7 8-3 4m13-4 3 4M9 17h6" /></>;
    case 'card-type-boss':
      return <><path d="m3 7 5 4 4-7 4 7 5-4-2 12H5L3 7Z" /><path d="M6 16h12" /></>;
    case 'card-type-helper':
      return <><path d="M12 3 20 7v5c0 4.5-3.2 7.5-8 9-4.8-1.5-8-4.5-8-9V7l8-4Z" /><path d="M8 13h8M12 8v9" /></>;
    case 'card-type-bond':
      return <><circle cx="8.5" cy="12" r="5" /><circle cx="15.5" cy="12" r="5" /><path d="M10.5 8.5h3M10.5 15.5h3" /></>;
    case 'metric-combat':
      return <><path d="m5 20 3-3M8 17 19 6l-1-3-3-1L4 13l4 4Z" /><path d="M12 17c2.8 2.5 5.5 3.8 8 4v-6.5c-1.5-.2-2.9-.8-4-1.8" /></>;
    case 'metric-purchase':
      return <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5.5" /><path d="M9.5 12h5M12 9.5v5" /></>;
    case 'metric-honor-star':
      return <path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z" />;
    case 'card-type-standard':
      return <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>;
  }
}

export function CardIcon({ iconKey, className }: { iconKey: CardIconKey; className?: string }) {
  return <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    focusable="false"
    aria-hidden="true"
  >
    {iconPaths(iconKey)}
  </svg>;
}
