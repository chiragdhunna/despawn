import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlobStore } from '@despawn/server-core';
import { MemoryBlobStore } from '@despawn/server-core';
import { isSessionId } from '@despawn/protocol';

export interface CountingBlobStore extends BlobStore {
  count(): Promise<number>;
}

export class MemoryStore extends MemoryBlobStore implements CountingBlobStore {
  count(): Promise<number> {
    return Promise.resolve(this.map.size);
  }
}

/**
 * Ciphertext on local disk, one file per session. Files are private (0600) and short lived.
 * On startup every leftover file is removed: sessions live in memory, so after a restart no
 * session can ever use them (fail closed).
 */
export class FileBlobStore implements CountingBlobStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.dir)) {
      if (name.endsWith('.bin')) {
        await rm(path.join(this.dir, name), { force: true });
      }
    }
  }

  private file(id: string): string {
    if (!isSessionId(id)) {
      throw new Error('invalid blob id');
    }
    return path.join(this.dir, `${id}.bin`);
  }

  async put(id: string, data: Uint8Array): Promise<void> {
    await writeFile(this.file(id), data, { mode: 0o600 });
  }

  async get(id: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(id)));
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }

  async count(): Promise<number> {
    return (await readdir(this.dir)).filter((n) => n.endsWith('.bin')).length;
  }
}
