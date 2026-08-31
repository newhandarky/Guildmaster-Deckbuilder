import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type UtilityDrawerSection = {
  id: 'events' | 'zones' | 'cpu' | 'more';
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
  const [closingId, setClosingId] = useState<UtilityDrawerSection['id']>();
  const triggerRefs = useRef(new Map<UtilityDrawerSection['id'], HTMLButtonElement>());
  const drawerRefs = useRef(new Map<UtilityDrawerSection['id'], HTMLElement>());
  const closingAnimationRef = useRef<Animation>();
  const closingGenerationRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    if (!openId) return;
    const closing = openId;
    const generation = ++closingGenerationRef.current;
    const trigger = triggerRefs.current.get(closing);
    setOpenId(undefined);
    const complete = () => {
      if (generation !== closingGenerationRef.current) return;
      setClosingId((current) => current === closing ? undefined : current);
      window.requestAnimationFrame(() => trigger?.focus());
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      complete();
      return;
    }
    setClosingId(closing);
    window.requestAnimationFrame(() => {
      const drawer = drawerRefs.current.get(closing);
      const mobile = window.matchMedia('(max-width: 767px)').matches;
      const animation = drawer?.animate(
        [{ transform: 'translate3d(0, 0, 0)', opacity: 1 }, { transform: mobile ? 'translate3d(0, 1.5rem, 0)' : 'translate3d(1.5rem, 0, 0)', opacity: 0 }],
        { duration: 180, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' },
      );
      if (!animation) complete();
      else {
        closingAnimationRef.current = animation;
        const settle = () => {
          animation.cancel();
          if (closingAnimationRef.current === animation) closingAnimationRef.current = undefined;
          complete();
        };
        void animation.finished.then(settle, settle);
      }
    });
  }, [openId]);

  const open = useCallback((sectionId: UtilityDrawerSection['id']) => {
    closingGenerationRef.current += 1;
    closingAnimationRef.current?.cancel();
    closingAnimationRef.current = undefined;
    setClosingId(undefined);
    setOpenId(sectionId);
  }, []);

  useEffect(() => {
    if (suspended) {
      closingGenerationRef.current += 1;
      closingAnimationRef.current?.cancel();
      closingAnimationRef.current = undefined;
      setOpenId(undefined);
      setClosingId(undefined);
      return;
    }
    if (!autoOpenId) return;
    open(autoOpenId);
  }, [autoOpenId, open, suspended]);

  useEffect(() => () => closingAnimationRef.current?.cancel(), []);

  useEffect(() => {
    if (openId) closeButtonRef.current?.focus();
  }, [openId]);

  useEffect(() => {
    if (!openId) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      // A card inspection opened from this drawer is a native modal above it.
      // Do not cancel the browser's Escape -> dialog cancel default action.
      if (event.key !== 'Escape' || event.defaultPrevented
        || event.target instanceof Element && event.target.closest('dialog[open]')) return;
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
        onClick={() => openId === section.id ? close() : open(section.id)}
      >{section.label}</button>)}
    </div>
    {sections.map((section) => {
      const open = openId === section.id;
      const closing = closingId === section.id;
      const visible = open || closing;
      return <aside
        ref={(node) => {
          if (node) drawerRefs.current.set(section.id, node);
          else drawerRefs.current.delete(section.id);
        }}
        key={section.id}
        id={`utility-drawer-${section.id}`}
        className="utility-drawer"
        data-testid={open ? 'utility-drawer' : undefined}
        data-closing={closing ? 'true' : undefined}
        role={visible ? 'dialog' : undefined}
        aria-modal={visible ? 'false' : undefined}
        aria-labelledby={`utility-drawer-title-${section.id}`}
        hidden={!visible}
      >
        <header className="utility-drawer__header">
          <h2 id={`utility-drawer-title-${section.id}`}>{section.label}</h2>
          <button ref={open ? closeButtonRef : undefined} type="button" className="icon-button" aria-label={`關閉${section.label}`} disabled={closing} onClick={close}>×</button>
        </header>
        <div className="utility-drawer__body">{section.content}</div>
      </aside>;
    })}
  </div>;
}
