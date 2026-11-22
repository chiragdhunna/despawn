import logoUrl from '../../../assets/logo/logo-dark.svg';
import { t, type Lang, type StringKey } from './i18n.js';

export interface PageView {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export type Paper = 'A4' | 'A5' | 'Letter';

const SEGMENTS = 20;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== undefined) {
    e.className = className;
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}

/**
 * All DOM work lives here. Only textContent and DOM APIs are used, never innerHTML, so nothing
 * that arrives over the network can become markup.
 */
export class Ui {
  lang: Lang;
  private rerender: (() => void) | null = null;
  private liveBar: HTMLElement[] = [];
  private liveText: HTMLElement | null = null;
  private offlineNote: HTMLElement | null = null;
  private printRoot: HTMLElement | null = null;
  private printButton: HTMLButtonElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    lang: Lang,
  ) {
    this.lang = lang;
  }

  private tr(key: StringKey): string {
    return t(this.lang, key);
  }

  private mount(screen: string, build: () => HTMLElement[]): void {
    this.rerender = () => this.mount(screen, build);
    this.liveBar = [];
    this.liveText = null;
    this.offlineNote = null;
    this.printButton = null;
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    this.root.dataset.screen = screen;
    this.root.lang = this.lang;

    const header = el('header', 'bar');
    const logo = el('img', 'logo');
    logo.src = logoUrl;
    logo.alt = 'Despawn';
    logo.height = 28;
    header.appendChild(logo);
    const langs = el('div', 'langs');
    for (const l of ['en', 'hi'] as const) {
      const b = el(
        'button',
        l === this.lang ? 'lang on' : 'lang',
        t(l, l === 'en' ? 'lang.en' : 'lang.hi'),
      );
      b.type = 'button';
      b.setAttribute('aria-pressed', l === this.lang ? 'true' : 'false');
      b.addEventListener('click', () => {
        this.lang = l;
        this.rerender?.();
      });
      langs.appendChild(b);
    }
    header.appendChild(langs);
    this.root.appendChild(header);

    const main = el('main', 'col');
    for (const child of build()) {
      main.appendChild(child);
    }
    this.root.appendChild(main);
  }

  private block(titleKey: StringKey, bodyKey?: StringKey, extra?: HTMLElement[]): HTMLElement[] {
    const out: HTMLElement[] = [el('h1', 'title', this.tr(titleKey))];
    if (bodyKey !== undefined) {
      out.push(el('p', 'body', this.tr(bodyKey)));
    }
    return out.concat(extra ?? []);
  }

  connecting(): void {
    this.mount('connecting', () => this.block('connecting.title'));
  }

  waiting(code: string): void {
    this.mount('waiting', () => {
      const codeEl = el('div', 'code notch');
      codeEl.textContent = code.split('').join(' ');
      codeEl.dataset.code = code;
      codeEl.setAttribute('aria-label', code.split('').join(' '));
      return [
        el('h1', 'title', this.tr('waiting.title')),
        el('p', 'body', this.tr('waiting.code')),
        codeEl,
        el('p', 'body muted', this.tr('waiting.help')),
      ];
    });
  }

  preparing(slow: boolean): void {
    this.mount('preparing', () => {
      const out = this.block('preparing.title');
      out.push(el('div', 'spinner'));
      if (slow) {
        out.push(el('p', 'body muted', this.tr('preparing.slow')));
      }
      return out;
    });
  }

  ready(opts: {
    pages: readonly PageView[];
    remainingMs: number | null;
    canPrint: boolean;
    onPrint: () => void;
  }): void {
    this.mount('ready', () => {
      const status = el('div', 'status');
      status.appendChild(el('span', 'approved', this.tr('ready.approved')));
      const live = el('div', 'live');
      live.appendChild(el('span', 'muted', this.tr('ready.visible')));
      this.liveText = el('span', 'num');
      live.appendChild(this.liveText);
      const bar = el('div', 'lifebar');
      bar.setAttribute('role', 'presentation');
      for (let i = 0; i < SEGMENTS; i++) {
        const s = el('span', 'seg');
        this.liveBar.push(s);
        bar.appendChild(s);
      }
      live.appendChild(bar);
      status.appendChild(live);

      const pagesEl = el('div', 'pages');
      opts.pages.forEach((p, i) => {
        const wrap = el('figure', 'pageview');
        const img = el('img', 'pageimg');
        img.src = p.url;
        img.alt = `${this.tr('ready.page')} ${i + 1}`;
        img.draggable = false;
        img.addEventListener('contextmenu', (e) => e.preventDefault());
        wrap.appendChild(img);
        wrap.appendChild(
          el('figcaption', 'muted', `${this.tr('ready.page')} ${i + 1} / ${opts.pages.length}`),
        );
        pagesEl.appendChild(wrap);
      });

      const steps = el('ol', 'steps');
      steps.appendChild(el('li', undefined, this.tr('ready.step1')));
      steps.appendChild(el('li', undefined, this.tr('ready.step2')));

      const print = el('button', 'btn primary notch', this.tr('ready.print'));
      print.type = 'button';
      print.disabled = !opts.canPrint;
      print.addEventListener('click', opts.onPrint);
      this.printButton = print;

      const help = el('details', 'help');
      help.appendChild(el('summary', undefined, this.tr('ready.help')));
      help.appendChild(el('p', 'body', this.tr('ready.helpBody')));
      help.appendChild(el('p', 'body', this.tr('ready.helpHeaders')));

      this.offlineNote = el('p', 'warn');
      this.offlineNote.hidden = true;
      this.offlineNote.textContent = this.tr('ready.ownerOffline');

      const out = [
        status,
        pagesEl,
        steps,
        print,
        this.offlineNote,
        el('p', 'body muted', this.tr('ready.selfDestroy')),
        help,
      ];
      this.updateLive(opts.remainingMs, true);
      return out;
    });
  }

  /** Updates the countdown and the owner-offline notice without rebuilding the screen. */
  updateLive(remainingMs: number | null, ownerAlive: boolean, total = 120000): void {
    if (this.liveText !== null) {
      if (remainingMs === null) {
        this.liveText.textContent = '';
      } else {
        const s = Math.ceil(remainingMs / 1000);
        this.liveText.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }
      const on =
        remainingMs === null
          ? SEGMENTS
          : Math.max(0, Math.min(SEGMENTS, Math.ceil((remainingMs / total) * SEGMENTS)));
      this.liveBar.forEach((seg, i) => {
        seg.className = i < on ? (on <= 5 ? 'seg on low' : 'seg on') : 'seg';
      });
    }
    if (this.offlineNote !== null) {
      this.offlineNote.hidden = ownerAlive;
    }
  }

  setPrintEnabled(enabled: boolean): void {
    if (this.printButton !== null) {
      this.printButton.disabled = !enabled;
    }
  }

  printing(): void {
    this.mount('printing', () => {
      const out = this.block('printing.title');
      out.push(el('div', 'spinner'));
      return out;
    });
  }

  confirm(onYes: () => void, onAgain: () => void): void {
    this.mount('confirm', () => {
      const yes = el('button', 'btn primary notch', this.tr('confirm.yes'));
      yes.type = 'button';
      yes.addEventListener('click', onYes);
      const again = el('button', 'btn secondary notch', this.tr('confirm.again'));
      again.type = 'button';
      again.addEventListener('click', onAgain);
      const row = el('div', 'row');
      row.appendChild(yes);
      row.appendChild(again);
      return this.block('confirm.title', undefined, [row]);
    });
  }

  finishing(): void {
    this.mount('finishing', () => {
      const out = this.block('finishing.title');
      out.push(el('div', 'spinner'));
      return out;
    });
  }

  destroyed(reasonKey: StringKey): void {
    this.mount('destroyed', () => {
      const reason = el('p', 'body', this.tr(reasonKey));
      reason.dataset.reason = reasonKey;
      return [
        el('h1', 'title', this.tr('destroyed.title')),
        el('p', 'body', this.tr('destroyed.body')),
        reason,
        el('p', 'body muted', this.tr('destroyed.close')),
      ];
    });
  }

  message(kind: 'invalid' | 'unsupported' | 'busy' | 'lost' | 'insecure'): void {
    this.mount(kind, () => this.block(`${kind}.title` as StringKey, `${kind}.body` as StringKey));
  }

  /** Builds the print-only container: one image per page, sized by CSS for the paper. */
  buildPrint(pages: readonly PageView[], paper: Paper, landscape: boolean): void {
    this.clearPrint();
    const root = el('div', `print-root paper-${paper.toLowerCase()}${landscape ? '-l' : ''}`);
    root.id = 'print-root';
    for (const p of pages) {
      const img = el('img', 'print-page');
      img.src = p.url;
      img.alt = '';
      root.appendChild(img);
    }
    document.body.appendChild(root);
    this.printRoot = root;
  }

  clearPrint(): void {
    if (this.printRoot !== null) {
      this.printRoot.remove();
      this.printRoot = null;
    }
  }

  /** Removes every element that could still show document content. */
  purge(): void {
    this.clearPrint();
    const imgs = this.root.getElementsByTagName('img');
    for (let i = imgs.length - 1; i >= 0; i--) {
      const img = imgs[i];
      if (img !== undefined && img.className !== 'logo') {
        img.removeAttribute('src');
        img.remove();
      }
    }
    this.liveBar = [];
    this.liveText = null;
    this.offlineNote = null;
    this.printButton = null;
  }
}
