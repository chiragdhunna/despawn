import type { BlobStore, RelaySocket, Scheduler, TimerHandle } from './ports.js';

/** Deterministic scheduler for tests: time only moves when advance() is called. */
export class ManualScheduler implements Scheduler {
  private t = 1_700_000_000_000;
  private nextId = 1;
  private readonly queue = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.queue.set(id, { at: this.t + ms, fn });
    return { cancel: () => void this.queue.delete(id) };
  }

  /** Moves time forward, firing due timers in order (including timers they schedule). */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      let best: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of this.queue) {
        if (entry[1].at <= end && (best === null || entry[1].at < best[1].at)) {
          best = entry;
        }
      }
      if (best === null) {
        break;
      }
      this.queue.delete(best[0]);
      this.t = Math.max(this.t, best[1].at);
      best[1].fn();
      await Promise.resolve();
    }
    this.t = end;
    await Promise.resolve();
  }

  pending(): number {
    return this.queue.size;
  }
}

export const systemScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(h) };
  },
};

export class MemoryBlobStore implements BlobStore {
  readonly map = new Map<string, Uint8Array>();
  put(id: string, data: Uint8Array): Promise<void> {
    this.map.set(id, data.slice());
    return Promise.resolve();
  }
  get(id: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.map.get(id)?.slice() ?? null);
  }
  delete(id: string): Promise<void> {
    this.map.delete(id);
    return Promise.resolve();
  }
}

export class FakeSocket implements RelaySocket {
  readonly sent: string[] = [];
  open = true;
  get isOpen(): boolean {
    return this.open;
  }
  send(text: string): void {
    if (this.open) {
      this.sent.push(text);
    }
  }
  close(): void {
    this.open = false;
  }
  /** Parsed JSON of every frame sent so far. */
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
  last(type: string): Record<string, unknown> | undefined {
    return this.frames()
      .filter((f) => f.t === type)
      .pop();
  }
}
