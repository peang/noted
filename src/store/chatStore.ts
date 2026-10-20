import { create } from 'zustand';
import { useNoteStore, buildTreeFromPaths, getFilesRecursively, filterRealFileTree } from './noteStore';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface ChatState {
  apiKey: string | null;
  messages: Message[];
  model: string;
  availableModels: { id: string; name: string }[];
  isLoading: boolean;
  chatError: string | null;
  lastUsage: { prompt: number; completion: number; reasoning: number } | null;
  aiStatus: string | null;
  // oldContent is null when the AI is creating a new file
  pendingWrite: { path: string; content: string; oldContent: string | null } | null;

  setApiKey: (key: string) => Promise<void>;
  clearApiKey: () => void;
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  fetchModels: () => Promise<void>;
  setModel: (model: string) => void;
  clearChat: () => void;
  approveWrite: () => void;
  rejectWrite: () => void;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Quota full or storage blocked — keep the in-memory state, don't break the chat
    console.warn(`Failed to save "${key}" to localStorage`, e);
  }
}

function getSessionId(): string {
  let id = localStorage.getItem(STORAGE_KEY_SESSION);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY_SESSION, id);
  }
  return id;
}

// Some models (e.g. DeepSeek) write tool calls as raw `<｜DSML｜invoke ...>` markup in the
// text instead of structured tool_calls. The bars may be full-width or ASCII, with stray spaces.
const TOOL_MARKUP_START = /<[|｜\s]*DSML/;
const TOOL_MARKUP_INVOKE = /<[|｜\s]*DSML[|｜\s]*invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/[|｜\s]*DSML[|｜\s]*invoke\s*>/g;
const TOOL_MARKUP_PARAM = /<[|｜\s]*DSML[|｜\s]*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/[|｜\s]*DSML[|｜\s]*parameter\s*>/g;

function stripToolMarkup(text: string): string {
  const m = TOOL_MARKUP_START.exec(text);
  return m ? text.slice(0, m.index).trim() : text;
}

function parseToolMarkup(text: string): { name: string; args: Record<string, string> }[] {
  const calls: { name: string; args: Record<string, string> }[] = [];
  for (const inv of text.matchAll(TOOL_MARKUP_INVOKE)) {
    const args: Record<string, string> = {};
    for (const p of inv[2].matchAll(TOOL_MARKUP_PARAM)) args[p[1]] = p[2];
    calls.push({ name: inv[1], args });
  }
  return calls;
}

export function stripSystemReminder(text: string): string {
  if (text.includes('<system-reminder>') && !text.includes('</system-reminder>')) {
    const idx = text.indexOf('<system-reminder>');
    return stripToolMarkup(text.slice(0, idx).trim());
  }
  return stripToolMarkup(text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim());
}

function getAllFilePaths(): string[] {
  const state = useNoteStore.getState();
  if (state.isSimulated) {
    return state.simulatedFiles.filter(f => f.kind === 'file').map(f => f.path);
  }
  return state.workspacePaths.filter(p => !p.endsWith('/'));
}

function extractFileRefs(message: string): string[] {
  const allPaths = getAllFilePaths();
  allPaths.sort((a, b) => b.length - a.length);
  const occupied = new Set<number>();
  const refs: string[] = [];

  for (const path of allPaths) {
    const search = `@${path}`;
    let idx = 0;
    while (idx < message.length) {
      const found = message.indexOf(search, idx);
      if (found === -1) break;
      const end = found + search.length;
      const isOccupied = Array.from(occupied).some(pos => pos >= found && pos < end);
      if (!isOccupied) {
        const prev = message[found - 1];
        if (found === 0 || /[\s\n.,;:!?)]/.test(prev)) {
          for (let i = found; i < end; i++) occupied.add(i);
          refs.push(path);
          break;
        }
      }
      idx = found + 1;
    }
  }
  return refs;
}

function stripRefPrefixes(content: string): string {
  const allPaths = getAllFilePaths();
  allPaths.sort((a, b) => b.length - a.length);
  let result = content;
  for (const path of allPaths) {
    result = result.replaceAll(`@${path}`, path);
  }
  return result;
}

async function buildFullTree(
  isSimulated: boolean,
  simulatedFiles: { path: string; kind: string }[],
  workspacePaths: string[],
  workspaceCounts: { files: number; folders: number }
): Promise<string> {
  if (isSimulated) {
    const dirs = new Set<string>();
    const lines: string[] = [];
    for (const f of simulatedFiles) {
      if (f.path.split('/').some(s => s.startsWith('.'))) continue;
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join('/');
        if (!dirs.has(dirPath)) {
          dirs.add(dirPath);
          lines.push(`${'  '.repeat(i - 1)}📁 ${parts[i - 1]}/`);
        }
      }
      lines.push(`${'  '.repeat(parts.length - 1)}📄 ${parts[parts.length - 1]}`);
    }
    const count = simulatedFiles.filter(f => f.kind === 'file' && !f.path.split('/').some(s => s.startsWith('.'))).length;
    return `📁 Workspace (${count} files)\n${lines.join('\n')}`;
  }

  if (workspacePaths.length === 0) return '(empty)';

  const lines = workspacePaths
    .filter(p => !p.split('/').some(s => s.startsWith('.')))
    .map(p => {
      const depth = p.replace(/\/$/, '').split('/').length - 1;
      const indent = '  '.repeat(depth);
      const isDir = p.endsWith('/');
      const name = isDir ? p.split('/').slice(-2, -1)[0] + '/' : p.split('/').pop() || '';
      return `${indent}${isDir ? '📁' : '📄'} ${name}`;
    });

  return `📁 Workspace (${workspaceCounts.files} files, ${workspaceCounts.folders} folders)\n${lines.join('\n')}`;
}

async function buildWorkspaceContext(userMessage?: string): Promise<string> {
  const state = useNoteStore.getState();
  const { folderName, isSimulated, simulatedFiles, workspacePaths, workspaceCounts, activeTab, activeContent } = state;

  const treePreview = await buildFullTree(isSimulated, simulatedFiles, workspacePaths, workspaceCounts);

  const parts: string[] = [
    `You are a helpful AI assistant for a note-taking workspace called "${folderName}".`,
    `The workspace is stored on ${isSimulated ? 'a simulated in-memory filesystem' : 'the local disk directory'}.\n`,
    `FORMATTING: Use **bold** for emphasis and *italic* for subtle emphasis. No headings, no tables, no code blocks, no markdown block syntax. Just plain text with bold/italic where needed.\n`,
    `Current workspace file structure:`,
    treePreview,
  ];

  let content = activeContent;
  if (activeTab && !content) {
    await useNoteStore.getState().openFile(activeTab);
    content = useNoteStore.getState().activeContent;
  }

  if (activeTab && content) {
    const truncated = content.length > MAX_ACTIVE_CONTENT_CHARS;
    parts.push(`The user currently has "${activeTab}" open with the following content${truncated ? ' (truncated — use read_file for the full file)' : ''}:`);
    parts.push('```' + activeTab.split('.').pop() + '');
    parts.push(truncated ? content.slice(0, MAX_ACTIVE_CONTENT_CHARS) : content);
    parts.push('```');
  } else if (activeTab) {
    parts.push(`The user currently has "${activeTab}" open.`);
  }

  if (userMessage) {
    const refs = extractFileRefs(userMessage);
    if (refs.length > 0) {
      parts.push('User referenced files in their message (denoted by @path):');
      parts.push(refs.map(p => `- ${p}`).join('\n'));
    }
  }

  parts.push('You have tools `read_file` and `write_file`. When you need to read a file, ALWAYS use the read_file tool — do NOT output the file path as text. Use write_file to create a new file or update an existing one. write_file replaces the whole file, so read_file first and always send the complete content.');
  parts.push('Be brief and direct. No pleasantries, no disclaimers, no explanations. Just answer the question and stop. Answer based only on the notes provided.');

  return parts.join('\n');
}

// Tool paths come from the model: keep them relative, inside the workspace and away from hidden files
function validateToolPath(path: string): string | null {
  const parts = path.split('/');
  if (path.startsWith('/') || parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.'))) {
    return `Error: Invalid path "${path}". Use a relative path to a visible file in the workspace.`;
  }
  return null;
}

// Returns null when the file doesn't exist
async function readExistingFile(path: string): Promise<string | null> {
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

async function executeWriteFile(path: string, content: string): Promise<string> {
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

async function executeReadFile(path: string): Promise<string> {
  const state = useNoteStore.getState();
  const { isSimulated, simulatedFiles, rootHandle } = state;

  if (isSimulated) {
    const file = simulatedFiles.find((f) => f.path === path);
    if (!file) return `Error: File "${path}" not found in workspace.`;
    return file.content || '(empty file)';
  }

  if (!rootHandle) return 'Error: No root folder open.';

  try {
    const parts = path.split('/');
    const fileName = parts.pop();
    if (!fileName) return `Error: Invalid path "${path}".`;

    let dirHandle = rootHandle;
    for (const part of parts) {
      dirHandle = await dirHandle.getDirectoryHandle(part);
    }

    const fileHandle = await dirHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (e: any) {
    return `Error: Could not read "${path}": ${e.message}`;
  }
}

const READ_FILE_TOOL = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read the full content of a file in the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root',
        },
      },
      required: ['path'],
    },
  },
};

const WRITE_FILE_TOOL = {
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Create or update a note file in the workspace. Creates parent directories if needed. Overwrites if file already exists.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root (e.g., "notes/Meeting.md")',
        },
        content: {
          type: 'string',
          description: 'Full content of the file',
        },
      },
      required: ['path', 'content'],
    },
  },
};

const MAX_TOOL_ROUNDS = 5;
const MAX_ACTIVE_CONTENT_CHARS = 50_000;
const MAX_PERSISTED_TOOL_CHARS = 2000;
const STORAGE_KEY_API_KEY = 'noted_go_api_key';
const STORAGE_KEY_MESSAGES = 'noted_chat_messages';
const STORAGE_KEY_MODEL = 'noted_chat_model';
const STORAGE_KEY_SESSION = 'noted_chat_session';

let writeResolver: ((approved: boolean) => void) | null = null;
// Incremented on every new request and every cancel; a run whose id no longer matches is stale
let runId = 0;
let abortController: AbortController | null = null;

// Invalidates the in-flight sendMessage run: aborts its request, rejects a
// pending write, and resets the transient UI state.
function cancelRun() {
  runId++;
  abortController?.abort();
  abortController = null;
  if (writeResolver) {
    writeResolver(false);
    writeResolver = null;
  }
  useChatStore.setState({ isLoading: false, pendingWrite: null, aiStatus: null });
}

// read_file results can be whole files; trim them in storage so localStorage doesn't fill up
function persistMessages(messages: Message[]) {
  saveToStorage(STORAGE_KEY_MESSAGES, messages.map((m) =>
    m.role === 'tool' && m.content && m.content.length > MAX_PERSISTED_TOOL_CHARS
      ? { ...m, content: m.content.slice(0, MAX_PERSISTED_TOOL_CHARS) + '\n…(truncated)' }
      : m
  ));
}

export const useChatStore = create<ChatState>((set, get) => ({
  apiKey: loadFromStorage<string | null>(STORAGE_KEY_API_KEY, null),
  messages: loadFromStorage<Message[]>(STORAGE_KEY_MESSAGES, []).map((m) => ({
    ...m,
    content: m.content ? stripSystemReminder(m.content) : m.content,
  })),
  model: loadFromStorage<string>(STORAGE_KEY_MODEL, 'deepseek-v4-flash'),
  availableModels: [],
  isLoading: false,
  chatError: null,
  lastUsage: null,
  aiStatus: null,
  pendingWrite: null,

  setApiKey: async (key: string) => {
    set({ chatError: null });
    try {
      const res = await fetch('/api/opencode/models', {
        headers: { Authorization: `Bearer ${key}`, 'x-opencode-session': getSessionId() },
      });
      if (res.status === 401 || res.status === 403) {
        set({ chatError: 'Invalid API key.' });
        return;
      }
    } catch {
      // Network trouble isn't proof the key is wrong — save it and let fetchModels report
    }
    set({ apiKey: key });
    saveToStorage(STORAGE_KEY_API_KEY, key);
    get().fetchModels();
  },

  fetchModels: async () => {
    const { apiKey } = get();
    if (!apiKey) return;
    try {
      const res = await fetch('/api/opencode/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'x-opencode-session': getSessionId(),
        },
      });
      if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`);
      const data = await res.json();
      const models = (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.id,
      }));
      // A stored model that's no longer offered would show one option but send another
      if (models.length > 0 && !models.some((m: { id: string }) => m.id === get().model)) {
        set({ availableModels: models, model: models[0].id });
        saveToStorage(STORAGE_KEY_MODEL, models[0].id);
      } else {
        set({ availableModels: models });
      }
    } catch (err: any) {
      set({ chatError: err.message });
    }
  },

  sendMessage: async (content: string) => {
    await waitForRestore();
    const { apiKey, model, messages, isLoading } = get();
    if (!apiKey || isLoading) return;

    const myRun = ++runId;
    const controller = new AbortController();
    abortController = controller;
    const isStale = () => myRun !== runId;

    const userMsg: Message = { role: 'user', content };
    let currentMessages = [...messages, userMsg];
    set({ messages: currentMessages, isLoading: true, chatError: null, lastUsage: null });
    persistMessages(currentMessages);

    try {
      let systemMsg: Message = { role: 'system', content: await buildWorkspaceContext(content) };
      if (isStale()) return;
      let contextStale = false;

      // The last round is sent without tools so the model has to give a final answer
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const allowTools = round < MAX_TOOL_ROUNDS;
        // A write may have changed the tree or the open file
        if (contextStale) {
          systemMsg = { role: 'system', content: await buildWorkspaceContext(content) };
          if (isStale()) return;
          contextStale = false;
        }
        const apiMessages = [systemMsg, ...currentMessages];

        const res = await fetch('/api/opencode/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'x-opencode-session': getSessionId(),
          },
          body: JSON.stringify({
            model,
            messages: apiMessages.map((m) => ({
              role: m.role,
              content: m.role === 'user' && m.content ? stripRefPrefixes(m.content) : m.content,
              tool_calls: m.tool_calls,
              tool_call_id: m.tool_call_id,
            })),
            ...(allowTools ? { tools: [READ_FILE_TOOL, WRITE_FILE_TOOL] } : {}),
            stream: true,
          }),
          signal: controller.signal,
        });
        if (isStale()) return;

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(errBody || `API error (${res.status})`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let assistantContent = '';
        const toolCalls: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map();
        let streamEnded = false;

        while (true) {
          const { done, value } = await reader.read();
          if (isStale()) return;
          if (done || streamEnded) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              streamEnded = true;
              break;
            }

            const cleanedData = data.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
            if (!cleanedData.trim()) continue;

            try {
              const parsed = JSON.parse(cleanedData);
              const choice = parsed.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta;
              if (delta?.content) {
                assistantContent += delta.content;
                const cleaned = stripSystemReminder(assistantContent);
                // Skip empty text so a markup-only reply doesn't show an empty bubble
                if (cleaned) {
                  const msgs = get().messages;
                  const lastMsg = msgs[msgs.length - 1];
                  if (lastMsg?.role === 'assistant' && lastMsg.content !== null) {
                    msgs[msgs.length - 1] = { ...lastMsg, content: cleaned };
                    set({ messages: [...msgs] });
                  } else {
                    set({ messages: [...get().messages, { role: 'assistant', content: cleaned }] });
                  }
                }
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.id) {
                    toolCalls.set(tc.index, {
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
                    });
                  } else if (toolCalls.has(tc.index)) {
                    const existing = toolCalls.get(tc.index)!;
                    existing.function.arguments += tc.function?.arguments || '';
                  }
                }
              }
              if (parsed.usage) {
                set({ lastUsage: {
                  prompt: parsed.usage.prompt_tokens ?? 0,
                  completion: parsed.usage.completion_tokens ?? 0,
                  reasoning: parsed.usage.completion_tokens_details?.reasoning_tokens ?? 0,
                } });
              }
            } catch {
              // skip malformed chunks
            }
          }
        }

        // Fallback for models that emit tool calls as text markup instead of tool_calls
        if (allowTools && toolCalls.size === 0) {
          parseToolMarkup(assistantContent).forEach((c, i) => {
            toolCalls.set(i, {
              id: `call_${myRun}_${round}_${i}`,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            });
          });
        }

        const finalText = stripSystemReminder(assistantContent);

        if (toolCalls.size > 0) {
          const assistantToolMsg: Message = {
            role: 'assistant',
            // Keep text streamed before the tool call so it doesn't vanish from the chat
            content: finalText || null,
            tool_calls: Array.from(toolCalls.values()),
          };
          currentMessages = [...currentMessages, assistantToolMsg];

          for (const tc of Array.from(toolCalls.values())) {
            try {
              const args = JSON.parse(tc.function.arguments);
              if (typeof args?.path !== 'string' || !args.path) throw new Error('"path" must be a non-empty string');
              if (tc.function.name === 'write_file' && typeof args.content !== 'string') throw new Error('"content" must be a string');
              const path = args.path.replace(/^\.\//, '');
              let result: string;
              const pathError = validateToolPath(path);
              if (pathError) {
                result = pathError;
              } else if (tc.function.name === 'read_file') {
                set({ aiStatus: `📖 Reading ${path}...` });
                result = await executeReadFile(path);
                if (isStale()) return;
                set({ aiStatus: null });
              } else if (tc.function.name === 'write_file') {
                const oldContent = await readExistingFile(path);
                if (isStale()) return;
                // isLoading stays true while waiting, so the input stays locked
                set({
                  pendingWrite: { path, content: args.content, oldContent },
                  aiStatus: null,
                });
                const approved = await new Promise<boolean>((resolve) => {
                  writeResolver = resolve;
                });
                if (isStale()) return;
                if (approved) {
                  set({ pendingWrite: null, aiStatus: `✏️ Writing ${path}...` });
                  result = await executeWriteFile(path, args.content);
                  if (isStale()) return;
                  set({ aiStatus: null });
                  contextStale = true;
                } else {
                  result = "The user rejected this write. Tell the user you will not make changes without their approval.";
                  set({ pendingWrite: null });
                }
              } else {
                result = `Error: Unknown tool "${tc.function.name}"`;
              }
              currentMessages = [...currentMessages, { role: 'tool', tool_call_id: tc.id, content: result }];
            } catch (e: any) {
              currentMessages = [...currentMessages, { role: 'tool', tool_call_id: tc.id, content: `Error: ${e.message}` }];
            }
          }

          set({ messages: currentMessages });
          // Continue to next round
        } else {
          if (finalText) {
            currentMessages = [...currentMessages, { role: 'assistant', content: finalText }];
          }
          set({
            messages: currentMessages,
            isLoading: false,
            ...(finalText ? {} : { chatError: 'The model returned no answer. Try again or rephrase.' }),
          });
          persistMessages(currentMessages);
          return;
        }
      }

      set({ messages: currentMessages, isLoading: false });
      persistMessages(currentMessages);
    } catch (err: any) {
      if (isStale() || err?.name === 'AbortError') return;
      set({ chatError: err.message, isLoading: false, pendingWrite: null, aiStatus: null });
      // Keep a partial answer across reloads
      persistMessages(get().messages);
    } finally {
      if (abortController === controller) abortController = null;
    }
  },

  stopGeneration: () => {
    if (!get().isLoading) return;
    cancelRun();
    // Keep whatever was streamed so far
    persistMessages(get().messages);
  },

  setModel: (model: string) => {
    set({ model });
    saveToStorage(STORAGE_KEY_MODEL, model);
  },

  clearChat: () => {
    cancelRun();
    set({ messages: [], chatError: null, lastUsage: null });
    saveToStorage(STORAGE_KEY_MESSAGES, []);
  },

  clearApiKey: () => {
    cancelRun();
    set({ apiKey: null, messages: [], availableModels: [], chatError: null, lastUsage: null });
    saveToStorage(STORAGE_KEY_API_KEY, null);
    saveToStorage(STORAGE_KEY_MESSAGES, []);
  },

  approveWrite: () => {
    if (writeResolver) {
      writeResolver(true);
      writeResolver = null;
    }
  },

  rejectWrite: () => {
    if (writeResolver) {
      writeResolver(false);
      writeResolver = null;
    }
  },
}));

async function waitForRestore() {
  let waited = 0;
  while (useNoteStore.getState().isRestoring && waited < 100) {
    await new Promise((r) => setTimeout(r, 100));
    waited++;
  }
}
