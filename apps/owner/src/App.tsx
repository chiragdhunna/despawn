import {
  PURPOSES,
  type ColorMode,
  type LayoutKind,
  type PaperSize,
  type StampStyle,
} from '@despawn/compose';
import { DEFAULT_RULES, type Rules } from '@despawn/protocol';
import { RenderError, openSource, type RenderErrorCode, type Source } from '@despawn/render';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button, Field, HoldButton, LifeBar, Segmented, Toggle, useNow } from './components.js';
import { translate, type Key } from './i18n.js';
import {
  buildSheets,
  defaultOptions,
  makeRef,
  renderPreview,
  validateSelection,
  type PrepareOptions,
} from './pipeline.js';
import { Qr } from './qr.js';
import { OwnerSession, type LiveState } from './session.js';
import {
  addReceipt,
  clearReceipts,
  loadReceipts,
  loadSettings,
  saveSettings,
  type Lang,
  type Receipt,
  type Settings,
  type Theme,
} from './store.js';
import logoMark from '../../../assets/logo/logo-dark.svg';

interface Job {
  source: Source;
  ref: string;
  options: PrepareOptions;
  pageCount: number;
}

type View =
  | { v: 'home' }
  | { v: 'import'; file: File; password?: string; wrong?: boolean; ask?: boolean }
  | { v: 'importError'; code: RenderErrorCode }
  | { v: 'prepare'; job: Job }
  | { v: 'rules'; job: Job }
  | { v: 'session'; job: Job; rules: Rules }
  | { v: 'history' }
  | { v: 'settings' };

interface Ctx {
  settings: Settings;
  setSettings: (s: Settings) => void;
  tr: (k: Key) => string;
}
const AppCtx = createContext<Ctx | null>(null);
function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (c === null) throw new Error('no context');
  return c;
}

function buzz(settings: Settings, pattern: number | number[]): void {
  if (settings.haptics && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

function Shell(props: {
  title?: string;
  step?: string;
  onBack?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  children: ReactNode;
}) {
  const { tr } = useApp();
  return (
    <div className="app">
      <header className="bar">
        {props.onBack !== undefined ? (
          <button type="button" className="icon" onClick={props.onBack} aria-label={tr('nav.back')}>
            ‹
          </button>
        ) : (
          <img className="logo" src={logoMark} alt="Despawn" height={26} />
        )}
        <div className="bar-title">{props.title ?? ''}</div>
        {props.step !== undefined ? <span className="muted num">{props.step}</span> : null}
        {props.onSettings !== undefined ? (
          <button
            type="button"
            className="icon"
            onClick={props.onSettings}
            aria-label={tr('nav.settings')}
            data-testid="open-settings"
          >
            ⚙
          </button>
        ) : null}
      </header>
      <main className="screen">{props.children}</main>
    </div>
  );
}

// ---------------- Home ----------------
function Home(props: { receipts: Receipt[]; onFile: (f: File) => void; go: (v: View) => void }) {
  const { tr } = useApp();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Shell onSettings={() => props.go({ v: 'settings' })}>
      <input
        ref={input}
        type="file"
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f !== undefined) props.onFile(f);
        }}
      />
      <button
        type="button"
        className="dropzone notch"
        onClick={() => input.current?.click()}
        data-testid="new-job"
      >
        <span className="dz-title">+ {tr('home.new')}</span>
        <span className="muted">{tr('home.newHint')}</span>
      </button>
      <h2 className="h2">{tr('home.recent')}</h2>
      {props.receipts.length === 0 ? (
        <p className="muted">{tr('home.empty')}</p>
      ) : (
        <ul className="list">
          {props.receipts.slice(0, 3).map((r) => (
            <ReceiptRow key={r.ref} r={r} />
          ))}
        </ul>
      )}
      {props.receipts.length > 3 ? (
        <Button kind="ghost" onClick={() => props.go({ v: 'history' })}>
          {tr('home.history')}
        </Button>
      ) : null}
      <p className="muted small">{tr('home.tip')}</p>
    </Shell>
  );
}

function ReceiptRow({ r }: { r: Receipt }) {
  const { tr, settings } = useApp();
  const reason = translate(settings.lang, `reason.${r.reason}` as Key);
  return (
    <li className="card notch">
      <div className="row between">
        <strong>{r.purpose}</strong>
        <span className="muted num">{new Date(r.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="muted small">
        {tr('receipt.pages')}: {r.printsDone}, {reason ?? r.reason}
      </div>
    </li>
  );
}

// ---------------- Import ----------------
function ImportScreen(props: {
  view: Extract<View, { v: 'import' }>;
  settings: Settings;
  onDone: (j: Job) => void;
  onFail: (c: RenderErrorCode) => void;
  onAsk: (wrong: boolean) => void;
  onBack: () => void;
  onPassword: (pw: string) => void;
}) {
  const { tr } = useApp();
  const [pw, setPw] = useState('');
  const { file, password, ask, wrong } = props.view;
  useEffect(() => {
    if (ask === true) return;
    let cancelled = false;
    (async () => {
      try {
        const source = await openSource(file, password === undefined ? {} : { password });
        if (cancelled) {
          source.destroy();
          return;
        }
        const first = await source.renderPage(0, 40);
        const landscape = first.width > first.height;
        first.canvas.width = 0;
        props.onDone({
          source,
          ref: makeRef(),
          pageCount: source.pageCount,
          options: defaultOptions(source.pageCount, landscape, props.settings.defaultPurpose),
        });
      } catch (e) {
        if (cancelled) return;
        if (
          e instanceof RenderError &&
          (e.code === 'PASSWORD_REQUIRED' || e.code === 'PASSWORD_INCORRECT')
        ) {
          props.onAsk(e.code === 'PASSWORD_INCORRECT');
        } else {
          props.onFail(e instanceof RenderError ? e.code : 'CORRUPT');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, password, ask]);
  return (
    <Shell title={tr('prepare.title')} step={`1 ${tr('step.of')} 4`} onBack={props.onBack}>
      {ask === true ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onPassword(pw);
          }}
        >
          <p>{tr('import.password')}</p>
          {wrong === true ? <p className="warn">{tr('import.passwordWrong')}</p> : null}
          <Field label={tr('import.passwordLabel')}>
            <input
              className="input"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
              data-testid="pdf-password"
            />
          </Field>
          <p className="muted small">{tr('import.passwordNote')}</p>
          <Button kind="primary" type="submit" full testId="pdf-password-go">
            {tr('import.open')}
          </Button>
        </form>
      ) : (
        <p aria-live="polite">{tr('import.opening')}…</p>
      )}
    </Shell>
  );
}

function ImportError({ code, onBack }: { code: RenderErrorCode; onBack: () => void }) {
  const { tr } = useApp();
  const msg: Record<RenderErrorCode, Key> = {
    UNSUPPORTED: 'import.unsupported',
    TOO_LARGE: 'import.tooLarge',
    TOO_MANY_PAGES: 'import.tooManyPages',
    CORRUPT: 'import.corrupt',
    PASSWORD_REQUIRED: 'import.corrupt',
    PASSWORD_INCORRECT: 'import.corrupt',
  };
  return (
    <Shell onBack={onBack}>
      <p data-testid="import-error">{tr(msg[code])}</p>
      {code === 'UNSUPPORTED' ? <p className="muted">{tr('import.unsupportedHelp')}</p> : null}
      <Button kind="primary" onClick={onBack} full>
        {tr('import.another')}
      </Button>
    </Shell>
  );
}

// ---------------- Prepare ----------------
function Prepare(props: {
  job: Job;
  settings: Settings;
  onChange: (o: PrepareOptions) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { tr } = useApp();
  const o = props.job.options;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const optKey = JSON.stringify(o);
  const [customPurpose, setCustomPurpose] = useState(
    !(PURPOSES as readonly string[]).includes(o.purpose),
  );
  const set = <K extends keyof PrepareOptions>(k: K, v: PrepareOptions[K]): void =>
    props.onChange({ ...o, [k]: v });

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      setBusy(true);
      try {
        const c = await renderPreview(props.job.source, o, props.job.ref);
        const target = canvas.current;
        if (cancelled || c === null || target === null) {
          if (c !== null) c.width = 0;
          return;
        }
        target.width = c.width;
        target.height = c.height;
        target.getContext('2d')?.drawImage(c, 0, 0);
        c.width = 0;
        target.dataset.ready = String(Date.now());
      } catch {
        // preview failures are not fatal; Continue still re-renders at full quality
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [optKey]);

  const sel = validateSelection(o);
  const selMsg =
    sel === 'EMPTY'
      ? tr('prepare.empty')
      : sel === 'TOO_MANY_SHEETS'
        ? tr('prepare.tooMany')
        : sel === 'TOO_MANY_CARDS'
          ? tr('prepare.tooManyCards')
          : null;
  const purposeValue = customPurpose ? '__custom' : o.purpose;
  return (
    <Shell title={tr('prepare.title')} step={`2 ${tr('step.of')} 4`} onBack={props.onBack}>
      <div className="preview notch" aria-busy={busy}>
        <canvas ref={canvas} data-testid="preview" aria-label={tr('prepare.preview')} />
      </div>
      <p className="muted small">{tr('prepare.preview')}</p>

      <Field label={tr('prepare.layout')}>
        <Segmented<LayoutKind>
          name="layout"
          value={o.layout}
          onChange={(v) =>
            props.onChange({ ...o, layout: v, landscape: v === 'idcard' ? false : o.landscape })
          }
          options={[
            { value: 'full', label: tr('prepare.layoutFull') },
            { value: 'fit', label: tr('prepare.layoutFit') },
            { value: 'idcard', label: tr('prepare.layoutCard') },
          ]}
        />
      </Field>
      {o.layout === 'idcard' ? <p className="muted small">{tr('prepare.cardNote')}</p> : null}
      <Field label={tr('prepare.paper')}>
        <Segmented<PaperSize>
          name="paper"
          value={o.paper}
          onChange={(v) => set('paper', v)}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'A5', label: 'A5' },
            { value: 'Letter', label: 'Letter' },
          ]}
        />
      </Field>
      <Toggle
        label={tr('prepare.landscape')}
        value={o.landscape}
        onChange={(v) => set('landscape', v)}
        onText={tr('rules.on')}
        offText={tr('rules.off')}
        testId="landscape"
      />
      <Toggle
        label={tr('prepare.crop')}
        value={o.autoCrop || o.layout === 'idcard'}
        onChange={(v) => set('autoCrop', v)}
        onText={tr('rules.on')}
        offText={tr('rules.off')}
        testId="crop"
      />
      <Field label={tr('prepare.colour')}>
        <Segmented<ColorMode>
          name="mode"
          value={o.mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: 'color', label: tr('prepare.colourColor') },
            { value: 'gray', label: tr('prepare.colourGray') },
            { value: 'bw', label: tr('prepare.colourBw') },
          ]}
        />
      </Field>
      <Field label={tr('prepare.purpose')}>
        <select
          className="input"
          value={purposeValue}
          data-testid="purpose"
          onChange={(e) => {
            if (e.target.value === '__custom') {
              setCustomPurpose(true);
            } else {
              setCustomPurpose(false);
              set('purpose', e.target.value);
            }
          }}
        >
          {PURPOSES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="__custom">{tr('prepare.purposeCustom')}</option>
        </select>
        {customPurpose ? (
          <input
            className="input"
            maxLength={60}
            value={o.purpose}
            onChange={(e) => set('purpose', e.target.value)}
            data-testid="purpose-custom"
          />
        ) : null}
      </Field>
      <Field label={tr('prepare.stamp')}>
        <Segmented<StampStyle>
          name="style"
          value={o.style}
          onChange={(v) => set('style', v)}
          options={[
            { value: 'watermark', label: tr('prepare.stampMark') },
            { value: 'selfattested', label: tr('prepare.stampSelf') },
          ]}
        />
      </Field>
      <Field label={tr('prepare.density')}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={o.density}
          onChange={(e) => set('density', Number(e.target.value))}
          aria-label={tr('prepare.density')}
        />
      </Field>
      <Field label={tr('prepare.opacity')}>
        <input
          type="range"
          min={0.05}
          max={0.5}
          step={0.01}
          value={o.opacity}
          onChange={(e) => set('opacity', Number(e.target.value))}
          aria-label={tr('prepare.opacity')}
        />
      </Field>
      {props.job.pageCount > 1 ? (
        <Field label={tr('prepare.pages')}>
          <div className="seg-group">
            {o.include.map((on, i) => (
              <button
                key={i}
                type="button"
                role="checkbox"
                aria-checked={on}
                className={on ? 'chip on' : 'chip'}
                onClick={() =>
                  set(
                    'include',
                    o.include.map((x, j) => (j === i ? !x : x)),
                  )
                }
              >
                {tr('prepare.page')} {i + 1}
              </button>
            ))}
          </div>
        </Field>
      ) : null}
      {selMsg !== null ? <p className="warn">{selMsg}</p> : null}
      <div className="sticky">
        <Button
          kind="primary"
          full
          disabled={sel !== 'OK' || o.purpose.trim() === ''}
          onClick={props.onNext}
          testId="prepare-continue"
        >
          {tr('prepare.continue')}
        </Button>
      </div>
    </Shell>
  );
}

// ---------------- Rules ----------------
function RulesScreen(props: {
  settings: Settings;
  rules: Rules;
  onChange: (r: Rules) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { tr } = useApp();
  const r = props.rules;
  const min = tr('unit.min');
  const hour = tr('unit.hour');
  return (
    <Shell title={tr('rules.title')} step={`3 ${tr('step.of')} 4`} onBack={props.onBack}>
      <Field label={tr('rules.link')}>
        <Segmented<number>
          name="link"
          value={r.linkTtlMs}
          onChange={(v) => props.onChange({ ...r, linkTtlMs: v })}
          options={[
            { value: 300_000, label: `5 ${min}` },
            { value: 1_800_000, label: `30 ${min}` },
            { value: 7_200_000, label: `2 ${hour}` },
            { value: 86_400_000, label: `24 ${hour}` },
          ]}
        />
      </Field>
      <Field label={tr('rules.live')}>
        <Segmented<number>
          name="live"
          value={r.liveTtlMs}
          onChange={(v) => props.onChange({ ...r, liveTtlMs: v })}
          options={[
            { value: 60_000, label: `1 ${min}` },
            { value: 120_000, label: `2 ${min}` },
            { value: 300_000, label: `5 ${min}` },
          ]}
        />
      </Field>
      <Field label={tr('rules.prints')}>
        <Segmented<number>
          name="prints"
          value={r.printLimit}
          onChange={(v) => props.onChange({ ...r, printLimit: v })}
          options={[
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
          ]}
        />
      </Field>
      <Toggle
        label={tr('rules.destroy')}
        value={r.destroyAfterPrint}
        onChange={(v) => props.onChange({ ...r, destroyAfterPrint: v })}
        onText={tr('rules.on')}
        offText={tr('rules.off')}
        testId="destroy-after"
      />
      <div className="sticky">
        <Button kind="primary" full onClick={props.onNext} testId="rules-lock">
          {tr('rules.lock')}
        </Button>
      </div>
    </Shell>
  );
}

// ---------------- Session ----------------
type Stage = { s: 'building'; done: number; total: number } | { s: 'running' };

function SessionScreen(props: {
  job: Job;
  rules: Rules;
  settings: Settings;
  onExit: () => void;
  onReceipt: (r: Receipt) => void;
}) {
  const { tr, settings } = useApp();
  const [stage, setStage] = useState<Stage>({ s: 'building', done: 0, total: 1 });
  const [live, setLive] = useState<LiveState | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const session = useRef<OwnerSession | null>(null);
  const createdAt = useRef(Date.now());
  const savedReceipt = useRef(false);
  const now = useNow(250);

  useEffect(() => {
    let cancelled = false;
    createdAt.current = Date.now();
    savedReceipt.current = false;
    const s = new OwnerSession(window.location.origin, (st) => {
      if (!cancelled) setLive(st);
    });
    session.current = s;
    (async () => {
      try {
        const built = await buildSheets(
          props.job.source,
          props.job.options,
          props.job.ref,
          (done, total) => {
            if (!cancelled) setStage({ s: 'building', done, total });
          },
        );
        if (cancelled) return;
        setStage({ s: 'running' });
        await s.start({ pages: built.pages, manifest: built.manifest, rules: props.rules });
      } catch {
        if (!cancelled)
          setLive((l) => ({ ...(l ?? EMPTY_LIVE), phase: 'error', error: 'NETWORK' }));
        if (!cancelled) setStage({ s: 'running' });
      }
    })();
    return () => {
      cancelled = true;
      s.dispose();
    };
  }, [attempt]);

  // keep the screen on while a session is active
  const active = live !== null && (live.phase === 'armed' || live.phase === 'live');
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = (): void => {
      navigator.wakeLock.request('screen').then(
        (l) => {
          lock = l;
        },
        () => undefined,
      );
    };
    acquire();
    const vis = (): void => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      void lock?.release();
    };
  }, [active]);

  useEffect(() => {
    if (live?.phase === 'ended' && live.destroyed !== null && !savedReceipt.current) {
      savedReceipt.current = true;
      buzz(settings, [40, 40, 40]);
      props.onReceipt({
        ref: props.job.ref,
        purpose: props.job.options.purpose,
        createdAt: createdAt.current,
        endedAt: live.destroyed.at,
        reason: live.destroyed.reason,
        printsDone: live.destroyed.printsDone,
        shopReportedWipe: live.destroyed.shopReportedWipe,
      });
    }
  }, [live, props, settings]);

  const remaining =
    live?.remainingMs === null || live === null
      ? null
      : Math.max(0, (live.remainingMs ?? 0) - (now - live.receivedAt));

  if (stage.s === 'building') {
    return (
      <Shell title={tr('session.title')} step={`4 ${tr('step.of')} 4`}>
        <h2 className="h2">{tr('session.building')}</h2>
        <progress className="progress" max={stage.total} value={stage.done} />
        <p className="muted num">
          {stage.done} / {stage.total}
        </p>
      </Shell>
    );
  }
  if (live === null || live.phase === 'creating' || live.phase === 'uploading') {
    return (
      <Shell title={tr('session.title')} step={`4 ${tr('step.of')} 4`}>
        <h2 className="h2">
          {live?.phase === 'uploading' ? tr('session.uploading') : tr('session.encrypting')}
        </h2>
        <progress className="progress" />
        <p className="muted">{tr('session.lockedNote')}</p>
      </Shell>
    );
  }
  if (live.phase === 'error') {
    const key = `session.error${live.error ?? 'NETWORK'}` as Key;
    return (
      <Shell title={tr('session.title')} onBack={props.onExit}>
        <p className="warn" data-testid="session-error">
          {tr('session.error')}
        </p>
        <p>{translate(settings.lang, key) ?? tr('session.errorNETWORK')}</p>
        <Button kind="primary" full onClick={() => setAttempt((a) => a + 1)}>
          {tr('session.retry')}
        </Button>
      </Shell>
    );
  }
  if (live.phase === 'ended' && live.destroyed !== null) {
    return (
      <ReceiptScreen
        live={live}
        job={props.job}
        createdAt={createdAt.current}
        onDone={props.onExit}
      />
    );
  }

  if (live.requests.length > 0) {
    return (
      <Takeover
        requests={live.requests}
        onApprove={async (id) => {
          buzz(settings, [30, 60, 30]);
          await session.current?.approve(id);
        }}
        onDeny={(id) => {
          buzz(settings, 30);
          session.current?.deny(id);
        }}
      />
    );
  }

  if (live.phase === 'live') {
    return (
      <Shell title={tr('live.title')}>
        <div className="row between">
          <span className="muted">
            {tr('session.title')} {props.job.ref}
          </span>
          <span className={live.online ? 'ok' : 'warn'}>
            {live.online ? '●' : tr('session.offline')}
          </span>
        </div>
        <p className="muted">{tr('live.visible')}</p>
        <LifeBar remainingMs={remaining} totalMs={props.rules.liveTtlMs} />
        <dl className="kv">
          <dt>{tr('live.status')}</dt>
          <dd data-testid="live-status">
            {live.sessionState === 'LIVE' ? tr('live.viewing') : tr('live.waitingShop')}
          </dd>
          <dt>{tr('live.prints')}</dt>
          <dd className="num" data-testid="live-prints">
            {live.printsDone} {tr('step.of')} {props.rules.printLimit}
          </dd>
        </dl>
        <p className="muted small">{tr('live.keepOpen')}</p>
        <div className="sticky">
          <Button
            kind="danger"
            full
            onClick={() => {
              buzz(settings, 80);
              void session.current?.kill();
            }}
            testId="destroy-now"
          >
            {tr('live.destroy')}
          </Button>
        </div>
      </Shell>
    );
  }

  // armed: link + QR
  const link = live.link ?? '';
  return (
    <Shell title={tr('session.title')} step={`4 ${tr('step.of')} 4`}>
      <h2 className="h2">{tr('session.ready')}</h2>
      <div className="qrbox">
        <Qr text={link} label={tr('session.ready')} />
      </div>
      <code className="link" data-testid="share-link">
        {link}
      </code>
      <div className="row">
        {typeof navigator.share === 'function' ? (
          <Button
            kind="primary"
            onClick={() => {
              void navigator.share({ url: link }).catch(() => undefined);
            }}
          >
            {tr('session.share')}
          </Button>
        ) : null}
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(link).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => undefined,
            );
          }}
          testId="copy-link"
        >
          {copied ? tr('session.copied') : tr('session.copy')}
        </Button>
      </div>
      <p className="muted">{tr('session.linkNote')}</p>
      <p className="muted num">
        {tr('session.valid')} {remaining === null ? '' : fmt(remaining)}
      </p>
      <p aria-live="polite" data-testid="armed-status">
        {live.online ? tr('session.waiting') : tr('session.offline')}
      </p>
      <Button
        kind="ghost"
        onClick={() => {
          void session.current?.kill();
        }}
        testId="cancel-session"
      >
        {tr('session.cancel')}
      </Button>
    </Shell>
  );
}

const EMPTY_LIVE: LiveState = {
  phase: 'creating',
  sessionState: null,
  requests: [],
  remainingMs: null,
  receivedAt: 0,
  printsDone: 0,
  shopSeen: false,
  link: null,
  online: false,
  approvedAt: null,
  destroyed: null,
  error: null,
};

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function Takeover(props: {
  requests: LiveState['requests'];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const { tr } = useApp();
  return (
    <div
      className="takeover"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="tk-title"
      data-testid="takeover"
    >
      <h1 id="tk-title" className="title">
        {tr('approve.title')}
      </h1>
      {props.requests.length > 1 ? <p className="warn">{tr('approve.multiple')}</p> : null}
      {props.requests.map((r) => (
        <section key={r.reqId} className="req card notch" data-testid="request">
          <div>
            {r.browser}, {r.os}
          </div>
          {r.location !== null ? (
            <div className="muted small">
              {tr('approve.where')}: {r.location}
            </div>
          ) : null}
          <p>{tr('approve.question')}</p>
          <div
            className="code notch num"
            data-testid="sas"
            data-code={r.sas}
            aria-label={r.sas.split('').join(' ')}
          >
            {r.sas.split('').join(' ')}
          </div>
          <div className="row">
            <Button kind="danger" onClick={() => props.onDeny(r.reqId)} testId="deny">
              {tr('approve.deny')}
            </Button>
            <HoldButton
              label={tr('approve.hold')}
              onDone={() => props.onApprove(r.reqId)}
              testId="hold-approve"
            />
          </div>
        </section>
      ))}
      <p className="muted small">{tr('approve.note')}</p>
    </div>
  );
}

function ReceiptScreen(props: {
  live: LiveState;
  job: Job;
  createdAt: number;
  onDone: () => void;
}) {
  const { tr, settings } = useApp();
  const d = props.live.destroyed;
  if (d === null) return null;
  const time = (t: number): string => new Date(t).toLocaleTimeString();
  const reason = translate(settings.lang, `reason.${d.reason}` as Key);
  return (
    <Shell title={tr('receipt.title')}>
      <div className="dissolve" data-testid="receipt">
        <h1 className="title">{tr('receipt.title')}</h1>
        <p className="muted num">
          {tr('session.title')} {props.job.ref}
        </p>
        <dl className="kv">
          <dt>{tr('receipt.created')}</dt>
          <dd className="num">{time(props.createdAt)}</dd>
          {props.live.approvedAt !== null ? (
            <>
              <dt>{tr('receipt.approved')}</dt>
              <dd className="num">{time(props.live.approvedAt)}</dd>
            </>
          ) : null}
          <dt>{tr('receipt.pages')}</dt>
          <dd className="num" data-testid="receipt-prints">
            {d.printsDone}
          </dd>
          <dt>{tr('receipt.destroyed')}</dt>
          <dd className="num">
            {time(d.at)}, {reason}
          </dd>
        </dl>
        <ul className="checks">
          <li className="ok">✓ {tr('receipt.serverDeleted')}</li>
          <li className="ok">✓ {tr('receipt.keyErased')}</li>
          <li className={d.shopReportedWipe ? 'ok' : 'warn'} data-testid="receipt-shopwipe">
            {d.shopReportedWipe ? '✓' : '!'}{' '}
            {d.shopReportedWipe ? tr('receipt.shopWiped') : tr('receipt.shopNoWipe')}
          </li>
        </ul>
        <p className="muted small">{tr('receipt.footnote')}</p>
      </div>
      <Button kind="primary" full onClick={props.onDone} testId="receipt-done">
        {tr('receipt.done')}
      </Button>
    </Shell>
  );
}

// ---------------- History & Settings ----------------
function History(props: { receipts: Receipt[]; onClear: () => void; onBack: () => void }) {
  const { tr } = useApp();
  return (
    <Shell title={tr('history.title')} onBack={props.onBack}>
      <ul className="list">
        {props.receipts.map((r) => (
          <ReceiptRow key={r.ref} r={r} />
        ))}
      </ul>
      <p className="muted small">{tr('history.note')}</p>
      {props.receipts.length > 0 ? (
        <Button kind="danger" onClick={props.onClear}>
          {tr('history.clear')}
        </Button>
      ) : null}
    </Shell>
  );
}

function SettingsScreen(props: { onBack: () => void }) {
  const { tr, settings, setSettings } = useApp();
  return (
    <Shell title={tr('settings.title')} onBack={props.onBack}>
      <Field label={tr('settings.language')}>
        <Segmented<Lang>
          name="lang"
          value={settings.lang}
          onChange={(v) => setSettings({ ...settings, lang: v })}
          options={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिन्दी' },
          ]}
        />
      </Field>
      <Field label={tr('settings.theme')}>
        <Segmented<Theme>
          name="theme"
          value={settings.theme}
          onChange={(v) => setSettings({ ...settings, theme: v })}
          options={[
            { value: 'soot', label: tr('settings.themeDark') },
            { value: 'paper', label: tr('settings.themePaper') },
            { value: 'system', label: tr('settings.themeSystem') },
          ]}
        />
      </Field>
      <Toggle
        label={tr('settings.haptics')}
        value={settings.haptics}
        onChange={(v) => setSettings({ ...settings, haptics: v })}
        onText={tr('rules.on')}
        offText={tr('rules.off')}
      />
      <Field label={tr('settings.server')}>
        <code>{window.location.origin}</code>
      </Field>
      <h2 className="h2">{tr('settings.about')}</h2>
      <p className="muted">{tr('settings.aboutText')}</p>
      <p className="muted small">{tr('settings.iosNote')}</p>
    </Shell>
  );
}

// ---------------- App ----------------
export function App() {
  const [settings, setSettingsState] = useState<Settings>(() =>
    loadSettings(navigator.languages ?? [navigator.language]),
  );
  const [view, setView] = useState<View>({ v: 'home' });
  const [receipts, setReceipts] = useState<Receipt[]>(() => loadReceipts());
  const [rules, setRules] = useState<Rules>(() => ({
    ...DEFAULT_RULES,
    linkTtlMs: settings.linkTtlMs,
    liveTtlMs: settings.liveTtlMs,
    printLimit: settings.printLimit,
    destroyAfterPrint: settings.destroyAfterPrint,
  }));
  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);
  const ctx = useMemo<Ctx>(
    () => ({ settings, setSettings, tr: (k) => translate(settings.lang, k) }),
    [settings, setSettings],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = settings.theme;
    root.lang = settings.lang;
  }, [settings.theme, settings.lang]);

  const closeJob = (job: Job): void => job.source.destroy();

  let body: ReactNode;
  switch (view.v) {
    case 'home':
      body = (
        <Home receipts={receipts} go={setView} onFile={(file) => setView({ v: 'import', file })} />
      );
      break;
    case 'import':
      body = (
        <ImportScreen
          view={view}
          settings={settings}
          onBack={() => setView({ v: 'home' })}
          onDone={(job) => setView({ v: 'prepare', job })}
          onFail={(code) => setView({ v: 'importError', code })}
          onAsk={(wrong) => setView({ v: 'import', file: view.file, ask: true, wrong })}
          onPassword={(pw) => setView({ v: 'import', file: view.file, password: pw })}
        />
      );
      break;
    case 'importError':
      body = <ImportError code={view.code} onBack={() => setView({ v: 'home' })} />;
      break;
    case 'prepare':
      body = (
        <Prepare
          job={view.job}
          settings={settings}
          onChange={(options) => setView({ v: 'prepare', job: { ...view.job, options } })}
          onNext={() => setView({ v: 'rules', job: view.job })}
          onBack={() => {
            closeJob(view.job);
            setView({ v: 'home' });
          }}
        />
      );
      break;
    case 'rules':
      body = (
        <RulesScreen
          settings={settings}
          rules={rules}
          onChange={setRules}
          onNext={() => setView({ v: 'session', job: view.job, rules })}
          onBack={() => setView({ v: 'prepare', job: view.job })}
        />
      );
      break;
    case 'session':
      body = (
        <SessionScreen
          key={view.job.ref}
          job={view.job}
          rules={view.rules}
          settings={settings}
          onExit={() => {
            closeJob(view.job);
            setView({ v: 'home' });
          }}
          onReceipt={(r) => setReceipts(addReceipt(r))}
        />
      );
      break;
    case 'history':
      body = (
        <History
          receipts={receipts}
          onClear={() => {
            clearReceipts();
            setReceipts([]);
          }}
          onBack={() => setView({ v: 'home' })}
        />
      );
      break;
    case 'settings':
      body = <SettingsScreen onBack={() => setView({ v: 'home' })} />;
      break;
  }
  return (
    <AppCtx.Provider value={ctx}>
      <div data-screen={view.v}>{body}</div>
    </AppCtx.Provider>
  );
}
