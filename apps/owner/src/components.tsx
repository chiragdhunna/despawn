import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  testId?: string;
  full?: boolean;
  type?: 'button' | 'submit';
}) {
  const cls = `btn ${props.kind ?? 'secondary'} notch${props.full === true ? ' full' : ''}`;
  return (
    <button
      type={props.type ?? 'button'}
      className={cls}
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testId}
    >
      {props.children}
    </button>
  );
}

/** Press and hold for `ms` to confirm. Releasing early cancels. Also works with Space and Enter. */
export function HoldButton(props: {
  label: string;
  onDone: () => void;
  ms?: number;
  testId?: string;
}) {
  const ms = props.ms ?? 1000;
  const [p, setP] = useState(0);
  const raf = useRef(0);
  const start = useRef(0);
  const done = useRef(false);
  const onDone = useRef(props.onDone);
  onDone.current = props.onDone;

  const stop = (): void => {
    cancelAnimationFrame(raf.current);
    start.current = 0;
    setP(0);
  };
  const tick = (now: number): void => {
    if (start.current === 0) return;
    const f = Math.min(1, (now - start.current) / ms);
    setP(f);
    if (f >= 1) {
      start.current = 0;
      done.current = true;
      onDone.current();
    } else {
      raf.current = requestAnimationFrame(tick);
    }
  };
  const begin = (): void => {
    if (done.current || start.current !== 0) return;
    start.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <button
      type="button"
      className="btn primary notch hold"
      data-testid={props.testId}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) begin();
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stop();
      }}
    >
      <span className="hold-fill" style={{ width: `${p * 100}%` }} aria-hidden="true" />
      <span className="hold-label">{props.label}</span>
    </button>
  );
}

export function LifeBar({ remainingMs, totalMs }: { remainingMs: number | null; totalMs: number }) {
  const SEG = 20;
  const on =
    remainingMs === null
      ? SEG
      : Math.max(0, Math.min(SEG, Math.ceil((remainingMs / totalMs) * SEG)));
  const segs = [];
  for (let i = 0; i < SEG; i++) {
    segs.push(<span key={i} className={i < on ? (on <= 5 ? 'seg on low' : 'seg on') : 'seg'} />);
  }
  const s = remainingMs === null ? 0 : Math.ceil(remainingMs / 1000);
  return (
    <div
      className="life"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={totalMs}
      aria-valuenow={remainingMs ?? 0}
    >
      <div className="lifebar">{segs}</div>
      <span className="num life-time">
        {remainingMs === null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}
      </span>
    </div>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div className="seg-group" role="radiogroup" aria-label={props.name}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'chip on' : 'chip'}
          data-testid={`${props.name}-${String(o.value)}`}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  onText: string;
  offText: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.value}
      className="toggle"
      data-testid={props.testId}
      onClick={() => props.onChange(!props.value)}
    >
      <span>{props.label}</span>
      <span className={props.value ? 'toggle-state on' : 'toggle-state'}>
        {props.value ? props.onText : props.offText}
      </span>
    </button>
  );
}

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{props.label}</div>
      {props.children}
    </div>
  );
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
