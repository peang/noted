import React, { useState, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import NoteEditor from './components/NoteEditor';
import { useNoteStore, FileNode } from './store/noteStore';
import {
  FileText,
  X,
  Sparkles,
  HardDrive,
  Plus,
  BookOpen,
  Keyboard,
  Compass,
  ArrowRight,
  FolderOpen,
  FolderLock,
  Check,
  Columns,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { Toaster } from 'sonner';
import ChatPanel from './components/ChatPanel';

export default function App() {
  const openTabs = useNoteStore((state) => state.openTabs);
  const activeTab = useNoteStore((state) => state.activeTab);
  const isSimulated = useNoteStore((state) => state.isSimulated);
  const fileTree = useNoteStore((state) => state.fileTree);
  const closeTab = useNoteStore((state) => state.closeTab);
  const setActiveTab = useNoteStore((state) => state.setActiveTab);
  const openFolderPicker = useNoteStore((state) => state.openFolderPicker);
  const createFile = useNoteStore((state) => state.createFile);
  const simulatedFiles = useNoteStore((state) => state.simulatedFiles);
  const showSandboxModal = useNoteStore((state) => state.showSandboxModal);
  const setShowSandboxModal = useNoteStore((state) => state.setShowSandboxModal);
  const rightSidebarOpen = useNoteStore((state) => state.rightSidebarOpen);
  const setRightSidebarOpen = useNoteStore((state) => state.setRightSidebarOpen);
  const rightSidebarTab = useNoteStore((state) => state.rightSidebarTab);
  const setRightSidebarTab = useNoteStore((state) => state.setRightSidebarTab);
  const rightSidebarWidth = useNoteStore((state) => state.rightSidebarWidth);
  const setRightSidebarWidth = useNoteStore((state) => state.setRightSidebarWidth);
  const leftSidebarWidth = useNoteStore((state) => state.leftSidebarWidth);
  const setLeftSidebarWidth = useNoteStore((state) => state.setLeftSidebarWidth);
  const fontSize = useNoteStore((state) => state.fontSize);
  const theme = useNoteStore((state) => state.theme);
  const workspacePaths = useNoteStore((state) => state.workspacePaths);

  const [newFileNameModal, setNewFileNameModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileError, setNewFileError] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleCopyUrl = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  // Extract flat files inside workspace for recent documents grid
  const getWorkspaceFiles = (): { name: string; path: string }[] => {
    if (isSimulated) {
      return simulatedFiles
        .filter((f) => f.kind === 'file')
        .map((f) => {
          const rawName = f.path.split('/').pop() || 'Untitled';
          const cleanName = rawName.endsWith('.md') ? rawName.replace(/\.md$/, '') : rawName;
          return {
            name: cleanName,
            path: f.path,
          };
        });
    }

    return workspacePaths
      .filter((p) => !p.endsWith('/'))
      .map((p) => {
        const rawName = p.split('/').pop() || 'Untitled';
        const cleanName = rawName.endsWith('.md') ? rawName.replace(/\.md$/, '') : rawName;
        return { name: cleanName, path: p };
      });
  };

  const allFiles = getWorkspaceFiles();
  const recentFiles = allFiles.slice(0, 6); // show top 6 files

  const handleCreateDocumentHeader = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFileName.trim();
    if (!name) return;

    try {
      createFile(null, name);
      setNewFileName('');
      setNewFileNameModal(false);
      setNewFileError('');
    } catch (err: any) {
      setNewFileError(err?.message || "File name duplicate or invalid.");
    }
  };

  const rightSidebarRef = useRef<HTMLDivElement>(null);
  const leftSidebarRef = useRef<HTMLDivElement>(null);

  const handleLeftResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftSidebarWidth;
    const el = leftSidebarRef.current;
    if (!el) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(160, startWidth + e.clientX - startX);
      el.style.width = newWidth + 'px';
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (leftSidebarRef.current) {
        setLeftSidebarWidth(parseInt(leftSidebarRef.current.style.width));
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [leftSidebarWidth, setLeftSidebarWidth]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightSidebarWidth;
    const el = rightSidebarRef.current;
    if (!el) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(180, startWidth + startX - e.clientX);
      el.style.width = newWidth + 'px';
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rightSidebarRef.current) {
        setRightSidebarWidth(parseInt(rightSidebarRef.current.style.width));
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [rightSidebarWidth, setRightSidebarWidth]);

  return (
    <div data-theme={theme} className="flex h-screen w-screen bg-theme-sidebar-bg text-theme-text overflow-hidden font-sans">
      <Toaster position="top-center" richColors closeButton />
      {/* Left Sidebar Navigation */}
      <div ref={leftSidebarRef} className="relative shrink-0" style={{ width: leftSidebarWidth }}>
        <Sidebar />
        {/* Resize handle on right edge */}
        <div
          className="absolute -right-1 top-0 bottom-0 w-3 cursor-col-resize z-10 flex items-center justify-center group"
          onMouseDown={handleLeftResizeStart}
        >
          <div className="w-0.5 h-8 rounded-full bg-theme-border group-hover:bg-theme-border-hover group-active:bg-theme-border-hover transition-colors" />
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-theme-bg relative">
        {/* Tab Content Canvas */}
        {activeTab ? (
          <NoteEditor filePath={activeTab} />
        ) : (
          /* Landing Page Launchpad empty state */
          <div className="flex-1 overflow-y-auto beauty-scrollbar bg-theme-bg px-8 py-16">
            <div className="max-w-4xl mx-auto space-y-12">
              
              {/* Premium Hero Title */}
              <div className="text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-theme-active border border-theme-border rounded text-theme-muted text-[10px] font-mono tracking-wider uppercase">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  <span>SECURE & PRIVACY-RESPECTING LOCAL FILESYSTEM NOTEBOOK</span>
                </div>
                
                <h1 className="text-4.5xl font-display font-bold tracking-tight text-theme-white py-1 leading-tight">
                  Outline your ideas, fully local-first.
                </h1>
                
                <p className="text-sm font-sans text-theme-muted max-w-lg mx-auto leading-relaxed">
                  Noted runs entirely inside your browser's clientside sandboxing. There are no clouds, no tracking, and no logins.
                </p>
              </div>

              {/* Action Bento Box Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* File system picker CARD */}
                <div
                  onClick={openFolderPicker}
                  className="bg-theme-card border border-theme-border rounded-lg p-5 hover:border-theme-border-hover hover:bg-theme-hover cursor-pointer group transition-all duration-200 flex flex-col justify-between min-h-[170px]"
                >
                  <div className="space-y-3">
                    <div className="w-9 h-9 rounded bg-theme-active border border-theme-border flex items-center justify-center text-theme-white">
                      <FolderOpen className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-sans font-semibold text-sm text-theme-white">
                        Link a Local Folder
                      </h3>
                      <p className="text-xs text-theme-muted leading-normal font-sans">
                        Mount and explore any directory on your Mac/PC. Files are written straight to disk.
                      </p>
                    </div>
                  </div>
                  <div className="pt-4 flex items-center gap-1 text-[11px] font-mono text-theme-white group-hover:gap-2 transition-all">
                    <span>Select Workspace Directory</span>
                    <ArrowRight className="w-3 text-theme-muted" />
                  </div>
                </div>

                {/* Create Note CARD */}
                <div
                  onClick={() => setNewFileNameModal(true)}
                  className="bg-theme-card border border-theme-border rounded-lg p-5 hover:border-theme-border-hover hover:bg-theme-hover cursor-pointer group transition-all duration-200 flex flex-col justify-between min-h-[170px]"
                >
                  <div className="space-y-3">
                    <div className="w-9 h-9 rounded bg-theme-active border border-theme-border flex items-center justify-center text-theme-white">
                      <Plus className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-sans font-semibold text-sm text-theme-white">
                        Create New Note
                      </h3>
                      <p className="text-xs text-theme-muted leading-normal font-sans">
                        Instantly spin up a fresh outline file in your current note database.
                      </p>
                    </div>
                  </div>
                  <div className="pt-4 flex items-center gap-1 text-[11px] font-mono text-theme-white group-hover:gap-2 transition-all">
                    <span>Write Fresh Document</span>
                    <ArrowRight className="w-3 text-theme-muted" />
                  </div>
                </div>

                {/* Explore guide CARD */}
                <div
                  onClick={() => setActiveTab("Welcome.md")}
                  className="bg-theme-card border border-theme-border rounded-lg p-5 hover:border-theme-border-hover hover:bg-theme-hover cursor-pointer group transition-all duration-200 flex flex-col justify-between min-h-[170px]"
                >
                  <div className="space-y-3">
                    <div className="w-9 h-9 rounded bg-theme-active border border-theme-border flex items-center justify-center text-theme-white">
                      <BookOpen className="w-5 h-5 text-sky-500" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-sans font-semibold text-sm text-theme-white">
                        Interactive Workspace Tour
                      </h3>
                      <p className="text-xs text-theme-muted leading-normal font-sans">
                        Explore our BlockNote editor markup types, shortcuts, codeblocks, and structures.
                      </p>
                    </div>
                  </div>
                  <div className="pt-4 flex items-center gap-1 text-[11px] font-mono text-theme-white group-hover:gap-2 transition-all">
                    <span>Open Welcome File</span>
                    <ArrowRight className="w-3 text-theme-muted" />
                  </div>
                </div>
              </div>

              {/* Dynamic Recents / Folder Explorer list */}
              {allFiles.length > 0 && (
                <div className="space-y-3 pt-4">
                  <div className="flex items-center gap-2 text-[11px] font-mono text-theme-darker font-semibold">
                    <Compass className="w-3.5 h-3.5" />
                    <span>RECENT WORKSPACE NOTES</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {recentFiles.map((file) => (
                      <div
                        key={file.path}
                        onClick={() => setActiveTab(file.path)}
                        className="bg-theme-card border border-theme-border hover:bg-theme-active rounded-lg p-3 cursor-pointer flex items-center gap-3 transition-all"
                      >
                        <div className="w-7 h-7 rounded bg-theme-active border border-theme-border flex items-center justify-center text-theme-white font-mono text-[10px]">
                          MD
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="block text-xs font-sans font-medium text-theme-text truncate">
                            {file.name}
                          </span>
                          <span className="block text-[10px] text-theme-muted font-mono truncate">
                            {file.path}
                          </span>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-theme-darker" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Markdown Shortcuts Reference Segment */}
              <div className="bg-theme-card border border-theme-border rounded-lg p-6 space-y-4">
                <div className="flex items-center gap-2 text-[11px] font-mono text-theme-darker font-semibold">
                  <Keyboard className="w-4 h-4 text-theme-white" />
                  <span>INTELLIGENT Outline Shortcuts & Markups</span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3.5 gap-x-12 text-xs">
                  <div className="flex items-center justify-between pb-1.5 border-b border-theme-border">
                    <span className="text-theme-muted">Heading 1</span>
                    <kbd className="bg-theme-active text-theme-white px-2 py-0.5 rounded font-mono text-[10px] border border-theme-border">
                      # + Space
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-theme-border">
                    <span className="text-theme-muted">Bullet List</span>
                    <kbd className="bg-theme-active text-theme-white px-2 py-0.5 rounded font-mono text-[10px] border border-theme-border">
                      * + Space
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-theme-border">
                    <span className="text-theme-muted">Heading 2</span>
                    <kbd className="bg-theme-active text-theme-white px-2 py-0.5 rounded font-mono text-[10px] border border-theme-border">
                      ## + Space
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-theme-border">
                    <span className="text-theme-muted">To-Do Checklist</span>
                    <kbd className="bg-theme-active text-theme-white px-2 py-0.5 rounded font-mono text-[10px] border border-theme-border">
                      [] + Space
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-theme-border">
                    <span className="text-theme-muted">Code Block</span>
                    <kbd className="bg-theme-active text-theme-white px-2 py-0.5 rounded font-mono text-[10px] border border-theme-border">
                      ``` + Enter
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-theme-border">
                    <span className="text-theme-muted">Quote Block</span>
                    <kbd className="bg-theme-active text-theme-white px-2 py-0.5 rounded font-mono text-[10px] border border-theme-border">
                      &gt; + Space
                    </kbd>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}
      </div>

      {/* Collapsible Right Sidebar — overlay mode (timpa editor) */}
      {rightSidebarOpen && (
        <div ref={rightSidebarRef} className="fixed right-0 top-0 z-30 h-screen bg-theme-sidebar-bg border-l border-theme-border flex flex-col animate-fade-in shadow-2xl" style={{ width: rightSidebarWidth }}>
          {/* Resize Handle */}
          <div
            className="absolute -left-1 top-0 bottom-0 w-3 cursor-col-resize z-10 flex items-center justify-center group"
            onMouseDown={handleResizeStart}
          >
            <div className="w-0.5 h-8 rounded-full bg-theme-border group-hover:bg-theme-border-hover group-active:bg-theme-border-hover transition-colors" />
          </div>
          {/* Tab Bar — Chat only */}
          <div className="h-12 border-b border-theme-border flex items-stretch bg-theme-sidebar-header">
            <div className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-theme-white">
              <Sparkles className="w-3.5 h-3.5" />
              Chat
            </div>
            <button
              onClick={() => setRightSidebarOpen(false)}
              title="Close Chat"
              className="px-3 text-[11px] font-semibold text-red-400 hover:text-red-400 hover:bg-theme-hover cursor-pointer flex items-center shrink-0 transition-colors"
            >
              Close Chat
            </button>
          </div>

          <ChatPanel />
        </div>
      )}

      {/* New Note Inline Mini Dialog Modal */}
      {newFileNameModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-theme-card border border-theme-border rounded-lg max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-sans font-bold text-sm text-theme-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-theme-white" />
                Create New Document
              </h3>
              <button
                onClick={() => {
                  setNewFileNameModal(false);
                  setNewFileError('');
                }}
                className="text-theme-darker hover:text-theme-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDocumentHeader} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono text-theme-darker uppercase tracking-wider block font-bold">File Name (e.g. Ideas or Meeting Notes)</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Notes name"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full bg-theme-input border border-theme-border focus:border-theme-border-hover outline-none rounded p-2 text-xs text-theme-text placeholder-theme-darker font-sans"
                />
                {newFileError && (
                  <span className="text-[10px] text-red-400 block pt-1">{newFileError}</span>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setNewFileNameModal(false);
                    setNewFileError('');
                  }}
                  className="px-3.5 py-1.5 bg-theme-active border border-theme-border hover:bg-theme-hover text-theme-text rounded text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-theme-white text-theme-bg hover:opacity-90 rounded text-xs font-semibold cursor-pointer"
                >
                  Create and Open
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sandbox Iframe Secure Directory Picker Restriction Modal */}
      {showSandboxModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-theme-card border border-theme-border rounded-lg max-w-lg w-full p-6 space-y-5 shadow-2.5xl">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded bg-red-950/40 border border-red-900/50 flex items-center justify-center text-red-400 shrink-0">
                <FolderLock className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-sans font-bold text-sm text-theme-text">
                  Folder Picker Security Boundary Detected
                </h3>
                <p className="text-[11px] font-mono text-red-400">
                  DOMException: SecurityError (Cross-Origin Iframe Constraint)
                </p>
              </div>
            </div>

            {/* Explainer paragraph */}
            <p className="text-xs text-theme-muted leading-relaxed font-sans">
              To guarantee your privacy, Chrome and Edge only allow local disk folder mounts in direct, top-level browser tabs. Because Noted is currently loaded through AI Studio's sandboxed preview frame, the browser shuts down direct filesystem pickers to protect your computer.
            </p>

            {/* Interactive options list */}
            <div className="space-y-3 pt-1">
              <div className="text-[10px] font-mono text-theme-darker font-bold uppercase tracking-wider">
                Select how you'd like to proceed:
              </div>

              {/* Option A: Open outside */}
              <div className="rounded border border-theme-border bg-theme-input p-4.5 space-y-3.5">
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <span className="block text-xs font-semibold text-theme-white">
                      💡 Option A: Go Native in a Full Tab (Recommended)
                    </span>
                    <span className="block text-[11px] text-theme-muted leading-normal font-sans">
                      Open Noted directly in its own tab to gain perfect read/write permissions for your folders.
                    </span>
                  </div>
                </div>

                {/* Interactive Breakout visual hint */}
                <div className="bg-theme-card border border-theme-border p-2.5 rounded flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2 text-theme-darker">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Ready at:</span>
                    <span className="text-theme-muted truncate max-w-[190px] text-[11px]" title={window.location.href}>
                      {window.location.host}
                    </span>
                  </div>
                  <button
                    onClick={handleCopyUrl}
                    className="shrink-0 text-[10.5px] px-2.5 py-1 select-none font-semibold rounded bg-theme-active hover:bg-theme-hover text-theme-text border border-theme-border flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <span>Copy App URL</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-[10px] text-theme-darker leading-relaxed">
                  *Tip:* Look for the small **arrow-breakout icon** ("Open in new tab") on the top-right of the AI Studio preview window to launch in one click!
                </p>
              </div>

              {/* Option B: Simulated Sandbox */}
              <div className="rounded border border-theme-border bg-theme-input p-4.5">
                <span className="block text-xs font-semibold text-theme-white">
                  🛡️ Option B: Stay inside Simulated Sandboxed Mode
                </span>
                <span className="block text-[11px] text-theme-muted leading-normal font-sans mt-0.5">
                  No copy-paste needed! Our local simulated sandbox auto-saves your full directory structures and file contents straight inside your safe browser client cache. Everything remains 100% offline and active.
                </span>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowSandboxModal(false)}
                className="px-4 py-1.5 bg-theme-text text-theme-bg hover:opacity-90 text-xs font-bold rounded cursor-pointer"
              >
                Use Simulated Sandbox Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
