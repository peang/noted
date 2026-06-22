import { create } from 'zustand';

const DB_NAME = 'noted_fs_handles';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const ROOT_HANDLE_KEY = 'rootFolder';

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(handle, ROOT_HANDLE_KEY);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).get(ROOT_HANDLE_KEY);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteRootHandle(): Promise<void> {
  const db = await openHandleDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(ROOT_HANDLE_KEY);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  handle?: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: FileNode[];
  isOpen?: boolean;
}

export interface SimulatedFile {
  path: string;
  kind: 'file' | 'directory';
  content?: string;
}

export function getFileType(path: string): 'markdown' | 'text' | 'pdf' | 'doc' | 'binary' {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (ext === 'md') return 'markdown';
  if (['txt', 'json', 'css', 'js', 'jsx', 'ts', 'tsx', 'html', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'csv'].includes(ext)) {
    return 'text';
  }
  if (ext === 'pdf') return 'pdf';
  if (ext === 'doc' || ext === 'docx') return 'doc';
  return 'binary';
}

interface NoteState {
  isSimulated: boolean;
  folderName: string;
  rootHandle: FileSystemDirectoryHandle | null;
  fileTree: FileNode[];
  openTabs: string[];
  activeTab: string | null;
  activeContent: string | null;
  activeFileObject: File | null;
  simulatedFiles: SimulatedFile[];
  isSaving: boolean;
  isRestoring: boolean;
  searchQuery: string;
  collapsedFolders: Record<string, boolean>; // path -> collapsed state
  showSandboxModal: boolean;
  rightSidebarOpen: boolean;
  rightSidebarTab: 'documents' | 'chat';
  rightSidebarWidth: number;
  theme: 'light' | 'dark';

  // Actions
  setShowSandboxModal: (show: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;
  setRightSidebarTab: (tab: 'documents' | 'chat') => void;
  setRightSidebarWidth: (width: number) => void;
  setSearchQuery: (query: string) => void;
  toggleFolderCollapse: (path: string) => void;
  openFolderPicker: () => Promise<void>;
  createFile: (parentPath: string | null, name: string) => Promise<void>;
  createFolder: (parentPath: string | null, name: string) => Promise<void>;
  renameNode: (oldPath: string, newName: string) => Promise<void>;
  deleteNode: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  saveActiveFile: (markdownContent: string) => Promise<void>;
  updateSimulatedFileContent: (path: string, content: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  resetToSimulated: () => void;
  restoreRootHandle: () => Promise<void>;
  refreshFolder: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
}

// Initial Simulated Files
const INITIAL_SIMULATED_FILES: SimulatedFile[] = [
  {
    path: "Welcome.md",
    kind: "file",
    content: `# Welcome to Noted 🚀

Noted is a local-first, privacy-respecting notepad that runs entirely inside your browser. No account, no servers, no trackers.

### 🔑 Core Features:
- **Notion-Style Block Editor**: Click anywhere to start writing. Try typing \`/\` on a new line to select block types.
- **Local Folder Access**: Click the **Open Folder** button in Chrome/Edge to open and auto-save notes directly on your machine's filesystem!
- **Auto-Save**: Everything you type here is instantly flushed—either to disk or local storage—no saving needed.
- **Collapsible Sidebar Tree**: Create notebooks, nested directories, files, or search across them in milliseconds.
- **Premium Dark Workspace**: Styled using JetBrains Mono and Space Grotesk for a gorgeous, high-contrast writing environment.

*Note: Since you are viewing this app in a sandboxed iframe, we have started you with a fully-functional **Simulated Local Folder** inside your browser storage. To grant access to actual Mac/Windows folders, click "Open Folder" or open this app directly in a full browser tab!*`
  },
  {
    path: "Writing Guide",
    kind: "directory"
  },
  {
    path: "Writing Guide/Getting Started.md",
    kind: "file",
    content: `# Writing Guide ✍️

Welcome to the Noted editor. This block-based editor makes structured outline generation exceptionally easy:

### 💡 Block Actions:
- **Slash Commands**: Press \`/\` on a blank line to insert:
  - Headings (H1, H2, H3)
  - Bulleted, Numbered, or Check list blocks
  - Quotes, Code blocks, and special Callouts
- **Selection Menu**: Highlight text to style it **bold**, *italic*, ~~strikethrough~~, or \`inline code\`.

### ⚡ Keyboard Shortcuts:
- \`Enter\`: Create a new block below.
- \`Shift + Enter\`: Insert a soft line break inside the same block.
- \`Tab\`: Indent a list item.
- \`Shift + Tab\`: Outdent a list item.
- \`Backspace\` (on empty line): Reset block styling or remove block.`
  },
  {
    path: "Writing Guide/Markdown Cheatsheet.md",
    kind: "file",
    content: `# Markdown Reference 📝

BlockNote supports standard Markdown shortcuts! Simply type these hotkeys and tap \`Space\` to format instantly:

### ✨ Simple Typography:
- Type \`# \` for Heading 1
- Type \`## \` for Heading 2
- Type \`### \` for Heading 3
- Type \`* \` or \`- \` for Bullet List
- Type \`1. \` for Numbered List
- Type \`[] \` for Check List
- Type \`> \` for Quote Column

### 💻 Code formatting:
Type \` \` \` \` (three backticks) to open a syntax-highlighted code container!

*Write on, fluidly and without distraction!*`
  },
  {
    path: "Workspace Ideas",
    kind: "directory"
  },
  {
    path: "Workspace Ideas/Project Brainstorming.md",
    kind: "file",
    content: `# Project Brainstorming 🔮

Collaborative workspace templates to customize for Noted:

- [x] Integrate File System Access API
- [ ] Implement global outline sidebar views
- [ ] Add backlink graphs
- [x] Build dark mode visual styles

### 🧠 Core Thoughts:
> "Simplifying writing is not about having fewer features, but about creating an interface where the active tool is never in the way."`
  },
  {
    path: "Workspace Ideas/Templates",
    kind: "directory"
  },
  {
    path: "Workspace Ideas/Templates/Meeting Notes.md",
    kind: "file",
    content: `# Meeting Notes Template 📅

**Date**: June 18, 2026
**Participants**: Noted Creator, AI Architect

### 📋 Agenda:
1. Review full-stack capabilities
2. Design custom workspace layout
3. Perfect local-first auto-saving loop

### 💬 Discussion:
- Discussed using browser-native sandboxed directory pickers.
- Agreed that standard dark themes with high-contrast pastel colors feel most comfortable for developers writing for 8+ hours.

### 🏃 Actions:
- [x] Launch alpha dashboard
- [ ] Design custom brand graphics
- [ ] Collect beta signups`
  },
  {
    path: "Workspace Ideas/Configuration.json",
    kind: "file",
    content: `{\n  "notedVersion": "1.2.0",\n  "offlineMode": true,\n  "editorSettings": {\n    "lineWrapping": true,\n    "tabSize": 2,\n    "theme": "terminal-slate"\n  },\n  "workspacePaths": [\n    "Welcome.md",\n    "Workspace Ideas",\n    "Writing Guide"\n  ]\n}`
  },
  {
    path: "Workspace Ideas/Status Report.txt",
    kind: "file",
    content: `Document: Noted Status Report\n=============================\nCreated at: 6/19/2026\nStatus: Active\n\nNotes & Logs:\n- The plain text editor loads instantly.\n- Added full search filtering for custom txt files.\n- Lines numbering is aligned to the left of the textbox container.\n- Debounced auto-saving triggers within 800ms of any typing action.`
  },
  {
    path: "Workspace Ideas/Noted Project Briefing.pdf",
    kind: "file",
    content: `simulated-pdf-placeholder\nTitle: Noted Project Briefing.pdf\nDescription: This is a placeholder for Noted Project Briefing.pdf. You can upload a real PDF file to view it directly in the reader!`
  },
  {
    path: "Workspace Ideas/User License Agreement.docx",
    kind: "file",
    content: `simulated-doc-placeholder\nTitle: User License Agreement.docx\nDescription: This is a placeholder for User License Agreement.docx. You can upload a real DOCX or Word file to display the reader layout and metadata.`
  }
];

// Helper to load simulated files from localStorage or initial state
const getInitialSimulatedFiles = (): SimulatedFile[] => {
  const saved = localStorage.getItem('noted_simulated_files');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // Fallback
    }
  }
  return INITIAL_SIMULATED_FILES;
};

const getInitialOpenTabs = (): string[] => {
  const saved = localStorage.getItem('noted_open_tabs');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // Fallback
    }
  }
  return [];
};

const getInitialActiveTab = (): string | null => {
  return localStorage.getItem('noted_active_tab') || null;
};

const getInitialCollapsedFolders = (): Record<string, boolean> => {
  const saved = localStorage.getItem('noted_collapsed_folders');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // Fallback
    }
  }
  return {};
};

const getInitialTheme = (): 'light' | 'dark' => {
  const saved = localStorage.getItem('noted_theme');
  return (saved === 'light' || saved === 'dark') ? saved : 'dark';
};

// Recursive helper to build tree from FileSystemDirectoryHandle (Real API)
export async function getFilesRecursively(
  dirHandle: FileSystemDirectoryHandle,
  relativeParentPath = "",
  collapsedMap: Record<string, boolean> = {}
): Promise<FileNode[]> {
  const nodes: FileNode[] = [];
  try {
    for await (const entry of (dirHandle as any).values()) {
      const relativePath = relativeParentPath
        ? `${relativeParentPath}/${entry.name}`
        : entry.name;
      
      if (entry.kind === "directory") {
        const isOpen = collapsedMap[relativePath] === false;
        nodes.push({
          name: entry.name,
          path: relativePath,
          kind: "directory",
          handle: entry,
          children: isOpen ? await getFilesRecursively(entry, relativePath, collapsedMap) : [],
          isOpen,
        });
      } else {
        nodes.push({
          name: entry.name,
          path: relativePath,
          kind: "file",
          handle: entry,
        });
      }
    }
  } catch (err) {
    console.error("Error reading directory: ", err);
  }

  // Sort folders first, then files alphabetically
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

// Build helper for simulated directory sorting and node construction
export function buildTreeFromPaths(
  simulatedFiles: SimulatedFile[],
  collapsedMap: Record<string, boolean> = {},
  searchQuery = ""
): FileNode[] {
  const root: FileNode[] = [];

  // Filter items if search is present
  let filtered = simulatedFiles;
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    // Keep matches or directories that contain matching items
    const pathsToInclude = new Set<string>();
    
    // Find matching files and trace their parents
    for (const f of simulatedFiles) {
      if (f.kind === 'file' && f.path.toLowerCase().split('/').pop()?.includes(q)) {
        pathsToInclude.add(f.path);
        // Add all parent paths
        const parts = f.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          pathsToInclude.add(parts.slice(0, i).join('/'));
        }
      }
    }
    filtered = simulatedFiles.filter(f => pathsToInclude.has(f.path));
  }

  // Sort files and build nested tree
  const sorted = [...filtered].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });

  for (const item of sorted) {
    const parts = item.path.split('/');
    let currentPath = "";
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;

      let existingNode = currentLevel.find(n => n.name === part);
      if (!existingNode) {
        existingNode = {
          name: part,
          path: currentPath,
          kind: isLast ? item.kind : 'directory',
          children: isLast && item.kind === 'file' ? undefined : [],
          isOpen: !collapsedMap[currentPath]
        };
        currentLevel.push(existingNode);

        // Re-sort nested level
        currentLevel.sort((a, b) => {
          if (a.kind !== b.kind) {
            return a.kind === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });
      }
      
      if (!isLast && existingNode.children) {
        currentLevel = existingNode.children;
      }
    }
  }

  return root;
}

// Search utility for filtering the real API FileNode tree recursively
export function filterRealFileTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();

  return nodes
    .map(node => {
      if (node.kind === 'file') {
        return node.name.toLowerCase().includes(q) ? node : null;
      }
      // Directory
      const filteredChildren = filterRealFileTree(node.children || [], query);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(q)) {
        return {
          ...node,
          children: filteredChildren
        };
      }
      return null;
    })
    .filter((n): n is FileNode => n !== null);
}

export const useNoteStore = create<NoteState>((set, get) => ({
  isSimulated: true,
  folderName: "Local Sandboxed Folder",
  rootHandle: null,
  fileTree: [],
  openTabs: getInitialOpenTabs(),
  activeTab: getInitialActiveTab(),
  activeContent: null,
  activeFileObject: null,
  simulatedFiles: getInitialSimulatedFiles(),
  isSaving: false,
  isRestoring: false,
  searchQuery: "",
  collapsedFolders: getInitialCollapsedFolders(),
  showSandboxModal: false,
  rightSidebarOpen: true,
  rightSidebarTab: 'chat',
  rightSidebarWidth: 600,
  theme: getInitialTheme(),

  setShowSandboxModal: (show: boolean) => set({ showSandboxModal: show }),
  setRightSidebarOpen: (open: boolean) => set({ rightSidebarOpen: open }),
  setRightSidebarTab: (tab: 'documents' | 'chat') => set({ rightSidebarTab: tab }),
  setRightSidebarWidth: (width: number) => set({ rightSidebarWidth: width }),
  setTheme: (theme: 'light' | 'dark') => set({ theme }),

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    // Debounce tree rebuild
    if ((window as any).__searchDebounce) clearTimeout((window as any).__searchDebounce);
    (window as any).__searchDebounce = setTimeout(() => {
      const { isSimulated, rootHandle, simulatedFiles, collapsedFolders } = get();
      if (isSimulated) {
        set({ fileTree: buildTreeFromPaths(simulatedFiles, collapsedFolders, query) });
      } else if (rootHandle) {
        getFilesRecursively(rootHandle, "", collapsedFolders).then(tree => {
          set({ fileTree: filterRealFileTree(tree, query) });
        });
      }
    }, 300);
  },

  toggleFolderCollapse: (path: string) => {
    set(state => {
      const isOpen = state.collapsedFolders[path] === false;
      const newCollapsed = { ...state.collapsedFolders, [path]: isOpen ? true : false };
      
      // Update tree view
      setTimeout(() => {
        const { isSimulated, rootHandle, simulatedFiles, searchQuery } = get();
        if (isSimulated) {
          set({ fileTree: buildTreeFromPaths(simulatedFiles, newCollapsed, searchQuery) });
        } else if (rootHandle) {
          getFilesRecursively(rootHandle, "", newCollapsed).then(tree => {
            set({ fileTree: filterRealFileTree(tree, searchQuery) });
          });
        }
      }, 0);

      return { collapsedFolders: newCollapsed };
    });
  },

  openFolderPicker: async () => {
    try {
      if (typeof (window as any).showDirectoryPicker !== 'function') {
        throw new Error("Local folder access is not supported by your browser or inside this sandbox. Running on Simulated Mode!");
      }

      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      console.log('[openFolderPicker] got handle:', handle.name);

      await saveRootHandle(handle);
      console.log('[openFolderPicker] saved handle to IndexedDB');

      try {
        const { useChatStore } = await import('./chatStore');
        useChatStore.getState().clearChat();
      } catch {}

      set({
        rootHandle: handle,
        folderName: handle.name,
        isSimulated: false,
        openTabs: [],
        activeTab: null,
        activeContent: null
      });

      const { collapsedFolders, searchQuery } = get();
      console.log('[openFolderPicker] building tree...');
      const tree = await getFilesRecursively(handle, "", collapsedFolders);
      console.log('[openFolderPicker] tree built:', tree.length, 'nodes');
      const filtered = filterRealFileTree(tree, searchQuery);
      console.log('[openFolderPicker] filtered tree:', filtered.length, 'nodes');
      set({ fileTree: filtered });
      console.log('[openFolderPicker] done');
    } catch (err: any) {
      console.warn("Folder picker failed:", err);
      console.log('[openFolderPicker] error name:', err?.name, 'message:', err?.message);
      
      const errText = String(err?.message || "").toLowerCase();
      const isSandboxException = 
        errText.includes("sub frame") || 
        errText.includes("cross origin") || 
        errText.includes("securityerror") || 
        errText.includes("allowed to show a file picker") ||
        err?.name === "SecurityError";

      if (isSandboxException) {
        set({ showSandboxModal: true });
        throw new Error("Iframe Sandbox Constraint: Browser blocks filesystem pickers in cross-origin frames.");
      }

      // Fallback or bubble error to handle graciously
      throw err;
    }
  },

  createFile: async (parentPath: string | null, name: string) => {
    const { isSimulated, rootHandle, simulatedFiles, collapsedFolders, searchQuery } = get();
    const cleanName = name.includes('.') ? name : `${name}.md`;
    const targetPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;

    const type = getFileType(cleanName);
    let initialContent = "";
    if (type === 'markdown') {
      const displayTitle = cleanName.replace(/\.[a-zA-Z0-9]+$/, '');
      initialContent = `# ${displayTitle}\n\n`;
    } else if (type === 'text') {
      if (cleanName.endsWith('.json')) {
        initialContent = `{\n  "title": "${cleanName}",\n  "description": "JSON plain-text document created in Noted",\n  "version": "1.0.0"\n}`;
      } else {
        const displayTitle = cleanName.replace(/\.[a-zA-Z0-9]+$/, '');
        initialContent = `Document: ${displayTitle}\n${"=".repeat(displayTitle.length + 10)}\nCreated at: ${new Date().toLocaleDateString()}\nStatus: Draft\n\n- Write text content here...\n`;
      }
    } else if (type === 'pdf') {
      initialContent = `simulated-pdf-placeholder\nTitle: ${cleanName}\nDescription: This is a placeholder for ${cleanName}. You can upload a real PDF file to view it directly in the reader!`;
    } else if (type === 'doc') {
      initialContent = `simulated-doc-placeholder\nTitle: ${cleanName}\nDescription: This is a placeholder for ${cleanName}. You can upload a real DOCX or Word file to display the reader layout and metadata.`;
    } else {
      initialContent = "";
    }

    if (isSimulated) {
      // Check duplicate
      if (simulatedFiles.some(f => f.path === targetPath)) {
        throw new Error("A file with this name already exists.");
      }
      const newFiles = [...simulatedFiles, { path: targetPath, kind: 'file' as const, content: initialContent }];
      localStorage.setItem('noted_simulated_files', JSON.stringify(newFiles));
      set({ simulatedFiles: newFiles, fileTree: buildTreeFromPaths(newFiles, collapsedFolders, searchQuery) });
      // Open the new file
      await get().openFile(targetPath);
    } else if (rootHandle) {
      try {
        let dirHandle = rootHandle;
        if (parentPath) {
          // Resolve parent handle by walking path
          const segments = parentPath.split('/');
          for (const s of segments) {
            dirHandle = await dirHandle.getDirectoryHandle(s);
          }
        }
        const fileHandle = await dirHandle.getFileHandle(cleanName, { create: true });
        // Write initial heading
        const writable = await fileHandle.createWritable();
        await writable.write(initialContent);
        await writable.close();

        // Refresh
        const tree = await getFilesRecursively(rootHandle, "", collapsedFolders);
        set({ fileTree: filterRealFileTree(tree, searchQuery) });

        // Open newly created file
        await get().openFile(targetPath);
      } catch (err) {
        console.error("Failed to create file: ", err);
        throw err;
      }
    }
  },

  createFolder: async (parentPath: string | null, name: string) => {
    const { isSimulated, rootHandle, simulatedFiles, collapsedFolders, searchQuery } = get();
    const targetPath = parentPath ? `${parentPath}/${name}` : name;

    if (isSimulated) {
      // Check duplicate
      if (simulatedFiles.some(f => f.path === targetPath)) {
        throw new Error("A folder with this name already exists.");
      }
      const newFiles = [...simulatedFiles, { path: targetPath, kind: 'directory' as const }];
      localStorage.setItem('noted_simulated_files', JSON.stringify(newFiles));
      set({ simulatedFiles: newFiles, fileTree: buildTreeFromPaths(newFiles, collapsedFolders, searchQuery) });
    } else if (rootHandle) {
      try {
        let dirHandle = rootHandle;
        if (parentPath) {
          const segments = parentPath.split('/');
          for (const s of segments) {
            dirHandle = await dirHandle.getDirectoryHandle(s);
          }
        }
        await dirHandle.getDirectoryHandle(name, { create: true });
        
        // Refresh
        const tree = await getFilesRecursively(rootHandle, "", collapsedFolders);
        set({ fileTree: filterRealFileTree(tree, searchQuery) });
      } catch (err) {
        console.error("Failed to create folder: ", err);
        throw err;
      }
    }
  },

  renameNode: async (oldPath: string, newName: string) => {
    const { isSimulated, rootHandle, simulatedFiles, openTabs, activeTab, collapsedFolders, searchQuery } = get();
    const oldParts = oldPath.split('/');
    const currentName = oldParts[oldParts.length - 1];
    
    // Maintain extension if renaming a file and user didn't write it
    let targetName = newName;
    const oldExt = oldPath.split('.').pop() || '';
    const hasDot = oldPath.includes('.');
    const isNewHasDot = newName.includes('.');
    if (hasDot && !isNewHasDot && oldExt) {
      targetName = `${newName}.${oldExt}`;
    }

    const newPath = [...oldParts.slice(0, -1), targetName].join('/');

    if (isSimulated) {
      // Map files to new paths
      const newFiles = simulatedFiles.map(f => {
        if (f.path === oldPath) {
          return { ...f, path: newPath };
        }
        if (f.path.startsWith(oldPath + '/')) {
          // nested paths
          const innerRelative = f.path.slice(oldPath.length);
          return { ...f, path: newPath + innerRelative };
        }
        return f;
      });

      localStorage.setItem('noted_simulated_files', JSON.stringify(newFiles));

      // Update tabs
      const newOpenTabs = openTabs.map(t => {
        if (t === oldPath) return newPath;
        if (t.startsWith(oldPath + '/')) {
          return newPath + t.slice(oldPath.length);
        }
        return t;
      });

      let newActiveTab = activeTab;
      if (activeTab === oldPath) {
        newActiveTab = newPath;
      } else if (activeTab?.startsWith(oldPath + '/')) {
        newActiveTab = newPath + activeTab.slice(oldPath.length);
      }

      const fileObj = newActiveTab ? newFiles.find(f => f.path === newActiveTab) : null;
      set({
        simulatedFiles: newFiles,
        fileTree: buildTreeFromPaths(newFiles, collapsedFolders, searchQuery),
        openTabs: newOpenTabs,
        activeTab: newActiveTab,
        activeContent: fileObj ? (fileObj.content || "") : null
      });
    } else if (rootHandle) {
      try {
        // Walk parents to get parent handle and file handle
        let dirHandle = rootHandle;
        const parentSegments = oldParts.slice(0, -1);
        for (const s of parentSegments) {
          dirHandle = await dirHandle.getDirectoryHandle(s);
        }

        const isDir = !oldPath.endsWith('.md');
        if (isDir) {
          // Folders can be renamed in file system access API by utilizing standard .move() on Chrome if supported, 
          // or we can recreate the folder and move children.
          const oldDirHandle = await dirHandle.getDirectoryHandle(currentName);
          if (typeof (oldDirHandle as any).move === 'function') {
            await (oldDirHandle as any).move(targetName);
          } else {
            throw new Error("Your browser does not support folder renaming directly. Please rename child documents instead.");
          }
        } else {
          const fileHandle = await dirHandle.getFileHandle(currentName);
          if (typeof (fileHandle as any).move === 'function') {
            await (fileHandle as any).move(targetName);
          } else {
            // Manual migration: create new file and write content, then delete old file
            const newFileHandle = await dirHandle.getFileHandle(targetName, { create: true });
            const oldFile = await fileHandle.getFile();
            const contents = await oldFile.text();
            const writable = await newFileHandle.createWritable();
            await writable.write(contents);
            await writable.close();
            await (fileHandle as any).remove();
          }
        }

        // Update tabs and state
        const newOpenTabs = openTabs.map(t => {
          if (t === oldPath) return newPath;
          if (t.startsWith(oldPath + '/')) {
            return newPath + t.slice(oldPath.length);
          }
          return t;
        });

        let newActiveTab = activeTab;
        if (activeTab === oldPath) {
          newActiveTab = newPath;
        } else if (activeTab?.startsWith(oldPath + '/')) {
          newActiveTab = newPath + activeTab.slice(oldPath.length);
        }

        const tree = await getFilesRecursively(rootHandle, "", collapsedFolders);
        set({
          fileTree: filterRealFileTree(tree, searchQuery),
          openTabs: newOpenTabs
        });

        if (newActiveTab) {
          await get().openFile(newActiveTab);
        } else {
          set({ activeTab: null, activeContent: null });
        }
      } catch (err: any) {
        console.error("Rename failed: ", err);
        throw err;
      }
    }
  },

  deleteNode: async (path: string) => {
    const { isSimulated, rootHandle, simulatedFiles, openTabs, activeTab, collapsedFolders, searchQuery, fileTree } = get();

    if (isSimulated) {
      // Delete matching and nested files
      const newFiles = simulatedFiles.filter(f => f.path !== path && !f.path.startsWith(path + '/'));
      localStorage.setItem('noted_simulated_files', JSON.stringify(newFiles));

      // Close open tabs
      const newOpenTabs = openTabs.filter(t => t !== path && !t.startsWith(path + '/'));
      let newActiveTab = activeTab;
      if (activeTab === path || activeTab?.startsWith(path + '/')) {
        newActiveTab = newOpenTabs.length > 0 ? newOpenTabs[0] : null;
      }

      set({
        simulatedFiles: newFiles,
        fileTree: buildTreeFromPaths(newFiles, collapsedFolders, searchQuery),
        openTabs: newOpenTabs,
        activeTab: newActiveTab,
        activeContent: newActiveTab ? (newFiles.find(f => f.path === newActiveTab)?.content || "") : null
      });
    } else if (rootHandle) {
      try {
        const segments = path.split('/');
        const name = segments[segments.length - 1];
        
        let dirHandle = rootHandle;
        const parentSegments = segments.slice(0, -1);
        for (const s of parentSegments) {
          dirHandle = await dirHandle.getDirectoryHandle(s);
        }

        // Delete from local disk (try directory first, fall back to file)
        try {
          const targetDirHandle = await dirHandle.getDirectoryHandle(name);
          await (targetDirHandle as any).remove({ recursive: true });
        } catch {
          try {
            const targetFileHandle = await dirHandle.getFileHandle(name);
            await (targetFileHandle as any).remove();
          } catch (fileErr) {
            console.error("Delete failed: ", fileErr);
            throw fileErr;
          }
        }

        // Close tabs
        const newOpenTabs = openTabs.filter(t => t !== path && !t.startsWith(path + '/'));
        let newActiveTab = activeTab;
        if (activeTab === path || activeTab?.startsWith(path + '/')) {
          newActiveTab = newOpenTabs.length > 0 ? newOpenTabs[0] : null;
        }

        const tree = await getFilesRecursively(rootHandle, "", collapsedFolders);
        set({
          fileTree: filterRealFileTree(tree, searchQuery),
          openTabs: newOpenTabs
        });

        if (newActiveTab) {
          await get().openFile(newActiveTab);
        } else {
          set({ activeTab: null, activeContent: null });
        }
      } catch (err) {
        console.error("Delete failed: ", err);
        throw err;
      }
    }
  },

  openFile: async (path: string) => {
    const { isSimulated, rootHandle, simulatedFiles, openTabs } = get();

    // Add to tabs if not already present
    const newOpenTabs = openTabs.includes(path) ? openTabs : [...openTabs, path];

    const type = getFileType(path);
    let content = "";
    let fileObjRef: File | null = null;

    if (isSimulated) {
      const fileObj = simulatedFiles.find(f => f.path === path);
      content = fileObj?.content || "";
    } else if (rootHandle) {
      try {
        const segments = path.split('/');
        let dirHandle = rootHandle;
        const filename = segments[segments.length - 1];

        const folderSegments = segments.slice(0, -1);
        for (const s of folderSegments) {
          dirHandle = await dirHandle.getDirectoryHandle(s);
        }

        const fileHandle = await dirHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        
        if (type === 'markdown' || type === 'text') {
          content = await file.text();
        } else {
          fileObjRef = file;
          content = `binary-file-metadata:${file.name}:${file.size}:${file.type}:${file.lastModified}`;
        }
      } catch (err) {
        console.error("Failed to read file: ", err);
        content = "";
      }
    }

    set({ 
      openTabs: newOpenTabs, 
      activeTab: path,
      activeContent: content,
      activeFileObject: fileObjRef
    });
  },

  saveActiveFile: async (markdownContent: string) => {
    const { isSimulated, rootHandle, activeTab, simulatedFiles, collapsedFolders, searchQuery } = get();
    if (!activeTab) return;

    set({ isSaving: true });

    if (isSimulated) {
      const newFiles = simulatedFiles.map(f => {
        if (f.path === activeTab) {
          return { ...f, content: markdownContent };
        }
        return f;
      });
      localStorage.setItem('noted_simulated_files', JSON.stringify(newFiles));
      set({
        simulatedFiles: newFiles,
        fileTree: buildTreeFromPaths(newFiles, collapsedFolders, searchQuery),
        activeContent: markdownContent,
        isSaving: false
      });
    } else if (rootHandle) {
      try {
        const segments = activeTab.split('/');
        let dirHandle = rootHandle;
        const filename = segments[segments.length - 1];

        const folderSegments = segments.slice(0, -1);
        for (const s of folderSegments) {
          dirHandle = await dirHandle.getDirectoryHandle(s);
        }

        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(markdownContent);
        await writable.close();

        set({ activeContent: markdownContent, isSaving: false });
      } catch (err) {
        console.error("Auto-save failed: ", err);
        set({ isSaving: false });
      }
    }
  },

  updateSimulatedFileContent: (path: string, content: string) => {
    const { simulatedFiles, collapsedFolders, searchQuery } = get();
    const newFiles = simulatedFiles.map(f => {
      if (f.path === path) {
        return { ...f, content };
      }
      return f;
    });
    localStorage.setItem('noted_simulated_files', JSON.stringify(newFiles));
    set({
      simulatedFiles: newFiles,
      fileTree: buildTreeFromPaths(newFiles, collapsedFolders, searchQuery),
      activeContent: content
    });
  },

  closeTab: async (path: string) => {
    const { openTabs, activeTab } = get();
    const newOpenTabs = openTabs.filter(t => t !== path);
    
    let newActiveTab = activeTab;
    if (activeTab === path) {
      newActiveTab = newOpenTabs.length > 0 ? newOpenTabs[newOpenTabs.length - 1] : null;
    }

    set({ openTabs: newOpenTabs });

    if (newActiveTab) {
      await get().openFile(newActiveTab);
    } else {
      set({ activeTab: null, activeContent: null, activeFileObject: null });
    }
  },

  setActiveTab: (path: string) => {
    get().openFile(path);
  },

  resetToSimulated: () => {
    deleteRootHandle().catch(console.error);
    import('./chatStore').then(m => m.useChatStore.getState().clearChat()).catch(() => {});
    const simulated = getInitialSimulatedFiles();
    set({
      isSimulated: true,
      rootHandle: null,
      folderName: "Local Sandboxed Folder",
      openTabs: [],
      activeTab: null,
      activeContent: null,
      activeFileObject: null,
      simulatedFiles: simulated,
      fileTree: buildTreeFromPaths(simulated, {}, "")
    });
  },

  restoreRootHandle: async () => {
    set({ isRestoring: true });
    try {
      const handle = await loadRootHandle();
      if (!handle) {
        set({ isRestoring: false });
        return;
      }

      const opts: any = { mode: 'readwrite' };
      let permission: PermissionState = 'prompt';
      try {
        const queried = await (handle as any).queryPermission(opts);
        if (queried === 'granted' || queried === 'denied') permission = queried;
      } catch {
        // queryPermission not supported, fall through to requestPermission
      }
      if (permission === 'prompt') {
        try {
          permission = await (handle as any).requestPermission(opts);
        } catch {
          permission = 'denied';
        }
      }
      if (permission !== 'granted') {
        await deleteRootHandle();
        set({ isRestoring: false });
        return;
      }

      set({
        rootHandle: handle,
        folderName: handle.name,
        isSimulated: false,
      });

      try {
        const { useChatStore } = await import('./chatStore');
        useChatStore.getState().clearChat();
      } catch {}

      const { collapsedFolders, searchQuery } = get();
      const tree = await getFilesRecursively(handle, "", collapsedFolders);
      set({ fileTree: filterRealFileTree(tree, searchQuery), isRestoring: false });
    } catch {
      await deleteRootHandle().catch(() => {});
      set({ isRestoring: false });
    }
  },

  refreshFolder: async () => {
    const { isSimulated, rootHandle, collapsedFolders, searchQuery, simulatedFiles } = get();
    if (isSimulated) {
      set({ fileTree: buildTreeFromPaths(simulatedFiles, collapsedFolders, searchQuery) });
      return;
    }
    if (!rootHandle) return;
    const tree = await getFilesRecursively(rootHandle, "", collapsedFolders);
    set({ fileTree: filterRealFileTree(tree, searchQuery) });
  }
}));

// Subscribe to automatically persist states when mutated
useNoteStore.subscribe((state) => {
  localStorage.setItem('noted_open_tabs', JSON.stringify(state.openTabs));
  localStorage.setItem('noted_active_tab', state.activeTab || '');
  localStorage.setItem('noted_collapsed_folders', JSON.stringify(state.collapsedFolders));
  localStorage.setItem('noted_theme', state.theme);
  localStorage.setItem('noted_right_sidebar_width', String(state.rightSidebarWidth));
});

// Initialize the store immediately with the initial tree
// Try to restore a previously opened folder handle from IndexedDB
const currentStore = useNoteStore.getState();
currentStore.restoreRootHandle().then(() => {
  currentStore.setSearchQuery("");

  // If there was an active tab restored, load its file content immediately
  if (currentStore.activeTab) {
    currentStore.openFile(currentStore.activeTab);
  }
});
