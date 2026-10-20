import { useNoteStore, buildTreeFromPaths, getFilesRecursively, filterRealFileTree } from './noteStore';

// What the approval card shows for a batch action
export interface PendingAction {
  kind: 'move' | 'delete';
  items: { label: string; detail?: string }[];
  notes: string[];
  // Shown in red, e.g. that a delete is permanent
  warning?: string;
}

export const MAX_MOVES = 100;
export const MAX_DELETES = 50;
const MAX_SEARCH_RESULTS = 60;
const MAX_SEARCH_LINE_CHARS = 160;
const MAX_SEARCHABLE_CHARS = 1_000_000;
const READ_BATCH = 24;
const SIMULATED_FILES_KEY = 'noted_simulated_files';
const BINARY_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'zip', 'gz', 'mp3', 'mp4', 'mov', 'wav', 'woff', 'woff2', 'ttf',
]);

// ---------------------------------------------------------------- paths and files

// Tool paths come from the model: keep them relative, inside the workspace and away from hidden files
export function validateToolPath(path: string): string | null {
  const parts = path.split('/');
  if (path.startsWith('/') || parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.'))) {
    return `Error: Invalid path "${path}". Use a relative path to a visible file in the workspace.`;
  }
  return null;
}

function isHiddenPath(path: string): boolean {
  return path.split('/').some((s) => s.startsWith('.'));
}

function normalizeToolPath(path: string): string {
  return path.trim().replace(/^\.\//, '').replace(/\/+$/, '');
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

// Visible files and folders of the open workspace (sandbox or real folder)
function workspaceEntries(): { files: string[]; folders: string[] } {
  const state = useNoteStore.getState();
  if (state.isSimulated) {
    return {
      files: state.simulatedFiles.filter((f) => f.kind === 'file' && !isHiddenPath(f.path)).map((f) => f.path),
      folders: state.simulatedFiles.filter((f) => f.kind === 'directory' && !isHiddenPath(f.path)).map((f) => f.path),
    };
  }
  return {
    files: state.workspacePaths.filter((p) => !p.endsWith('/') && !isHiddenPath(p)),
    folders: state.workspacePaths.filter((p) => p.endsWith('/') && !isHiddenPath(p)).map((p) => p.replace(/\/+$/, '')),
  };
}

// Returns null when the file doesn't exist
export async function readExistingFile(path: string): Promise<string | null> {
  const { isSimulated, simulatedFiles, rootHandle } = useNoteStore.getState();
  if (isSimulated) {
    const file = simulatedFiles.find((f) => f.path === path && f.kind === 'file');
    return file ? file.content || '' : null;
  }
  if (!rootHandle) return null;
  try {
    const parts = path.split('/');
    const fileName = parts.pop()!;
    let dirHandle = rootHandle;
    for (const part of parts) {
      dirHandle = await dirHandle.getDirectoryHandle(part);
    }
    const file = await (await dirHandle.getFileHandle(fileName)).getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function readTextFiles(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < paths.length; i += READ_BATCH) {
    await Promise.all(paths.slice(i, i + READ_BATCH).map(async (path) => {
      const text = await readExistingFile(path);
      if (text !== null) out.set(path, text);
    }));
  }
  return out;
}

export async function executeWriteFile(path: string, content: string): Promise<string> {
  const state = useNoteStore.getState();
  const { isSimulated, simulatedFiles, rootHandle } = state;

  if (isSimulated) {
    const idx = simulatedFiles.findIndex((f) => f.path === path);
    const newFiles = idx >= 0
      ? simulatedFiles.map((f, i) => i === idx ? { ...f, content } : f)
      : [...simulatedFiles, { path, kind: 'file' as const, content }];
    const tree = buildTreeFromPaths(newFiles, state.collapsedFolders, state.searchQuery);
    const updates: Record<string, any> = { simulatedFiles: newFiles, fileTree: tree };
    if (state.activeTab === path) updates.activeContent = content;
    useNoteStore.setState(updates);
    try {
      localStorage.setItem(SIMULATED_FILES_KEY, JSON.stringify(newFiles));
    } catch {
      // Storage full: the sandbox copy still lives in memory
    }
    return `Written "${path}".`;
  }

  if (!rootHandle) return 'Error: No root folder open.';

  try {
    const parts = path.split('/');
    const fileName = parts.pop();
    if (!fileName) return `Error: Invalid path "${path}".`;

    let dirHandle = rootHandle;
    for (const part of parts) {
      dirHandle = await dirHandle.getDirectoryHandle(part, { create: true });
    }

    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    const tree = await getFilesRecursively(rootHandle, '', state.collapsedFolders);
    const updates2: Record<string, any> = { fileTree: filterRealFileTree(tree, state.searchQuery) };
    if (state.activeTab === path) updates2.activeContent = content;
    useNoteStore.setState(updates2);

    return `Written "${path}".`;
  } catch (e: any) {
    return `Error writing "${path}": ${e.message}`;
  }
}

// Rescans a real folder so workspacePaths (what the tools and @-mentions use) matches the disk
async function refreshWorkspace(): Promise<void> {
  const state = useNoteStore.getState();
  if (!state.isSimulated && state.rootHandle) {
    await state.refreshFolder();
  }
}

// ---------------------------------------------------------------- wikilinks

// [[target]], [[target|alias]], [[target#heading]], also as ![[embed]]; group 2 keeps "#heading|alias"
const WIKILINK = /\[\[([^\]|#\n]+)([^\]\n]*)\]\]/g;

// Notes are linked without ".md"; other files (images, pdf) keep their extension
function linkKey(path: string): string {
  return path.replace(/\.md$/i, '');
}

function baseName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

interface LinkIndex {
  byFull: Map<string, string>;
  byBase: Map<string, string[]>;
}

function buildLinkIndex(paths: string[]): LinkIndex {
  const byFull = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const key = linkKey(p).toLowerCase();
    byFull.set(key, p);
    const base = baseName(key);
    byBase.set(base, [...(byBase.get(base) ?? []), p]);
  }
  return { byFull, byBase };
}

// Same rules as Obsidian: a full path matches exactly, a bare name matches by file name
// (the one next to the linking note wins, otherwise the shortest path)
function resolveLink(index: LinkIndex, target: string, fromPath: string): string | null {
  const t = linkKey(target.trim()).toLowerCase();
  if (!t) return null;
  const exact = index.byFull.get(t);
  if (exact) return exact;
  if (t.includes('/')) return null;
  const candidates = index.byBase.get(t);
  if (!candidates?.length) return null;
  const folder = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
  return candidates.find((c) => c.startsWith(folder) && !c.slice(folder.length).includes('/'))
    ?? [...candidates].sort((a, b) => a.length - b.length)[0];
}

function planLinkUpdates(
  moves: Map<string, string>,
  contents: Map<string, string>,
  pathsBefore: string[],
): { updates: Map<string, string>; links: number } {
  const before = buildLinkIndex(pathsBefore);
  const after = buildLinkIndex(pathsBefore.map((p) => moves.get(p) ?? p));
  const updates = new Map<string, string>();
  let links = 0;

  for (const [path, text] of contents) {
    let changed = false;
    const next = text.replace(WIKILINK, (match, target: string, rest: string) => {
      const resolved = resolveLink(before, target, path);
      const destination = resolved ? moves.get(resolved) : undefined;
      if (!destination) return match;

      const newKey = linkKey(destination);
      // A bare-name link stays bare unless the new name would now be ambiguous
      const bare = !target.includes('/') && (after.byBase.get(baseName(newKey).toLowerCase())?.length ?? 0) <= 1;
      const newTarget = bare ? baseName(newKey) : newKey;
      if (newTarget === target.trim()) return match;
      changed = true;
      links++;
      return `[[${newTarget}${rest}]]`;
    });
    if (changed) updates.set(path, next);
  }
  return { updates, links };
}

function countInboundLinks(deleted: Set<string>, contents: Map<string, string>, allPaths: string[]): { links: number; notes: number } {
  const index = buildLinkIndex(allPaths);
  let links = 0;
  let notes = 0;
  for (const [path, text] of contents) {
    if (deleted.has(path)) continue;
    let hit = 0;
    for (const m of text.matchAll(WIKILINK)) {
      const resolved = resolveLink(index, m[1], path);
      if (resolved && deleted.has(resolved)) hit++;
    }
    if (hit) {
      links += hit;
      notes++;
    }
  }
  return { links, notes };
}

// ---------------------------------------------------------------- search_files

export async function executeSearchFiles(query: unknown, folder: unknown, useRegex: unknown): Promise<string> {
  if (typeof query !== 'string' || !query.trim()) return 'Error: "query" must be a non-empty string.';
  if (query.length > 200) return 'Error: "query" is too long (max 200 characters).';

  let matches: (line: string) => boolean;
  if (useRegex === true) {
    try {
      const re = new RegExp(query, 'i');
      matches = (line) => re.test(line);
    } catch (e: any) {
      return `Error: Invalid regular expression: ${e.message}`;
    }
  } else {
    const needle = query.toLowerCase();
    matches = (line) => line.toLowerCase().includes(needle);
  }

  const prefix = typeof folder === 'string' ? normalizeToolPath(folder) : '';
  if (prefix) {
    const error = validateToolPath(prefix);
    if (error) return error;
  }
  const paths = workspaceEntries().files
    .filter((p) => (!prefix || p.startsWith(prefix + '/')) && !BINARY_EXTENSIONS.has(extensionOf(p)))
    .sort();
  if (paths.length === 0) return `No searchable files${prefix ? ` in "${prefix}"` : ''}.`;

  const results: string[] = [];
  let filesWithMatches = 0;
  let totalMatches = 0;
  let searched = 0;
  for (let i = 0; i < paths.length; i += READ_BATCH) {
    const batch = paths.slice(i, i + READ_BATCH);
    const texts = await readTextFiles(batch);
    for (const path of batch) {
      const text = texts.get(path);
      if (text === undefined || text.length > MAX_SEARCHABLE_CHARS) continue;
      searched++;
      let hit = false;
      text.split('\n').forEach((line, n) => {
        if (!matches(line)) return;
        hit = true;
        totalMatches++;
        if (results.length < MAX_SEARCH_RESULTS) {
          const trimmed = line.trim();
          results.push(`${path}:${n + 1}: ${trimmed.length > MAX_SEARCH_LINE_CHARS ? trimmed.slice(0, MAX_SEARCH_LINE_CHARS) + '…' : trimmed}`);
        }
      });
      if (hit) filesWithMatches++;
    }
    // Enough to answer from; reading the rest of a large workspace would only cost time
    if (results.length >= MAX_SEARCH_RESULTS) break;
  }

  const done = searched < paths.length && results.length >= MAX_SEARCH_RESULTS;
  const header = totalMatches === 0
    ? `No matches for "${query}" in ${searched} files.`
    : `${totalMatches}${done ? '+' : ''} match${totalMatches !== 1 ? 'es' : ''} in ${filesWithMatches} file${filesWithMatches !== 1 ? 's' : ''}` +
      `${done ? ` (stopped after ${searched} of ${paths.length} files; narrow it with "folder")` : ''}` +
      `${totalMatches > results.length ? `, showing the first ${results.length}` : ''}:`;
  return [header, ...results].join('\n');
}

// ---------------------------------------------------------------- move_files

export interface MovePlan {
  moves: { from: string; to: string }[];
  contents: Map<string, string>;
  pathsBefore: string[];
  updateLinks: boolean;
}

export async function planMoves(raw: unknown, updateLinks: boolean): Promise<{ error: string } | { plan: MovePlan; action: PendingAction }> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Error: "moves" must be a non-empty array of {from, to}.' };
  if (raw.length > MAX_MOVES) return { error: `Error: At most ${MAX_MOVES} moves per call; split the batch.` };

  const { files, folders } = workspaceEntries();
  const fileSet = new Set(files);
  const folderSet = new Set(folders);
  const moves: { from: string; to: string }[] = [];
  const errors: string[] = [];
  const targets = new Set<string>();

  raw.forEach((item, i) => {
    if (typeof item?.from !== 'string' || typeof item?.to !== 'string') {
      errors.push(`Move #${i + 1}: needs string "from" and "to".`);
      return;
    }
    const from = normalizeToolPath(item.from);
    let to = normalizeToolPath(item.to);
    const bad = validateToolPath(from) ?? validateToolPath(to);
    if (bad) { errors.push(`${item.from} → ${item.to}: ${bad.replace(/^Error: /, '')}`); return; }
    if (/\.md$/i.test(from) && !/\.md$/i.test(to)) to += '.md';
    if (folderSet.has(from)) { errors.push(`${from}: is a folder; move_files only moves files.`); return; }
    if (!fileSet.has(from)) { errors.push(`${from}: file not found.`); return; }
    if (from === to) { errors.push(`${from}: source and destination are the same.`); return; }
    if (fileSet.has(to) || folderSet.has(to)) { errors.push(`${from} → ${to}: destination already exists.`); return; }
    if (targets.has(to)) { errors.push(`${from} → ${to}: two moves share this destination.`); return; }
    const parts = to.split('/');
    for (let k = 1; k < parts.length; k++) {
      if (fileSet.has(parts.slice(0, k).join('/'))) { errors.push(`${from} → ${to}: "${parts.slice(0, k).join('/')}" is a file, not a folder.`); return; }
    }
    targets.add(to);
    moves.push({ from, to });
  });
  if (errors.length) return { error: `Nothing was moved. Fix these and call move_files again:\n${errors.join('\n')}` };

  let contents = new Map<string, string>();
  let linkCount = 0;
  let linkNotes = 0;
  if (updateLinks) {
    contents = await readTextFiles(files.filter((p) => /\.md$/i.test(p)));
    const { updates, links } = planLinkUpdates(new Map(moves.map((m) => [m.from, m.to])), contents, files);
    linkCount = links;
    linkNotes = updates.size;
  }

  const notes = [
    updateLinks
      ? linkCount > 0
        ? `${linkCount} wikilink${linkCount !== 1 ? 's' : ''} in ${linkNotes} note${linkNotes !== 1 ? 's' : ''} will be updated.`
        : 'No wikilinks point at these files.'
      : 'Wikilinks will not be updated.',
  ];
  return {
    plan: { moves, contents, pathsBefore: files, updateLinks },
    action: { kind: 'move', items: moves.map((m) => ({ label: m.from, detail: m.to })), notes },
  };
}

// Moves one file, creating missing folders; rewrites open tabs. Throws when it can't.
async function moveWorkspaceFile(from: string, to: string): Promise<void> {
  const state = useNoteStore.getState();

  if (state.isSimulated) {
    const files = state.simulatedFiles;
    if (!files.some((f) => f.path === from && f.kind === 'file')) throw new Error('file not found');
    if (files.some((f) => f.path === to)) throw new Error('destination already exists');
    const known = new Set(files.filter((f) => f.kind === 'directory').map((f) => f.path));
    const parts = to.split('/');
    const folders: typeof files = [];
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!known.has(dir)) {
        known.add(dir);
        folders.push({ path: dir, kind: 'directory' });
      }
    }
    const newFiles = [...files.map((f) => (f.path === from ? { ...f, path: to } : f)), ...folders];
    try {
      localStorage.setItem(SIMULATED_FILES_KEY, JSON.stringify(newFiles));
    } catch {
      // Storage full: the sandbox copy still lives in memory
    }
    useNoteStore.setState({
      simulatedFiles: newFiles,
      fileTree: buildTreeFromPaths(newFiles, state.collapsedFolders, state.searchQuery),
    });
  } else {
    const root = state.rootHandle;
    if (!root) throw new Error('no folder is open');
    const fromParts = from.split('/');
    const fromName = fromParts.pop()!;
    let sourceDir = root;
    for (const part of fromParts) sourceDir = await sourceDir.getDirectoryHandle(part);
    const source = await sourceDir.getFileHandle(fromName);

    const toParts = to.split('/');
    const toName = toParts.pop()!;
    let targetDir = root;
    for (const part of toParts) targetDir = await targetDir.getDirectoryHandle(part, { create: true });

    let exists = true;
    try {
      await targetDir.getFileHandle(toName);
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') throw e;
      exists = false;
    }
    if (exists) throw new Error('destination already exists');

    let moved = false;
    if (typeof (source as any).move === 'function') {
      try {
        await (source as any).move(targetDir, toName);
        moved = true;
      } catch {
        // Not supported for this handle: fall back to copying
      }
    }
    if (!moved) {
      const target = await targetDir.getFileHandle(toName, { create: true });
      const writable = await target.createWritable();
      await writable.write(await source.getFile());
      await writable.close();
      await sourceDir.removeEntry(fromName);
    }
  }

  useNoteStore.setState((s) => ({
    openTabs: s.openTabs.map((t) => (t === from ? to : t)),
    activeTab: s.activeTab === from ? to : s.activeTab,
  }));
}

export async function runMoves(plan: MovePlan): Promise<string> {
  const done = new Map<string, string>();
  const failed: string[] = [];
  for (const { from, to } of plan.moves) {
    try {
      await moveWorkspaceFile(from, to);
      done.set(from, to);
    } catch (e: any) {
      failed.push(`${from} → ${to}: ${e.message}`);
    }
  }

  let updatedLinks = 0;
  let updatedNotes = 0;
  if (plan.updateLinks && done.size > 0) {
    const { updates, links } = planLinkUpdates(done, plan.contents, plan.pathsBefore);
    for (const [path, text] of updates) {
      const result = await executeWriteFile(done.get(path) ?? path, text);
      if (result.startsWith('Error')) failed.push(`${path}: could not update links (${result})`);
      else updatedNotes++;
    }
    updatedLinks = links;
  }

  await refreshWorkspace();
  // Reload the open file from its new location so the editor keeps working on the right handle
  const { activeTab, openFile } = useNoteStore.getState();
  if (activeTab && [...done.values()].includes(activeTab)) await openFile(activeTab);

  const parts = [`Moved ${done.size} of ${plan.moves.length} file${plan.moves.length !== 1 ? 's' : ''}.`];
  if (plan.updateLinks) parts.push(`Updated ${updatedLinks} wikilink${updatedLinks !== 1 ? 's' : ''} in ${updatedNotes} note${updatedNotes !== 1 ? 's' : ''}.`);
  if (failed.length) parts.push(`Failed:\n${failed.join('\n')}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- delete_files

export interface DeletePlan {
  paths: string[];
}

export async function planDeletes(raw: unknown): Promise<{ error: string } | { plan: DeletePlan; action: PendingAction }> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Error: "paths" must be a non-empty array of strings.' };
  if (raw.length > MAX_DELETES) return { error: `Error: At most ${MAX_DELETES} paths per call; split the batch.` };

  const { files, folders } = workspaceEntries();
  const fileSet = new Set(files);
  const folderSet = new Set(folders);
  const errors: string[] = [];
  const requested = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') { errors.push('Every path must be a string.'); continue; }
    const path = normalizeToolPath(item);
    const bad = validateToolPath(path);
    if (bad) { errors.push(`${item}: ${bad.replace(/^Error: /, '')}`); continue; }
    if (!fileSet.has(path) && !folderSet.has(path)) { errors.push(`${path}: not found.`); continue; }
    requested.add(path);
  }
  if (errors.length) return { error: `Nothing was deleted. Fix these and call delete_files again:\n${errors.join('\n')}` };

  // A folder already covers everything inside it
  const paths = [...requested].filter((p) => ![...requested].some((q) => q !== p && p.startsWith(q + '/'))).sort();
  const underAny = (file: string) => paths.some((p) => file === p || file.startsWith(p + '/'));
  const doomed = files.filter(underAny);
  if (files.length > 4 && doomed.length > files.length / 2) {
    return { error: `Error: Refusing to delete ${doomed.length} of ${files.length} files in one call. Delete in smaller steps.` };
  }

  const contents = await readTextFiles(files.filter((p) => /\.md$/i.test(p)));
  const { links, notes: linking } = countInboundLinks(new Set(doomed), contents, files);
  const state = useNoteStore.getState();
  const notes = links > 0
    ? [`${links} wikilink${links !== 1 ? 's' : ''} in ${linking} other note${linking !== 1 ? 's' : ''} will stop working.`]
    : ['No other note links to these files.'];

  return {
    plan: { paths },
    action: {
      kind: 'delete',
      items: paths.map((p) => {
        if (!folderSet.has(p)) return { label: p };
        const inside = files.filter((f) => f.startsWith(p + '/')).length;
        return { label: p + '/', detail: `folder with ${inside} file${inside !== 1 ? 's' : ''}` };
      }),
      notes,
      warning: state.isSimulated ? undefined : 'Permanent: files are removed from your disk, not moved to the trash.',
    },
  };
}

export async function runDeletes(plan: DeletePlan): Promise<string> {
  const { deleteNode } = useNoteStore.getState();
  let deleted = 0;
  const failed: string[] = [];
  for (const path of plan.paths) {
    try {
      await deleteNode(path);
      deleted++;
    } catch (e: any) {
      failed.push(`${path}: ${e.message}`);
    }
  }
  await refreshWorkspace();
  return [`Deleted ${deleted} of ${plan.paths.length} path${plan.paths.length !== 1 ? 's' : ''}.`, failed.length ? `Failed:\n${failed.join('\n')}` : '']
    .filter(Boolean).join(' ');
}
