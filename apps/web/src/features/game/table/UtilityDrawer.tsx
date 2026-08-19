import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type UtilityDrawerSection = {
  id: 'events' | 'cpu' | 'more';
  label: string;
  content: ReactNode;
};

type Props = {
  sections: readonly UtilityDrawerSection[];
  autoOpenId?: UtilityDrawerSection['id'] | undefined;
  suspended?: boolean;
};

export function UtilityDrawer({ sections, autoOpenId, suspended = false }: Props) {
  const [openId, setOpenId] = useState<UtilityDrawerSection['id']>();
  const triggerRefs = useRef(new Map<UtilityDrawerSection['id'], HTMLButtonElement>());
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    const trigger = openId ? triggerRefs.current.get(openId) : undefined;
    setOpenId(undefined);
    window.requestAnimationFrame(() => trigger?.focus());
  }, [openId]);

  useEffect(() => {
    if (suspended) {
      setOpenId(undefined);
      return;
    }
    if (!autoOpenId) return;
    setOpenId(autoOpenId);
  }, [autoOpenId, suspended]);

  useEffect(() => {
    if (openId) closeButtonRef.current?.focus();
  }, [openId]);

  useEffect(() => {
    if (!openId) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [close, openId]);

  return <div className="utility-tools" data-testid="utility-tools">
    <div className="utility-launcher" aria-label="次要工具">
      {sections.map((section) => <button
        key={section.id}
        ref={(node) => {
          if (node) triggerRefs.current.set(section.id, node);
          else triggerRefs.current.delete(section.id);
        }}
        type="button"
        disabled={suspended}
        aria-expanded={openId === section.id}
        aria-controls={`utility-drawer-${section.id}`}
        onClick={() => setOpenId((current) => current === section.id ? undefined : section.id)}
      >{section.label}</button>)}
    </div>
    {sections.map((section) => {
      const open = openId === section.id;
      return <aside
        key={section.id}
        id={`utility-drawer-${section.id}`}
        className="utility-drawer"
        data-testid={open ? 'utility-drawer' : undefined}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? 'false' : undefined}
        aria-labelledby={`utility-drawer-title-${section.id}`}
        hidden={!open}
      >
        <header className="utility-drawer__header">
          <h2 id={`utility-drawer-title-${section.id}`}>{section.label}</h2>
          <button ref={open ? closeButtonRef : undefined} type="button" className="icon-button" aria-label={`關閉${section.label}`} onClick={close}>×</button>
        </header>
        <div className="utility-drawer__body">{section.content}</div>
      </aside>;
    })}
  </div>;
}
