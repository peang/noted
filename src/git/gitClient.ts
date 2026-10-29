import { Buffer } from 'buffer';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { createFsaFs } from './fsaFs';
import { GIT_PROXY_PREFIX } from '../server/gitProxy';

// isomorphic-git expects a Node-style Buffer global in the browser
(globalThis as any).Buffer ??= Buffer;

const DIR = '/';
const REMOTE = 'origin';
const HISTORY_DEPTH = 300;
const STORAGE_TOKENS = 'noted_git_tokens';
const STORAGE_REMOTES = 'noted_git_remotes';
const STORAGE_IDENTITY = 'noted_git_identity';

export interface GitChange {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  staged: boolean;
}

export interface GitSnapshot {
  branch: string | null;
  // Short commit id when HEAD isn't on a branch
  detachedAt: string | null;
  changes: GitChange[];
  branches: string[];
  // Remote branches without a local branch of the same name
  remoteOnlyBranches: string[];
  // null when the branch has no remote counterpart yet
  upstream: { ahead: number; behind: number; capped: boolean } | null;
  remoteUrl: string | null;
}

export interface GitIdentity {
  name: string;
  email: string;
}

// The user has to give a token (or an https URL) before this operation can reach the remote
export class GitAuthError extends Error {
  constructor(public host: string, public needsUrl: boolean, message: string) {
    super(message);
  }
}

const fsOf = (root: FileSystemDirectoryHandle) => createFsaFs(root) as any;

// ---------------------------------------------------------------- remote settings (kept in this browser only)

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the setting just won't persist
  }
}

export const getToken = (host: string): string => readJson<Record<string, string>>(STORAGE_TOKENS, {})[host] ?? '';
export function setToken(host: string, token: string) {
  const all = readJson<Record<string, string>>(STORAGE_TOKENS, {});
  if (token) all[host] = token;
  else delete all[host];
  writeJson(STORAGE_TOKENS, all);
}

export const getSavedHttpsUrl = (repoKey: string): string => readJson<Record<string, string>>(STORAGE_REMOTES, {})[repoKey] ?? '';
export function setSavedHttpsUrl(repoKey: string, url: string) {
  const all = readJson<Record<string, string>>(STORAGE_REMOTES, {});
  if (url) all[repoKey] = url;
  else delete all[repoKey];
  writeJson(STORAGE_REMOTES, all);
}

export const getSavedIdentity = (): GitIdentity | null => {
  const saved = readJson<Partial<GitIdentity>>(STORAGE_IDENTITY, {});
  return saved.name && saved.email ? { name: saved.name, email: saved.email } : null;
};
export const setSavedIdentity = (identity: GitIdentity) => writeJson(STORAGE_IDENTITY, identity);

// ---------------------------------------------------------------- remote URLs

const KNOWN_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);

export interface ParsedRemote {
  // What the browser can speak: https only
  httpsUrl: string | null;
  host: string | null;
  kind: 'https' | 'ssh' | 'other';
}

export function parseRemote(url: string | null): ParsedRemote {
  if (!url) return { httpsUrl: null, host: null, kind: 'other' };
  const https = url.match(/^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i);
  if (https) return { httpsUrl: url.replace(/^(https?:\/\/)[^@/]+@/i, '$1'), host: https[1].toLowerCase(), kind: 'https' };
  // git@host:owner/repo.git and ssh://git@host/owner/repo.git
  const ssh = url.match(/^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+)[:/](.+)$/);
  if (ssh) {
    const host = ssh[1].toLowerCase();
    // An SSH alias from ~/.ssh/config ("irvan-github") can't be mapped to a web address
    return { httpsUrl: KNOWN_HOSTS.has(host) ? `https://${host}/${ssh[2]}` : null, host, kind: 'ssh' };
  }
  return { httpsUrl: null, host: null, kind: 'other' };
}

export function hostOfUrl(url: string): string {
  return url.match(/^https?:\/\/([^/:]+)/i)?.[1].toLowerCase() ?? '';
}

// GitHub takes the token as the user name; GitLab and Bitbucket want fixed user names
function credentialsFor(host: string, token: string) {
  if (host === 'gitlab.com') return { username: 'oauth2', password: token };
  if (host === 'bitbucket.org') return { username: 'x-token-auth', password: token };
  if (host === 'github.com') return { username: token, password: 'x-oauth-basic' };
  return { username: 'git', password: token };
}

// ---------------------------------------------------------------- reading state

export async function hasGitDirectory(root: FileSystemDirectoryHandle): Promise<'repo' | 'file' | 'none'> {
  try {
    await root.getDirectoryHandle('.git');
    return 'repo';
  } catch (e: any) {
    // A ".git" file points at a worktree or submodule, which isn't supported
    if (e?.name === 'TypeMismatchError') return 'file';
    return 'none';
  }
}

async function aheadBehind(fs: any, branch: string): Promise<GitSnapshot['upstream']> {
  let remoteOid: string;
  try {
    remoteOid = await git.resolveRef({ fs, dir: DIR, ref: `refs/remotes/${REMOTE}/${branch}` });
  } catch {
    return null;
  }
  const [local, remote] = await Promise.all([
    git.log({ fs, dir: DIR, ref: branch, depth: HISTORY_DEPTH }),
    git.log({ fs, dir: DIR, ref: remoteOid, depth: HISTORY_DEPTH }),
  ]);
  const localIds = new Set(local.map((c) => c.oid));
  const remoteIds = new Set(remote.map((c) => c.oid));
  return {
    ahead: local.filter((c) => !remoteIds.has(c.oid)).length,
    behind: remote.filter((c) => !localIds.has(c.oid)).length,
    capped: local.length >= HISTORY_DEPTH || remote.length >= HISTORY_DEPTH,
  };
}

function toChange(row: [string, number, number, number]): GitChange | null {
  const [path, head, workdir, stage] = row;
  if (head === 1 && workdir === 1 && stage === 1) return null;
  const status = head === 0 ? 'added' : workdir === 0 ? 'deleted' : 'modified';
  // stage: 0 absent, 1 same as HEAD, 2 same as the working copy, 3 different from both
  const staged = head === 0 ? stage !== 0 : workdir === 0 ? stage === 0 : stage === 2 || stage === 3;
  return { path, status, staged };
}

export async function readSnapshot(root: FileSystemDirectoryHandle): Promise<GitSnapshot> {
  const fs = fsOf(root);
  const branch = ((await git.currentBranch({ fs, dir: DIR, fullname: false })) || null) as string | null;
  const detachedAt = branch ? null : (await git.resolveRef({ fs, dir: DIR, ref: 'HEAD' }).catch(() => '')).slice(0, 7) || null;

  const matrix = await git.statusMatrix({ fs, dir: DIR });
  const changes = matrix
    .map((row) => toChange(row as [string, number, number, number]))
    .filter((c): c is GitChange => c !== null)
    .sort((a, b) => a.path.localeCompare(b.path));

  const branches = await git.listBranches({ fs, dir: DIR });
  const remoteBranches = (await git.listBranches({ fs, dir: DIR, remote: REMOTE }).catch(() => [] as string[]))
    .filter((b) => b !== 'HEAD');
  const remoteUrl = (await git.listRemotes({ fs, dir: DIR })).find((r) => r.remote === REMOTE)?.url ?? null;

  return {
    branch,
    detachedAt,
    changes,
    branches: branches.sort((a, b) => a.localeCompare(b)),
    remoteOnlyBranches: remoteBranches.filter((b) => !branches.includes(b)).sort((a, b) => a.localeCompare(b)),
    upstream: branch ? await aheadBehind(fs, branch).catch(() => null) : null,
    remoteUrl,
  };
}

export async function readConfiguredIdentity(root: FileSystemDirectoryHandle): Promise<GitIdentity | null> {
  const fs = fsOf(root);
  const name = await git.getConfig({ fs, dir: DIR, path: 'user.name' });
  const email = await git.getConfig({ fs, dir: DIR, path: 'user.email' });
  return name && email ? { name, email } : null;
}

// ---------------------------------------------------------------- local changes

export async function commitChanges(
  root: FileSystemDirectoryHandle,
  selected: GitChange[],
  leftOut: GitChange[],
  message: string,
  author: GitIdentity,
): Promise<string> {
  const fs = fsOf(root);
  for (const change of selected) {
    if (change.status === 'deleted') await git.remove({ fs, dir: DIR, filepath: change.path });
    else await git.add({ fs, dir: DIR, filepath: change.path });
  }
  // Something unticked but already staged must not slip into this commit
  for (const change of leftOut) {
    if (change.staged) await git.resetIndex({ fs, dir: DIR, filepath: change.path });
  }
  return git.commit({ fs, dir: DIR, message, author });
}

export async function switchBranch(root: FileSystemDirectoryHandle, name: string, create: boolean): Promise<void> {
  const fs = fsOf(root);
  if (create) {
    await git.branch({ fs, dir: DIR, ref: name, checkout: true });
    return;
  }
  // A branch that only exists on the remote is created locally and tracks it
  await git.checkout({ fs, dir: DIR, ref: name, remote: REMOTE });
}

// ---------------------------------------------------------------- network

export interface RemoteContext {
  httpsUrl: string;
  host: string;
  token: string;
}

function networkOptions(ctx: RemoteContext) {
  return {
    http,
    url: ctx.httpsUrl,
    corsProxy: `${location.origin}${GIT_PROXY_PREFIX.slice(0, -1)}`,
    onAuth: () => (ctx.token ? credentialsFor(ctx.host, ctx.token) : { cancel: true }),
  };
}

// Turns isomorphic-git's HTTP failures into something the UI can act on
function rethrowNetworkError(e: any, ctx: RemoteContext): never {
  if (e?.name === 'UserCanceledError' || (e?.name === 'HttpError' && e?.data?.statusCode === 401)) {
    throw new GitAuthError(ctx.host, false, ctx.token ? 'The access token was rejected.' : 'This remote needs an access token.');
  }
  if (e?.name === 'HttpError' && e?.data?.statusCode === 403 && /not allowed/i.test(String(e.data.response ?? ''))) {
    throw new Error(`The git relay does not support ${ctx.host}. It can reach github.com, gitlab.com, bitbucket.org and codeberg.org.`);
  }
  if (e?.name === 'HttpError' && e?.data?.statusCode === 403) {
    throw new GitAuthError(ctx.host, false, 'The access token has no permission for this repository.');
  }
  throw e;
}

export async function fetchRemote(root: FileSystemDirectoryHandle, ctx: RemoteContext): Promise<void> {
  try {
    await git.fetch({ fs: fsOf(root), dir: DIR, remote: REMOTE, tags: false, prune: true, ...networkOptions(ctx) });
  } catch (e) {
    rethrowNetworkError(e, ctx);
  }
}

export async function pullBranch(root: FileSystemDirectoryHandle, branch: string, ctx: RemoteContext, author: GitIdentity): Promise<void> {
  try {
    await git.pull({
      fs: fsOf(root),
      dir: DIR,
      remote: REMOTE,
      ref: branch,
      remoteRef: branch,
      singleBranch: true,
      author,
      ...networkOptions(ctx),
    });
  } catch (e) {
    rethrowNetworkError(e, ctx);
  }
}

export async function pushBranch(root: FileSystemDirectoryHandle, branch: string, ctx: RemoteContext): Promise<void> {
  if (!ctx.token) throw new GitAuthError(ctx.host, false, 'Pushing needs an access token.');
  try {
    const result = await git.push({ fs: fsOf(root), dir: DIR, remote: REMOTE, ref: branch, remoteRef: branch, ...networkOptions(ctx) });
    if (!result.ok) {
      const rejected = Object.values(result.refs ?? {}).find((r) => !r.ok);
      throw new Error(result.error || (rejected as any)?.error || 'The remote rejected the push.');
    }
    // Like the git CLI, remember what the remote has now; isomorphic-git leaves this ref behind
    const fs = fsOf(root);
    await git.writeRef({
      fs,
      dir: DIR,
      ref: `refs/remotes/${REMOTE}/${branch}`,
      value: await git.resolveRef({ fs, dir: DIR, ref: branch }),
      force: true,
    });
  } catch (e) {
    rethrowNetworkError(e, ctx);
  }
}

// Plain-language text for the errors users actually hit
export function describeGitError(e: any): string {
  switch (e?.code ?? e?.name) {
    case 'CheckoutConflictError':
      return `Local changes would be overwritten: ${(e.data?.filepaths ?? []).slice(0, 5).join(', ')}. Commit or discard them first.`;
    case 'MergeConflictError':
      return `Pull stopped: both sides changed ${(e.data?.filepaths ?? []).slice(0, 5).join(', ')}. Resolve this with the git CLI; nothing was changed here.`;
    case 'MergeNotSupportedError':
      return 'This merge needs the git CLI (it is more than a simple merge). Nothing was changed.';
    case 'FastForwardError':
      return 'The remote has new commits. Pull first, then push again.';
    case 'PushRejectedError':
      return 'The remote rejected the push. Pull first, then push again.';
    case 'NotFoundError':
      return `Not found: ${e.data?.what ?? 'a git object'}. The repository may use a feature this browser git doesn't support.`;
    case 'UnmergedPathsError':
      return 'There are unresolved merge conflicts. Resolve them with the git CLI first.';
    default:
      return e?.message ?? String(e);
  }
}
