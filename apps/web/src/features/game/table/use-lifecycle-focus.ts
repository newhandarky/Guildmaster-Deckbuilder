import { useEffect, useRef, type RefObject } from 'react';

export function useLifecycleFocus(
  pending: boolean,
  interactionKey: string,
  headingRef: RefObject<HTMLHeadingElement | null>,
  fallbackRef: RefObject<HTMLParagraphElement | null>,
): void {
  const priorPendingRef = useRef<string>();

  useEffect(() => {
    const previous = priorPendingRef.current;
    priorPendingRef.current = pending ? interactionKey : undefined;
    if (pending && previous !== interactionKey) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => headingRef.current?.focus());
        });
      });
      return;
    }
    if (previous && !pending) {
      window.requestAnimationFrame(() => fallbackRef.current?.focus());
    }
  }, [fallbackRef, headingRef, interactionKey, pending]);
}
