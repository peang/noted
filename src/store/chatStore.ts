import { create } from 'zustand';
import { useNoteStore, FileNode, buildTreeFromPaths, getFilesRecursively, filterRealFileTree } from './noteStore';

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
  pendingWrite: { path: string; content: string } | null;

  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  sendMessage: (content: string) => Promise<void>;
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
  localStorage.setItem(key, JSON.stringify(value));
}

function stripSystemReminder(text: string): string {
  if (text.includes('<system-reminder>') && !text.includes('</system-reminder>')) {
    const idx = text.indexOf('<system-reminder>');
    return text.slice(0, idx).trim();
  }
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

async function readWorkspaceFiles(): Promise<string> {
  const state = useNoteStore.getState();
  const { isSimulated, simulatedFiles, fileTree } = state;
  const entries: string[] = [];
  let totalBytes = 0;

  if (isSimulated) {
    for (const f of simulatedFiles) {
      if (f.kind !== 'file') continue;
      if (f.path.split('/').some(s => s.startsWith('.'))) continue;
      if (entries.length >= MAX_AI_FILES) break;
      const content = f.content || '';
      totalBytes += content.length;
      if (totalBytes > MAX_AI_CONTENT_KB * 1024) break;
      entries.push(`--- ${f.path} ---\n${content}\n`);
    }
    const visibleFiles = simulatedFiles.filter(f => f.kind === 'file' && !f.path.split('/').some(s => s.startsWith('.')));
    const summary = entries.length < visibleFiles.length
      ? `\n(Showing ${entries.length} of ${visibleFiles.length} files)\n`
      : '';
    return entries.join('\n') + summary;
  }

  const readNode = async (node: FileNode) => {
    if (node.name?.startsWith('.')) return;
    if (node.kind === 'file' && node.handle) {
      if (entries.length >= MAX_AI_FILES) return;
      try {
        const file = await (node.handle as FileSystemFileHandle).getFile();
        const content = await file.text();
        totalBytes += content.length;
        if (totalBytes > MAX_AI_CONTENT_KB * 1024) return;
        entries.push(`--- ${node.path} ---\n${content}\n`);
      } catch {
        entries.push(`--- ${node.path} ---\n(unreadable)\n`);
      }
    }
    if (node.children) {
      for (const child of node.children) await readNode(child);
    }
  };
  for (const node of fileTree) await readNode(node);
  return entries.join('\n');
}

function buildTreeString(nodes: FileNode[], indent = ''): string {
  let result = '';
  for (const node of nodes) {
    if (node.name?.startsWith('.')) continue;
    if (node.kind === 'directory' && !node.children?.length) continue;
    result += `${indent}- ${node.kind === 'directory' ? '📁 ' : '📄 '}${node.name}${node.kind === 'directory' ? '/' : ''}\n`;
    if (node.children) {
      result += buildTreeString(node.children, indent + '  ');
    }
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

async function buildWorkspaceContext(): Promise<string> {
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
    parts.push(`The user currently has "${activeTab}" open with the following content:`);
    parts.push('```' + activeTab.split('.').pop() + '');
    parts.push(content);
    parts.push('```');
  } else if (activeTab) {
    parts.push(`The user currently has "${activeTab}" open.`);
  }

  parts.push('You have tools `read_file` and `write_file`. When you need to read a file, ALWAYS use the read_file tool — do NOT output the file path as text. Use write_file to save changes to existing files. You cannot create new files.');
  parts.push('Be brief and direct. No pleasantries, no disclaimers, no explanations. Just answer the question and stop. Answer based only on the notes provided.');

  return parts.join('\n');
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

const MAX_AI_FILES = 20;
const MAX_AI_CONTENT_KB = 5000;
const MAX_TOOL_ROUNDS = 3;
const STORAGE_KEY_API_KEY = 'noted_go_api_key';
const STORAGE_KEY_MESSAGES = 'noted_chat_messages';
const STORAGE_KEY_MODEL = 'noted_chat_model';

let writeResolver: ((approved: boolean) => void) | null = null;

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

  setApiKey: (key: string) => {
    set({ apiKey: key, chatError: null });
    saveToStorage(STORAGE_KEY_API_KEY, key);
    get().fetchModels();
  },

  fetchModels: async () => {
    const { apiKey } = get();
    if (!apiKey) return;
    try {
      const res = await fetch('/api/opencode/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`);
      const data = await res.json();
      const models = (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.id,
      }));
      set({ availableModels: models });
    } catch (err: any) {
      set({ chatError: err.message });
    }
  },

  sendMessage: async (content: string) => {
    await waitForRestore();
    const { apiKey, model, messages } = get();
    if (!apiKey) return;

    const userMsg: Message = { role: 'user', content };
    let currentMessages = [...messages, userMsg];
    set({ messages: currentMessages, isLoading: true, chatError: null, lastUsage: null });
    saveToStorage(STORAGE_KEY_MESSAGES, currentMessages);

    try {
      const context = await buildWorkspaceContext();
      const systemMsg: Message = { role: 'system', content: context };

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const apiMessages = [systemMsg, ...currentMessages];

        const res = await fetch('/api/opencode/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: apiMessages.map((m) => ({
              role: m.role,
              content: m.content,
              tool_calls: m.tool_calls,
              tool_call_id: m.tool_call_id,
            })),
            tools: [READ_FILE_TOOL, WRITE_FILE_TOOL],
            stream: true,
          }),
        });

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
                const msgs = get().messages;
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg?.role === 'assistant' && lastMsg.content !== null) {
                  msgs[msgs.length - 1] = { ...lastMsg, content: cleaned };
                  set({ messages: [...msgs] });
                } else {
                  set({ messages: [...get().messages, { role: 'assistant', content: cleaned }] });
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

        if (toolCalls.size > 0) {
          const assistantToolMsg: Message = {
            role: 'assistant',
            content: null,
            tool_calls: Array.from(toolCalls.values()),
          };
          currentMessages = [...currentMessages, assistantToolMsg];

          for (const tc of Array.from(toolCalls.values())) {
            try {
              const args = JSON.parse(tc.function.arguments);
              let result: string;
              if (tc.function.name === 'read_file') {
                set({ aiStatus: `📖 Reading ${args.path}...` });
                result = await executeReadFile(args.path);
                set({ aiStatus: null });
              } else if (tc.function.name === 'write_file') {
                set({
                  pendingWrite: { path: args.path, content: args.content },
                  isLoading: false,
                  aiStatus: null,
                });
                const approved = await new Promise<boolean>((resolve) => {
                  writeResolver = resolve;
                });
                if (approved) {
                  set({ aiStatus: `✏️ Writing ${args.path}...` });
                  result = await executeWriteFile(args.path, args.content);
                  set({ aiStatus: null, pendingWrite: null });
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
          if (assistantContent) {
            currentMessages = [...currentMessages, { role: 'assistant', content: stripSystemReminder(assistantContent) }];
          }
          set({ messages: currentMessages, isLoading: false });
          saveToStorage(STORAGE_KEY_MESSAGES, currentMessages);
          return;
        }
      }

      set({ messages: currentMessages, isLoading: false });
      saveToStorage(STORAGE_KEY_MESSAGES, currentMessages);
    } catch (err: any) {
      set({ chatError: err.message, isLoading: false });
    }
  },

  setModel: (model: string) => {
    set({ model });
    saveToStorage(STORAGE_KEY_MODEL, model);
  },

  clearChat: () => {
    set({ messages: [], chatError: null, lastUsage: null });
    saveToStorage(STORAGE_KEY_MESSAGES, []);
  },

  clearApiKey: () => {
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

useChatStore.subscribe((state) => {
  const stripped = state.messages.map((m) => {
    const content = m.content ? stripSystemReminder(m.content) : m.content;
    return content !== m.content ? { ...m, content } : m;
  });
  if (stripped.some((m, i) => m.content !== state.messages[i]?.content)) {
    useChatStore.setState({ messages: stripped });
  }
});
