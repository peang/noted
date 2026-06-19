import { useEffect, useState, useRef } from 'react';
import { useNoteStore } from '../store/noteStore';
import { Save, Search, Check, AlertCircle, Loader2, FileCode, Copy, Trash } from 'lucide-react';

interface PlaintextEditorProps {
  filePath: string;
}

export default function PlaintextEditor({ filePath }: PlaintextEditorProps) {
  const activeContent = useNoteStore((state) => state.activeContent);
  const saveActiveFile = useNoteStore((state) => state.saveActiveFile);
  const isSaving = useNoteStore((state) => state.isSaving);
  const isSimulated = useNoteStore((state) => state.isSimulated);
  const updateSimulatedFileContent = useNoteStore((state) => state.updateSimulatedFileContent);

  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [isLocalDirty, setIsLocalDirty] = useState(false);
  
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync state with activeContent on load/filePath change
  useEffect(() => {
    setText(activeContent || '');
    setIsLocalDirty(false);
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [activeContent, filePath]);

  // Handle changes with debounced auto-save
  const handleChange = (newVal: string) => {
    setText(newVal);
    setIsLocalDirty(true);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        if (isSimulated) {
          updateSimulatedFileContent(filePath, newVal);
        } else {
          await saveActiveFile(newVal);
        }
        setIsLocalDirty(false);
      } catch (err) {
        console.error("Auto-save failed:", err);
      }
    }, 800);
  };

  const handleManualSave = async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    try {
      if (isSimulated) {
        updateSimulatedFileContent(filePath, text);
      } else {
        await saveActiveFile(text);
      }
      setIsLocalDirty(false);
    } catch (err) {
      console.error("Manual save failed:", err);
    }
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineCount = text ? text.split('\n').length : 1;
  const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const byteSize = new Blob([text]).size;

  const displaySize = byteSize > 1024 
    ? `${(byteSize / 1024).toFixed(2)} KB` 
    : `${byteSize} Bytes`;

  const extension = filePath.split('.').pop()?.toUpperCase() || 'TXT';

  return (
    <div className="flex-1 flex flex-col bg-theme-bg h-full text-theme-text font-mono relative">
      {/* Editor Header */}
      <div className="h-12 border-b border-theme-border px-4 flex items-center justify-between text-xs bg-theme-sidebar-header select-none">
        <div className="flex items-center gap-2">
          <span className="font-mono bg-theme-active text-emerald-500 px-2 py-0.5 rounded border border-theme-border text-[10px] tracking-wider font-semibold uppercase">
            {extension} Editor
          </span>
          <span className="text-theme-darker">/</span>
          <span className="truncate max-w-xs text-theme-muted" title={filePath}>{filePath}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Toggle */}
          <button 
            onClick={() => setShowSearch(!showSearch)}
            className={`p-1.5 rounded border transition-all cursor-pointer ${
              showSearch 
                ? 'bg-theme-active border-theme-border-hover text-theme-white' 
                : 'bg-transparent border-theme-border text-theme-muted hover:text-theme-white'
            }`}
            title="Search Text"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {/* Copy Button */}
          <button 
            onClick={handleCopyAll}
            className="p-1.5 rounded border border-theme-border bg-transparent text-theme-muted hover:text-theme-white hover:bg-theme-hover transition-all cursor-pointer"
            title="Copy all text"
          >
            {copied ? <span className="text-emerald-400 text-[10px]">Copied!</span> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Save Status Indicators */}
          {isSaving ? (
            <div className="flex items-center gap-1.5 px-2 py-1 text-yellow-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-theme-white" />
              <span className="text-[10px]">Saving...</span>
            </div>
          ) : isLocalDirty ? (
            <button
              onClick={handleManualSave}
              className="px-2.5 py-1 text-theme-text bg-theme-active hover:bg-theme-hover rounded border border-theme-border flex items-center gap-1 cursor-pointer transition-all text-[11px]"
              title="Unsaved changes - click to save"
            >
              <Save className="w-3.5 h-3.5 text-yellow-500 animate-pulse" />
              <span>Save</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 px-2 py-1 text-emerald-500">
              <Check className="w-3.5 h-3.5" />
              <span className="text-[10px]">Saved</span>
            </div>
          )}
        </div>
      </div>

      {/* Inline Search Bar */}
      {showSearch && (
        <div className="bg-theme-active border-b border-theme-border px-4 py-2 flex items-center gap-2 animate-fade-in">
          <Search className="w-3.5 h-3.5 text-theme-muted shrink-0" />
          <input
            type="text"
            placeholder="Find text in document..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-theme-bg text-xs text-theme-text border border-theme-border outline-none px-2 py-1.5 rounded focus:border-theme-border-hover placeholder-theme-muted"
          />
          {searchQuery && (
            <span className="text-[10px] text-theme-muted px-2 font-sans shrink-0">
              {text.includes(searchQuery) 
                ? `${(text.match(new RegExp(searchQuery.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'gi')) || []).length} results` 
                : 'No results'}
            </span>
          )}
          <button 
            className="text-[10px] text-theme-muted hover:text-theme-white"
            onClick={() => { setSearchQuery(''); setShowSearch(false); }}
          >
            Close
          </button>
        </div>
      )}

      {/* Editor Main Canvas with gutter line numbers */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Line Numbers column */}
        <div className="py-4 select-none text-right pr-3 pl-4 bg-theme-bg border-r border-theme-border text-theme-darker text-[11px] leading-6 font-mono min-w-[3.5rem] scrollbar-hide overflow-hidden">
          {Array.from({ length: Math.max(1, lineCount) }).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Text Area Input */}
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          spellCheck="false"
          placeholder="Start typing some plaintext here..."
          className="flex-1 h-full py-4 px-4 resize-none bg-theme-bg text-theme-text text-[12px] leading-6 font-mono outline-none border-none select-text focus:ring-0 selection:bg-theme-active"
          style={{ whiteSpace: 'pre', overflowWrap: 'unset' }}
        />
      </div>

      {/* Status Footer bar */}
      <div className="h-6 border-t border-theme-border bg-theme-sidebar-header px-4 flex items-center justify-between text-[10px] text-theme-muted select-none font-sans shrink-0">
        <div className="flex items-center gap-4">
          <span>LINES: <strong className="text-neutral-400 font-mono">{lineCount}</strong></span>
          <span>WORDS: <strong className="text-neutral-400 font-mono">{wordCount}</strong></span>
          <span>SIZE: <strong className="text-neutral-400 font-mono">{displaySize}</strong></span>
        </div>
        <div>
          <span>UTF-8 Plaintext</span>
        </div>
      </div>
    </div>
  );
}
