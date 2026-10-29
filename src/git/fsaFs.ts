import { Buffer } from 'buffer';

// A minimal Node-style `fs.promises` over a FileSystemDirectoryHandle, so isomorphic-git can work
// directly on the folder the user opened. Paths are relative to that folder ("/.git/HEAD").

type Dir = FileSystemDirectoryHandle;

function fsError(code: string, path: string): Error {
  const e: any = new Error(`${code}: ${path}`);
  e.code = code;
  return e;
}

// Maps the DOMException names the File System Access API throws to the codes isomorphic-git checks
function toFsError(e: any, path: string, whenWrongKind: 'ENOTDIR' | 'EISDIR'): Error {
  switch (e?.name) {
    case 'NotFoundError':
      return fsError('ENOENT', path);
    case 'TypeMismatchError':
      return fsError(whenWrongKind, path);
    case 'InvalidModificationError':
      return fsError('ENOTEMPTY', path);
    case 'NoModificationAllowedError':
    case 'NotAllowedError':
      return fsError('EACCES', path);
    default:
      return e instanceof Error ? e : fsError('EIO', path);
  }
}

function makeStat(type: 'file' | 'dir', size: number, mtimeMs: number) {
  return {
    type,
    mode: type === 'file' ? 0o100644 : 0o040000,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
    isSymbolicLink: () => false,
  };
}

// "." and ".." are not valid names for the browser API, so resolve them here
function segmentsOf(path: string): string[] {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out;
}

// Create one per git operation: it caches directory handles, which go stale if the folder
// is changed from outside (for example by the git CLI) between operations.
export function createFsaFs(root: Dir) {
  const dirs = new Map<string, Dir>([['', root]]);

  async function dirAt(segments: string[], path: string): Promise<Dir> {
    const key = segments.join('/');
    const cached = dirs.get(key);
    if (cached) return cached;
    const parent = await dirAt(segments.slice(0, -1), path);
    try {
      const handle = await parent.getDirectoryHandle(segments[segments.length - 1]);
      dirs.set(key, handle);
      return handle;
    } catch (e) {
      throw toFsError(e, path, 'ENOTDIR');
    }
  }

  async function parentOf(path: string): Promise<{ dir: Dir; name: string }> {
    const segments = segmentsOf(path);
    const name = segments.pop();
    if (!name) throw fsError('EISDIR', path);
    return { dir: await dirAt(segments, path), name };
  }

  const promises = {
    async readFile(path: string, options?: string | { encoding?: string }) {
      const { dir, name } = await parentOf(path);
      let file: File;
      try {
        file = await (await dir.getFileHandle(name)).getFile();
      } catch (e) {
        throw toFsError(e, path, 'EISDIR');
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? buffer.toString(encoding as BufferEncoding) : buffer;
    },

    async writeFile(path: string, data: string | Uint8Array) {
      const { dir, name } = await parentOf(path);
      try {
        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await writable.write(data as any);
        await writable.close();
      } catch (e) {
        throw toFsError(e, path, 'EISDIR');
      }
    },

    async unlink(path: string) {
      const { dir, name } = await parentOf(path);
      try {
        await dir.removeEntry(name);
      } catch (e) {
        throw toFsError(e, path, 'EISDIR');
      }
    },

    async readdir(path: string) {
      const dir = await dirAt(segmentsOf(path), path);
      const names: string[] = [];
      for await (const name of (dir as any).keys()) names.push(name);
      return names;
    },

    async mkdir(path: string) {
      const segments = segmentsOf(path);
      const name = segments.pop();
      if (!name) throw fsError('EEXIST', path);
      const parent = await dirAt(segments, path);
      for (const probe of [() => parent.getDirectoryHandle(name), () => parent.getFileHandle(name)]) {
        try {
          await probe();
          throw fsError('EEXIST', path);
        } catch (e: any) {
          if (e?.code === 'EEXIST') throw e;
        }
      }
      try {
        dirs.set([...segments, name].join('/'), await parent.getDirectoryHandle(name, { create: true }));
      } catch (e) {
        throw toFsError(e, path, 'ENOTDIR');
      }
    },

    async rmdir(path: string) {
      const { dir, name } = await parentOf(path);
      try {
        await dir.removeEntry(name);
      } catch (e) {
        throw toFsError(e, path, 'ENOTDIR');
      }
      const key = segmentsOf(path).join('/');
      for (const cached of [...dirs.keys()]) {
        if (cached === key || cached.startsWith(key + '/')) dirs.delete(cached);
      }
    },

    async stat(path: string) {
      if (!segmentsOf(path).length) return makeStat('dir', 0, 0);
      const { dir, name } = await parentOf(path);
      try {
        const file = await (await dir.getFileHandle(name)).getFile();
        return makeStat('file', file.size, file.lastModified);
      } catch (e: any) {
        if (e?.name !== 'TypeMismatchError') throw toFsError(e, path, 'EISDIR');
      }
      try {
        await dir.getDirectoryHandle(name);
        return makeStat('dir', 0, 0);
      } catch (e) {
        throw toFsError(e, path, 'ENOTDIR');
      }
    },

    // Symlinks can't be created through the browser API; like git on Windows, store the target as a file
    async symlink(target: string, path: string) {
      await promises.writeFile(path, target);
    },

    async readlink(path: string) {
      throw fsError('ENOENT', path);
    },
  };

  return { promises: { ...promises, lstat: promises.stat } };
}
