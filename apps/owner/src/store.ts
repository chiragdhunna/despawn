export type Theme = 'soot' | 'paper' | 'system';
export type Lang = 'en' | 'hi';

export interface Settings {
  lang: Lang;
  theme: Theme;
  haptics: boolean;
  defaultPurpose: string;
  linkTtlMs: number;
  liveTtlMs: number;
  printLimit: number;
  destroyAfterPrint: boolean;
}

export interface Receipt {
  ref: string;
  purpose: string;
  createdAt: number;
  endedAt: number;
  reason: string;
  printsDone: number;
  shopReportedWipe: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  theme: 'system',
  haptics: true,
  defaultPurpose: 'KYC',
  linkTtlMs: 1_800_000,
  liveTtlMs: 120_000,
  printLimit: 1,
  destroyAfterPrint: true,
};

const SETTINGS_KEY = 'despawn.settings.v1';
const RECEIPTS_KEY = 'despawn.receipts.v1';
const MAX_RECEIPTS = 50;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage may be unavailable (private mode); the app still works
  }
}

export function loadSettings(languages: readonly string[]): Settings {
  const stored = read<Partial<Settings>>(SETTINGS_KEY) ?? {};
  const hi = languages.some((l) => l.toLowerCase().indexOf('hi') === 0);
  const s: Settings = { ...DEFAULT_SETTINGS, lang: hi ? 'hi' : 'en', ...stored };
  s.linkTtlMs = clamp(s.linkTtlMs, 300_000, 86_400_000, DEFAULT_SETTINGS.linkTtlMs);
  s.liveTtlMs = clamp(s.liveTtlMs, 30_000, 600_000, DEFAULT_SETTINGS.liveTtlMs);
  s.printLimit = clamp(s.printLimit, 1, 10, 1);
  return s;
}

function clamp(v: unknown, lo: number, hi: number, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d;
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

export function loadReceipts(): Receipt[] {
  const r = read<Receipt[]>(RECEIPTS_KEY);
  return Array.isArray(r) ? r.slice(0, MAX_RECEIPTS) : [];
}

export function addReceipt(r: Receipt): Receipt[] {
  const all = [r, ...loadReceipts().filter((x) => x.ref !== r.ref)].slice(0, MAX_RECEIPTS);
  write(RECEIPTS_KEY, all);
  return all;
}

export function clearReceipts(): void {
  write(RECEIPTS_KEY, []);
}
