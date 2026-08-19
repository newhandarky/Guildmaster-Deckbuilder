import { useEffect, useRef, useState } from 'react';

type Props = { scopeKey: string; onRestart: () => void };

export function RestartControl({ scopeKey, onRestart }: Props) {
  const [confirming, setConfirming] = useState(false);
  const restartButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setConfirming(false), [scopeKey]);
  useEffect(() => { if (confirming) confirmButtonRef.current?.focus(); }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    window.requestAnimationFrame(() => restartButtonRef.current?.focus());
  };

  return <section className="restart-control" aria-labelledby="restart-control-title" onKeyDown={(event) => {
    if (event.key === 'Escape' && confirming) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }}>
    <h3 id="restart-control-title">對局管理</h3>
    {confirming ? <div className="controls restart-confirmation" role="group" aria-label="確認重新開始">
      <p>重新開始會放棄目前尚未完成的對局。</p>
      <button ref={confirmButtonRef} className="danger" type="button" onClick={() => {
        setConfirming(false);
        onRestart();
      }}>確認重新開始</button>
      <button type="button" onClick={cancel}>繼續目前對局</button>
    </div> : <button ref={restartButtonRef} type="button" onClick={() => setConfirming(true)}>重新開始</button>}
  </section>;
}
