import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNoteStore, FileNode } from '../store/noteStore';
import { toast } from 'sonner';
import { defaultStyles } from 'react-file-icon';
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Plus,
  Edit2,
  Trash2,
  FolderPlus,
  FilePlus,
  Search,
  HardDrive,
  RefreshCw,
  FolderOpen as OpenIcon,
  HelpCircle,
  X,
  Sparkles,
  Sun,
  Moon,
  Minus
} from 'lucide-react';

const FILE_COLORS: Record<string, string> = {
  md:    '#FFB300',
  ts:    '#4DD0E1',
  tsx:   '#FF8A65',
  js:    '#FDD835',
  jsx:   '#00BCD4',
  json:  '#66BB6A',
  jsonc: '#66BB6A',
  css:   '#EC407A',
  html:  '#EF5350',
  svg:   '#FF7043',
  py:    '#FFCA28',
  go:    '#00ACC1',
  rs:    '#DE4C36',
  rb:    '#D4382D',
  yaml:  '#26A69A',
  yml:   '#26A69A',
  toml:  '#8D6E63',
  lock:  '#78909C',
  sh:    '#4DB6AC',
  bash:  '#4DB6AC',
  txt:   '#90A4AE',
  pdf:   '#E53935',
  doc:   '#1E88E5',
  docx:  '#1E88E5',
  xls:   '#43A047',
  xlsx:  '#43A047',
  ppt:   '#FB8C00',
  pptx:  '#FB8C00',
  zip:   '#78909C',
  gz:    '#78909C',
  csv:   '#66BB6A',
};

function getFileColor(ext: string): string {
  const custom = FILE_COLORS[ext];
  if (custom) return custom;
  const def = (defaultStyles as any)[ext];
  if (def?.color) return def.color;
  return '#78909C';
}

function FileTypeBlock({ ext }: { ext: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" role="img" aria-label={ext}>
      <rect width="24" height="24" rx="3" fill={getFileColor(ext)} />
      <text
        x="12" y="17"
        textAnchor="middle"
        fill="white"
        fontSize="10"
        fontWeight="800"
        fontFamily="system-ui, sans-serif"
      >
        {(ext || '?').slice(0, 4).toUpperCase()}
      </text>
    </svg>
  );
}

export default function Sidebar() {
  const isSimulated = useNoteStore((state) => state.isSimulated);
  const folderName = useNoteStore((state) => state.folderName);
  const fileTree = useNoteStore((state) => state.fileTree);
  const activeTab = useNoteStore((state) => state.activeTab);
  const openFile = useNoteStore((state) => state.openFile);
  const openFolderPicker = useNoteStore((state) => state.openFolderPicker);
  const createFile = useNoteStore((state) => state.createFile);
  const createFolder = useNoteStore((state) => state.createFolder);
  const renameNode = useNoteStore((state) => state.renameNode);
  const moveNode = useNoteStore((state) => state.moveNode);
  const deleteNode = useNoteStore((state) => state.deleteNode);
  const toggleFolderCollapse = useNoteStore((state) => state.toggleFolderCollapse);
  const resetToSimulated = useNoteStore((state) => state.resetToSimulated);
  const theme = useNoteStore((state) => state.theme);
  const setTheme = useNoteStore((state) => state.setTheme);
  const fontSize = useNoteStore((state) => state.fontSize);
  const setFontSize = useNoteStore((state) => state.setFontSize);
  
  const searchQuery = useNoteStore((state) => state.searchQuery);
  const setSearchQuery = useNoteStore((state) => state.setSearchQuery);
  const workspaceCounts = useNoteStore((state) => state.workspaceCounts);
  const isRestoring = useNoteStore((state) => state.isRestoring);
  const restoreError = useNoteStore((state) => state.restoreError);

  // UI Inline actions state
  // path being edited or parentPath where we are adding a child
  const [addingChildState, setAddingChildState] = useState<{
    parentPath: string | null;
    type: 'file' | 'folder';
  } | null>(null);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [inlineInputVal, setInlineInputVal] = useState('');
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const openingRef = useRef(false);

  // Trigger focus when inline input is loaded
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [addingChildState, renamingPath]);

  const handleRefresh = async () => {
    await useNoteStore.getState().refreshFolder();
    toast.success("Document list refreshed");
  };

  const handleOpenFolder = async () => {
    if (openingRef.current) {
      console.log('[handleOpenFolder] blocked by lock');
      return;
    }
    openingRef.current = true;
    const lockTimeout = setTimeout(() => { openingRef.current = false; }, 30000);
    try {
      setErrorToast(null);
      console.log('[handleOpenFolder] calling openFolderPicker');
      await openFolderPicker();
      console.log('[handleOpenFolder] openFolderPicker succeeded');
    } catch (err: any) {
      console.warn('[handleOpenFolder] caught:', err?.name, err?.message);
      if (err?.name === 'AbortError') {
        console.log('[handleOpenFolder] user cancelled picker');
        return;
      }
      if (err?.message?.includes("Iframe Sandbox Constraint")) {
        console.log('[handleOpenFolder] sandbox constraint');
        return;
      }
      const msg = err?.message || "File access is limited in some browser environments.";
      setErrorToast(msg);
      setTimeout(() => setErrorToast(null), 5000);
    } finally {
      clearTimeout(lockTimeout);
      openingRef.current = false;
      console.log('[handleOpenFolder] lock released');
    }
  };

  const handleInlineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = inlineInputVal.trim();
    if (!name) {
      resetInlineStates();
      return;
    }

    try {
      if (addingChildState) {
        if (addingChildState.type === 'file') {
          await createFile(addingChildState.parentPath, name);
        } else {
          await createFolder(addingChildState.parentPath, name);
        }
      } else if (renamingPath) {
        await renameNode(renamingPath, name);
      }
      resetInlineStates();
    } catch (err: any) {
      setErrorToast(err?.message || "Operation failed.");
      setTimeout(() => setErrorToast(null), 4000);
    }
  };

  const resetInlineStates = () => {
    setAddingChildState(null);
    setRenamingPath(null);
    setInlineInputVal('');
  };

  const dragRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, path: string) => {
    dragRef.current = path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
  };

  const handleDragOver = (e: React.DragEvent, path: string) => {
    if (!dragRef.current || dragRef.current === path) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(path);
  };

  const handleDragLeave = (e: React.DragEvent, path: string) => {
    if (dropTarget === path) {
      setDropTarget(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    setDropTarget(null);
    const draggedPath = dragRef.current;
    dragRef.current = null;
    if (!draggedPath || draggedPath === targetPath) return;

    try {
      await moveNode(draggedPath, targetPath);
    } catch (err: any) {
      toast.error(err?.message || "Failed to move item");
    }
  };

  // Render file tree recursively
  const renderTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => {
      const isSelected = activeTab === node.path;
      const isFolder = node.kind === 'directory';
      const isBeingRenamed = renamingPath === node.path;
      const isDragOver = dropTarget === node.path;

      // Check if we are currently adding a new child inside this specific folder
      const isAddingHere = addingChildState && addingChildState.parentPath === node.path;

      return (
        <div key={node.path} className="flex flex-col">
          {/* Node Row */}
          <div
            draggable={!isBeingRenamed}
            onDragStart={(e) => handleDragStart(e, node.path)}
            onDragOver={isFolder ? (e) => handleDragOver(e, node.path) : undefined}
            onDragLeave={isFolder ? (e) => handleDragLeave(e, node.path) : undefined}
            onDrop={isFolder ? (e) => handleDrop(e, node.path) : undefined}
            className={`group flex items-center justify-between px-2 py-1.5 text-xs rounded transition-all duration-150 cursor-pointer ${
              isSelected
                ? 'bg-theme-active text-theme-white font-medium'
                : isDragOver
                  ? 'bg-theme-hover text-theme-white ring-1 ring-theme-border-hover'
                  : 'text-theme-muted hover:bg-theme-active hover:text-theme-white'
            }`}
            style={{ paddingLeft: `${Math.max(8, depth * 16)}px` }}
            onClick={() => {
              if (isFolder) {
                toggleFolderCollapse(node.path);
              } else {
                openFile(node.path);
              }
            }}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Caret icon for folders */}
              {isFolder ? (
                <span className="text-theme-darker hover:text-theme-white shrink-0">
                  {node.isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </span>
              ) : (
                <span className="w-3.5 shrink-0"></span> // file spacer
              )}

              {/* Kind Icons */}
              {isFolder ? (
                node.isOpen ? (
                  <FolderOpen fill="currentColor" className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-theme-white' : 'text-indigo-400'}`} />
                ) : (
                  <Folder fill="currentColor" className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-theme-white' : 'text-indigo-400'}`} />
                )
              ) : (
                <FileTypeBlock ext={node.name.split('.').pop()?.toLowerCase() || ''} />
              )}

              {/* Label (Standard or Edit mode) */}
              {isBeingRenamed ? (
                <form onSubmit={handleInlineSubmit} className="flex-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inlineInputVal}
                    onChange={(e) => setInlineInputVal(e.target.value)}
                    onBlur={resetInlineStates}
                    onKeyDown={(e) => e.key === 'Escape' && resetInlineStates()}
                    className="w-full bg-theme-input text-theme-text px-1.5 py-0.5 text-xs rounded border border-theme-border focus:border-theme-border-hover outline-none font-sans"
                  />
                </form>
              ) : (
                <span className="truncate select-none font-sans text-xs leading-none">
                  {isFolder ? node.name : (node.name.endsWith('.md') ? node.name.replace(/\.md$/, '') : node.name)}
                </span>
              )}
            </div>

            {/* Action Buttons (Hidden by default, hover triggers visible) */}
            {!isBeingRenamed && (
              <div
                className="hidden group-hover:flex items-center gap-1 ml-2 text-theme-darker shrink-0 transition-opacity duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Folders support Adding nested Files or folders */}
                {isFolder && (
                  <>
                    <button
                      title="New File"
                      onClick={() => {
                        setAddingChildState({ parentPath: node.path, type: 'file' });
                        setInlineInputVal('');
                      }}
                      className="hover:text-theme-white p-0.5 rounded hover:bg-theme-hover"
                    >
                      <FilePlus className="w-3 h-3" />
                    </button>
                    <button
                      title="New Folder"
                      onClick={() => {
                        setAddingChildState({ parentPath: node.path, type: 'folder' });
                        setInlineInputVal('');
                      }}
                      className="hover:text-theme-white p-0.5 rounded hover:bg-theme-hover"
                    >
                      <FolderPlus className="w-3 h-3" />
                    </button>
                  </>
                )}

                {/* Edit & Delete operations for all nodes */}
                <button
                  title="Rename"
                  onClick={() => {
                    setRenamingPath(node.path);
                    setInlineInputVal(isFolder ? node.name : (node.name.endsWith('.md') ? node.name.replace(/\.md$/, '') : node.name));
                  }}
                  className="hover:text-theme-white p-0.5 rounded hover:bg-theme-hover"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  title="Delete"
                  onClick={() => {
                    toast(`Delete "${node.name}"?`, {
                      duration: 8000,
                      action: {
                        label: 'Delete',
                        onClick: () => deleteNode(node.path),
                      },
                    });
                  }}
                  className="hover:text-red-400 p-0.5 rounded hover:bg-theme-hover"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Inline creation input child field */}
          {isAddingHere && (
            <div
              className="flex items-center gap-2 py-0.5 pr-3"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              {addingChildState?.type === 'file' ? (
                <FileText className="w-3.5 h-3.5 text-theme-darker shrink-0" />
              ) : (
                <Folder fill="currentColor" className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              )}
              <form onSubmit={handleInlineSubmit} className="flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={addingChildState?.type === 'file' ? "name.md" : "folder name"}
                  value={inlineInputVal}
                  onChange={(e) => setInlineInputVal(e.target.value)}
                  onBlur={resetInlineStates}
                  onKeyDown={(e) => e.key === 'Escape' && resetInlineStates()}
                  className="w-full bg-theme-input text-theme-text px-1.5 py-0.5 text-xs rounded border border-theme-border focus:border-theme-border-hover outline-none font-sans"
                />
              </form>
            </div>
          )}

          {/* Children block */}
          {isFolder && node.isOpen && node.children && node.children.length > 0 && (
            <div className="flex flex-col mt-0.5 select-none">
              {renderTree(node.children, depth + 1)}
            </div>
          )}

          {/* Empty Folder indication (when folder is expanded but empty) */}
          {isFolder && node.isOpen && (!node.children || node.children.length === 0) && !isAddingHere && (
            <div
              className="text-[10px] font-mono text-theme-darker italic py-1 select-none"
              style={{ paddingLeft: `${(depth + 1) * 16 + 14}px` }}
            >
              Empty Folder
            </div>
          )}
        </div>
      );
    });
  };

  const treeContent = useMemo(() => {
    if (fileTree.length === 0) return null;
    return renderTree(fileTree);
  }, [fileTree, activeTab, renamingPath, addingChildState, inlineInputVal, dropTarget]);

  return (
    <div className="bg-theme-sidebar-bg border-r border-theme-border flex flex-col h-full shrink-0 select-text w-full">
      {/* Brand space */}
      <div className="h-12 border-b border-theme-border px-4 flex items-center justify-between bg-theme-sidebar-header">
        <div className="flex items-center gap-2.5">
          <img src="/noted-icon.svg" alt="Noted" className="w-6 h-6" />
          <span className="font-sans font-semibold tracking-tight text-sm text-theme-white">Noted</span>
        </div>
        <div className="text-[10px] font-mono text-theme-darker font-semibold uppercase">v1.0</div>
      </div>

      {/* Directory Launcher Box */}
      <div className="p-3 border-b border-theme-border bg-theme-sidebar-header space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[11px] font-mono text-theme-muted">
            {isRestoring ? (
              <div className="flex items-center gap-1.5 text-yellow-500 font-medium text-[11px]">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></div>
                <span>Restoring folder...</span>
              </div>
            ) : isSimulated ? (
              <div className="flex items-center gap-1.5 text-theme-muted font-medium text-[11px]">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                <span>Simulated Sandbox</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-emerald-500 font-medium text-[11px]">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span>Local Mode</span>
              </div>
            )}
          </div>
          {!isSimulated && (
            <button
              onClick={resetToSimulated}
              title="Return to sandbox"
              className="text-[10px] font-mono text-red-400 hover:text-red-300 flex items-center gap-0.5 cursor-pointer"
            >
              <X className="w-2.5 h-2.5" /> Disconnect
            </button>
          )}
        </div>

        <button
          onClick={handleOpenFolder}
          disabled={isRestoring}
          className="w-full bg-theme-active hover:bg-theme-hover hover:text-theme-white text-theme-muted border border-theme-border rounded px-3 py-1.5 flex items-center justify-center gap-2 text-xs font-semibold select-none cursor-pointer duration-100 transition-all text-center disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="truncate">{isRestoring ? "Restoring..." : isSimulated ? "Open Folder" : "Change Folder"}</span>
        </button>

        <div className="text-[10px] text-theme-darker font-mono flex items-center gap-1.5 truncate select-none leading-none">
          <span>Active:</span>
          <span className="text-theme-muted truncate max-w-[140px]" title={folderName}>
            {folderName}
          </span>
          <span className="text-theme-darker">·</span>
          <span className="text-theme-darker truncate shrink-0">
            {isSimulated ? "Sandbox" : `${workspaceCounts.files} files, ${workspaceCounts.folders} folders`}
          </span>
        </div>
      </div>

      {/* Navigation and Search */}
      <div className="px-4 pt-4 flex flex-col gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-theme-darker" />
          <input
            type="text"
            placeholder="Search notes in tree..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-theme-input hover:bg-theme-hover font-sans text-xs text-theme-text placeholder-theme-darker pl-8 pr-2.5 py-1.5 rounded border border-theme-border outline-none focus:border-theme-border-hover focus:bg-theme-input transition-all"
          />
        </div>

        {/* Global actions */}
        <div className="flex items-center justify-between px-1 pt-1.5">
          <span className="text-[11px] uppercase tracking-wider text-theme-darker font-bold">Documents</span>
          <div className="flex items-center gap-2 text-theme-muted">
            {/* Refresh file tree */}
            <button
              onClick={handleRefresh}
              title="Refresh file tree"
              className="hover:text-white cursor-pointer p-0.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {/* Create file in Workspace root */}
            <button
              onClick={() => {
                setAddingChildState({ parentPath: null, type: 'file' });
                setInlineInputVal('');
              }}
              title="New File in Root"
              className="hover:text-white cursor-pointer p-0.5"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setAddingChildState({ parentPath: null, type: 'folder' });
                setInlineInputVal('');
              }}
              title="New Folder in Root"
              className="hover:text-white cursor-pointer p-0.5"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* File Tree View */}
      <div className="flex-1 overflow-y-auto px-2 py-2 thin-scrollbar space-y-1 select-none" style={{ contain: 'strict' }}>
        {addingChildState && addingChildState.parentPath === null && (
          <div className="flex items-center gap-2 py-1 px-2.5 mb-1" onClick={(e) => e.stopPropagation()}>
            {addingChildState.type === 'file' ? (
              <FileText className="w-3.5 h-3.5 text-theme-darker shrink-0" />
            ) : (
              <Folder fill="currentColor" className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            )}
            <form onSubmit={handleInlineSubmit} className="flex-1">
              <input
                ref={inputRef}
                type="text"
                placeholder={addingChildState.type === 'file' ? "name.md" : "folder name"}
                value={inlineInputVal}
                onChange={(e) => setInlineInputVal(e.target.value)}
                onBlur={resetInlineStates}
                onKeyDown={(e) => e.key === 'Escape' && resetInlineStates()}
                className="w-full bg-theme-input text-theme-text px-1.5 py-0.5 text-xs rounded border border-theme-border focus:border-theme-border-hover outline-none font-sans"
              />
            </form>
          </div>
        )}

        {treeContent || (
          <div className="flex flex-col items-center justify-center p-6 text-center select-none text-theme-darker text-xs">
            {searchQuery ? (
              <span>No matching notes found</span>
            ) : (
              <div className="space-y-1">
                <span className="block font-medium">Empty directory</span>
                <span className="block text-[10px] text-theme-darker leading-normal">
                  Click '+' parent buttons to create a file!
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast messages */}
      {(errorToast || restoreError) && (
        <div className="mx-3 my-2 p-2.5 bg-red-950/60 border border-red-900 text-red-300 rounded text-[11px] shadow-lg leading-normal flex items-start gap-1.5">
          <HelpCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block font-sans text-xs">
              {errorToast ? "Directory Pick Error" : "Folder Access"}
            </span>
            <span className="text-[10px]">{errorToast || restoreError}</span>
          </div>
        </div>
      )}

      {/* Sidebar Footer */}
      <div className="mt-auto p-3 border-t border-theme-border bg-theme-sidebar-header flex items-center justify-between gap-2.5">
        {/* Font size controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setFontSize(fontSize - 1)}
            disabled={fontSize <= 12}
            title="Decrease font size"
            className="p-1.5 rounded-md border border-theme-border bg-theme-active hover:bg-theme-hover text-theme-muted hover:text-theme-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center justify-center"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="text-[10px] font-mono text-theme-darker w-5 text-center select-none">
            {fontSize}
          </span>
          <button
            onClick={() => setFontSize(fontSize + 1)}
            disabled={fontSize >= 28}
            title="Increase font size"
            className="p-1.5 rounded-md border border-theme-border bg-theme-active hover:bg-theme-hover text-theme-muted hover:text-theme-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center justify-center"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Theme select switch */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
          className="p-1.5 rounded-md border border-theme-border bg-theme-active hover:bg-theme-hover text-theme-muted hover:text-theme-white cursor-pointer transition-colors shrink-0 flex items-center justify-center"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-500" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-500" />
          )}
        </button>
      </div>
    </div>
  );
}
