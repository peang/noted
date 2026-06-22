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
  mode: 'plan' | 'build';
  lastUsage: { prompt: number; completion: number; reasoning: number } | null;

  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  sendMessage: (content: string) => Promise<void>;
  fetchModels: () => Promise<void>;
  setModel: (model: string) => void;
  setMode: (mode: 'plan' | 'build') => void;
  clearChat: () => void;
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

async function readWorkspaceFiles(): Promise<string> {
  const state = useNoteStore.getState();
  const { isSimulated, simulatedFiles, fileTree } = state;
  const entries: string[] = [];

  if (isSimulated) {
    for (const f of simulatedFiles) {
      if (f.kind !== 'file') continue;
      entries.push(`--- ${f.path} ---\n${f.content || '(empty)'}\n`);
    }
    return entries.join('\n');
  }

  const readNode = async (node: FileNode) => {
    if (node.kind === 'file' && node.handle) {
      try {
        const file = await (node.handle as FileSystemFileHandle).getFile();
        const content = await file.text();
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
    if (node.kind === 'directory' && !node.children?.length) continue;
    result += `${indent}- ${node.kind === 'directory' ? '📁 ' : '📄 '}${node.name}${node.kind === 'directory' ? '/' : ''}\n`;
    if (node.children) {
      result += buildTreeString(node.children, indent + '  ');
    }
  }
  return result;
}

async function buildWorkspaceContext(mode: 'plan' | 'build'): Promise<string> {
  const state = useNoteStore.getState();
  const { folderName, isSimulated, fileTree, activeTab, activeContent } = state;

  let treePreview = '';
  if (fileTree.length > 0) {
    treePreview = buildTreeString(fileTree, '');
  } else {
    treePreview = '(empty)\n';
  }

  const parts: string[] = [
    `You are a helpful AI assistant for a note-taking workspace called "${folderName}".`,
    `The workspace is stored on ${isSimulated ? 'a simulated in-memory filesystem' : 'the local disk directory'}.\n`,
    `Current workspace file structure:`,
    treePreview,
  ];

  if (mode === 'plan') {
    parts.push('Here are all file contents in the workspace:');
    const allContent = await readWorkspaceFiles();
    parts.push(allContent || '(no files with readable content)');
  } else {
    if (activeTab && activeContent) {
      parts.push(`The user currently has "${activeTab}" open with the following content:`);
      parts.push('```' + activeTab.split('.').pop() + '');
      parts.push(activeContent);
      parts.push('```');
    } else if (activeTab) {
      parts.push(`The user currently has "${activeTab}" open.`);
    }
  }

  if (mode === 'plan') {
    parts.push('You are in PLAN MODE — analysis only. You CANNOT create, update, copy, or modify any files. If the user asks you to perform any action (write, copy, move, delete, edit), politely refuse and explain you are in plan mode. Do not output file contents as a response to action requests.');
  } else {
    parts.push('You have tools `read_file` and `write_file` available. Use `read_file` to read files, and `write_file` to create or update notes in the workspace. When writing or updating files, do not echo the file content in your response — just confirm what was done.');
  }
  parts.push('You are a note assistant — work strictly within the opened workspace folder. Keep responses simple, direct, and easy to read. Do not use markdown formatting or code blocks. Answer based only on the notes provided.');

  return parts.join('\n');
}

function findFileNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findFileNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
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
    useNoteStore.setState({ simulatedFiles: newFiles, fileTree: tree });
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
    useNoteStore.setState({ fileTree: filterRealFileTree(tree, state.searchQuery) });

    return `Written "${path}".`;
  } catch (e: any) {
    return `Error writing "${path}": ${e.message}`;
  }
}

async function executeReadFile(path: string): Promise<string> {
  const state = useNoteStore.getState();
  const { isSimulated, simulatedFiles, fileTree } = state;

  if (isSimulated) {
    const file = simulatedFiles.find((f) => f.path === path);
    if (!file) return `Error: File "${path}" not found in workspace.`;
    return file.content || '(empty file)';
  }

  const node = findFileNode(fileTree, path);
  if (!node) return `Error: File "${path}" not found in workspace.`;

  try {
    const file = await (node.handle as FileSystemFileHandle).getFile();
    const text = await file.text();
    return text;
  } catch {
    return `Error: Could not read "${path}".`;
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

const MAX_TOOL_ROUNDS = 3;
const STORAGE_KEY_API_KEY = 'noted_go_api_key';
const STORAGE_KEY_MESSAGES = 'noted_chat_messages';
const STORAGE_KEY_MODEL = 'noted_chat_model';
const STORAGE_KEY_MODE = 'noted_chat_mode';

export const useChatStore = create<ChatState>((set, get) => ({
  apiKey: loadFromStorage<string | null>(STORAGE_KEY_API_KEY, null),
  messages: loadFromStorage<Message[]>(STORAGE_KEY_MESSAGES, []),
  model: loadFromStorage<string>(STORAGE_KEY_MODEL, 'deepseek-v4-flash'),
  availableModels: [],
  isLoading: false,
  chatError: null,
  mode: loadFromStorage<'plan' | 'build'>(STORAGE_KEY_MODE, 'build'),
  lastUsage: null,

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
    const { apiKey, model, messages } = get();
    if (!apiKey) return;

    const userMsg: Message = { role: 'user', content };
    let currentMessages = [...messages, userMsg];
    set({ messages: currentMessages, isLoading: true, chatError: null, lastUsage: null });
    saveToStorage(STORAGE_KEY_MESSAGES, currentMessages);

    const context = await buildWorkspaceContext(get().mode);
    const systemMsg: Message = { role: 'system', content: context };

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const shouldUseTools = round === 0 && get().mode === 'build';
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
            tools: shouldUseTools ? [READ_FILE_TOOL, WRITE_FILE_TOOL] : undefined,
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

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta;

              if (delta?.content) {
                assistantContent += delta.content;
                const msgs = get().messages;
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg?.role === 'assistant' && lastMsg.content !== null) {
                  msgs[msgs.length - 1] = { ...lastMsg, content: lastMsg.content + delta.content };
                  set({ messages: [...msgs] });
                } else {
                  set({ messages: [...get().messages, { role: 'assistant', content: delta.content }] });
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
                result = await executeReadFile(args.path);
              } else if (tc.function.name === 'write_file') {
                result = await executeWriteFile(args.path, args.content);
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
            currentMessages = [...currentMessages, { role: 'assistant', content: assistantContent }];
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

  setMode: (mode: 'plan' | 'build') => {
    set({ mode });
    saveToStorage(STORAGE_KEY_MODE, mode);
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
}));
