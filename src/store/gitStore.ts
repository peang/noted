import { create } from 'zustand';
import { toast } from 'sonner';
import { useNoteStore } from './noteStore';
import * as client from '../git/gitClient';
import type { GitChange, GitIdentity, GitSnapshot } from '../git/gitClient';

export type GitBusy = null | 'fetch' | 'pull' | 'push' | 'commit' | 'checkout';
type NetworkAction = 'fetch' | 'pull' | 'push';

// Shown when a remote operation needs a token or an https address first
export interface GitAuthPrompt {
  host: string;
  message: string;
  needsUrl: boolean;
  httpsUrl: string;
  retry: NetworkAction;
}

interface GitState extends GitSnapshot {
  availability: 'none' | 'repo' | 'unsupported';
  unsupportedReason: string | null;
  busy: GitBusy;
  refreshing: boolean;
  authPrompt: GitAuthPrompt | null;
  commitOpen: boolean;

  refresh: () => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  commit: (message: string, selected: GitChange[], identity: GitIdentity, thenPush: boolean) => Promise<boolean>;
  checkout: (name: string, create: boolean) => Promise<boolean>;
  loadIdentity: () => Promise<GitIdentity | null>;
  saveRemoteSettings: (settings: { httpsUrl: string; token: string }) => Promise<void>;
  dismissAuthPrompt: () => void;
  setCommitOpen: (open: boolean) => void;
}

const EMPTY: GitSnapshot = {
  branch: null,
  detachedAt: null,
  changes: [],
  branches: [],
  remoteOnlyBranches: [],
  upstream: null,
  remoteUrl: null,
};

// Used only for the merge commit a diverged pull creates, when the repo has no identity yet
const FALLBACK_IDENTITY: GitIdentity = { name: 'Noted', email: 'noted@localhost' };

function openedFolder(): FileSystemDirectoryHandle | null {
  const { isSimulated, rootHandle } = useNoteStore.getState();
  return !isSimulated && rootHandle ? rootHandle : null;
}

const repoKey = () => useNoteStore.getState().folderName;

// Resolves where to talk to; throws GitAuthError when the user has to supply the https address
function resolveRemote(remoteUrl: string | null): client.RemoteContext {
  if (!remoteUrl) throw new Error('This repository has no "origin" remote.');
  const parsed = client.parseRemote(remoteUrl);
  const httpsUrl = client.getSavedHttpsUrl(repoKey()) || parsed.httpsUrl;
  if (!httpsUrl) {
    throw new client.GitAuthError(
      parsed.host ?? '',
      true,
      parsed.kind === 'ssh'
        ? `The browser can't use SSH ("${remoteUrl}"). Give the https address of this repository.`
        : 'Give the https address of this repository.',
    );
  }
  const host = client.hostOfUrl(httpsUrl);
  return { httpsUrl, host, token: client.getToken(host) };
}

let refreshInFlight: Promise<void> | null = null;
let refreshAgain = false;

async function readIntoStore(set: (partial: Partial<GitState>) => void): Promise<void> {
  const root = openedFolder();
  if (!root) {
    set({ ...EMPTY, availability: 'none', unsupportedReason: null });
    return;
  }
  try {
    const kind = await client.hasGitDirectory(root);
    if (openedFolder() !== root) return;
    if (kind === 'none') {
      set({ ...EMPTY, availability: 'none', unsupportedReason: null });
    } else if (kind === 'file') {
      set({ ...EMPTY, availability: 'unsupported', unsupportedReason: 'This folder is a git worktree or submodule, which Noted does not support yet.' });
    } else {
      const snapshot = await client.readSnapshot(root);
      if (openedFolder() === root) set({ ...snapshot, availability: 'repo', unsupportedReason: null });
    }
  } catch (e) {
    if (openedFolder() === root) {
      set({ ...EMPTY, availability: 'unsupported', unsupportedReason: client.describeGitError(e) });
    }
  }
}

export const useGitStore = create<GitState>((set, get) => ({
  ...EMPTY,
  availability: 'none',
  unsupportedReason: null,
  busy: null,
  refreshing: false,
  authPrompt: null,
  commitOpen: false,

  // Local only (no network): safe to run in the background. A call that arrives while a read is
  // already running makes it read again afterwards, so callers never get a result older than their call.
  refresh: async () => {
    if (refreshInFlight) {
      refreshAgain = true;
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      set({ refreshing: true });
      try {
        do {
          refreshAgain = false;
          await readIntoStore(set);
        } while (refreshAgain);
      } finally {
        set({ refreshing: false });
      }
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  },

  fetch: () => runNetwork('fetch'),
  pull: () => runNetwork('pull'),
  push: () => runNetwork('push'),

  commit: async (message, selected, identity, thenPush) => {
    const root = openedFolder();
    if (!root || get().busy) return false;
    set({ busy: 'commit' });
    const selectedPaths = new Set(selected.map((c) => c.path));
    try {
      client.setSavedIdentity(identity);
      const sha = await client.commitChanges(
        root,
        selected,
        get().changes.filter((c) => !selectedPaths.has(c.path)),
        message,
        identity,
      );
      toast.success(`Committed ${sha.slice(0, 7)}`);
    } catch (e) {
      toast.error(client.describeGitError(e));
      set({ busy: null });
      return false;
    }
    await get().refresh();
    set({ busy: null, commitOpen: false });
    if (thenPush) await get().push();
    return true;
  },

  checkout: async (name, create) => {
    const root = openedFolder();
    if (!root || get().busy) return false;
    set({ busy: 'checkout' });
    try {
      await client.switchBranch(root, name, create);
      await reloadWorkspace();
      toast.success(create ? `Created and switched to ${name}` : `Switched to ${name}`);
      return true;
    } catch (e) {
      toast.error(client.describeGitError(e));
      return false;
    } finally {
      await get().refresh();
      set({ busy: null });
    }
  },

  loadIdentity: async () => {
    const root = openedFolder();
    if (!root) return null;
    return (await client.readConfiguredIdentity(root).catch(() => null)) ?? client.getSavedIdentity();
  },

  saveRemoteSettings: async ({ httpsUrl, token }) => {
    const prompt = get().authPrompt;
    if (!prompt) return;
    const url = httpsUrl.trim();
    if (url) client.setSavedHttpsUrl(repoKey(), url);
    const host = url ? client.hostOfUrl(url) : prompt.host;
    if (host) client.setToken(host, token.trim());
    set({ authPrompt: null });
    await runNetwork(prompt.retry);
  },

  dismissAuthPrompt: () => set({ authPrompt: null }),
  setCommitOpen: (open) => set({ commitOpen: open }),
}));

// After the files on disk changed under the editor (pull, checkout)
async function reloadWorkspace() {
  const { refreshFolder, activeTab, openFile } = useNoteStore.getState();
  await refreshFolder();
  const { workspacePaths } = useNoteStore.getState();
  if (activeTab && workspacePaths.includes(activeTab)) await openFile(activeTab);
}

async function runNetwork(action: NetworkAction): Promise<void> {
  const root = openedFolder();
  const { busy, branch, remoteUrl } = useGitStore.getState();
  if (!root || busy) return;
  const set = useGitStore.setState;

  let ctx: client.RemoteContext;
  try {
    ctx = resolveRemote(remoteUrl);
  } catch (e) {
    if (e instanceof client.GitAuthError) {
      set({ authPrompt: { host: e.host, message: e.message, needsUrl: true, httpsUrl: '', retry: action } });
    } else {
      toast.error((e as Error).message);
    }
    return;
  }
  if ((action === 'pull' || action === 'push') && !branch) {
    toast.error('Switch to a branch first: HEAD is detached.');
    return;
  }

  set({ busy: action });
  try {
    if (action === 'fetch') {
      await client.fetchRemote(root, ctx);
      toast.success('Fetched from origin');
    } else if (action === 'pull') {
      const identity = (await useGitStore.getState().loadIdentity()) ?? FALLBACK_IDENTITY;
      await client.pullBranch(root, branch!, ctx, identity);
      await reloadWorkspace();
      toast.success(`Pulled ${branch}`);
    } else {
      await client.pushBranch(root, branch!, ctx);
      toast.success(`Pushed ${branch}`);
    }
  } catch (e) {
    if (e instanceof client.GitAuthError) {
      set({ authPrompt: { host: e.host, message: e.message, needsUrl: e.needsUrl, httpsUrl: ctx.httpsUrl, retry: action } });
    } else {
      toast.error(client.describeGitError(e));
    }
  } finally {
    await useGitStore.getState().refresh();
    set({ busy: null });
  }
}

// ---------------------------------------------------------------- keeping the status current

// Another folder was opened (or the sandbox returned)
let lastRoot = openedFolder();
let lastTree = useNoteStore.getState().fileTree;
let treeTimer: ReturnType<typeof setTimeout> | undefined;

useNoteStore.subscribe((state) => {
  const root = !state.isSimulated && state.rootHandle ? state.rootHandle : null;
  if (root !== lastRoot) {
    lastRoot = root;
    useGitStore.setState({ ...EMPTY, availability: 'none', unsupportedReason: null, commitOpen: false, authPrompt: null });
    void useGitStore.getState().refresh();
    return;
  }
  // Files were created, moved or deleted (editor, sidebar, chat tools)
  if (state.fileTree !== lastTree) {
    lastTree = state.fileTree;
    clearTimeout(treeTimer);
    treeTimer = setTimeout(() => void useGitStore.getState().refresh(), 3000);
  }
});

// Edits made elsewhere (an editor, the git CLI) show up when the user comes back to the tab
const REFRESH_MIN_GAP_MS = 20_000;
let lastRefreshAt = 0;
const refreshIfStale = () => {
  if (document.hidden || useGitStore.getState().availability === 'none') return;
  if (Date.now() - lastRefreshAt < REFRESH_MIN_GAP_MS) return;
  lastRefreshAt = Date.now();
  void useGitStore.getState().refresh();
};
if (typeof window !== 'undefined') {
  window.addEventListener('focus', refreshIfStale);
  document.addEventListener('visibilitychange', refreshIfStale);
  setInterval(refreshIfStale, 60_000);
}

// The folder may already be open by the time this module loads
void useGitStore.getState().refresh();
