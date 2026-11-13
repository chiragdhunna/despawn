declare module 'node:zlib' {
  export function gzipSync(buf: Uint8Array): Uint8Array;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

declare const process: {
  cwd(): string;
};
