import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNoteStore } from '../store/noteStore';
import { FileText, Search } from 'lucide-react';

interface FileEntry {
  name: string;
  path: string;
  parentPath: string;
}

interface FileMentionDropdownProps {
  searchTerm: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

function getMatchScore(entry: FileEntry, term: string): number {
  if (!term) return -1;
  const lower = term.toLowerCase();
  const name = entry.name.toLowerCase();
  const path = entry.path.toLowerCase();

  if (name === lower) return 5;
  if (name.startsWith(lower)) return 4;
  if (name.includes(lower)) return 3;
  if (path.includes(lower)) return 2;
  return 0;
}

function nameFromPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function parentPathFromPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export default function FileMentionDropdown({ searchTerm, onSelect, onClose }: FileMentionDropdownProps) {
  const isSimulated = useNoteStore((s) => s.isSimulated);
  const simulatedFiles = useNoteStore((s) => s.simulatedFiles);
  const workspacePaths = useNoteStore((s) => s.workspacePaths);
  const activeTab = useNoteStore((s) => s.activeTab);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const allFiles = useMemo(() => {
    if (isSimulated) {
      return simulatedFiles
        .filter((f) => f.kind === 'file')
        .map((f) => ({
          name: f.path.split('/').pop() || f.path,
          path: f.path,
          parentPath: parentPathFromPath(f.path),
        }));
    }
    return workspacePaths
      .filter((p) => !p.endsWith('/'))
      .map((p) => ({
        name: nameFromPath(p),
        path: p,
        parentPath: parentPathFromPath(p),
      }));
  }, [isSimulated, simulatedFiles, workspacePaths]);

  const filtered = useMemo(() => {
    let matched = allFiles.filter((f) => getMatchScore(f, searchTerm) > 0);
    matched.sort((a, b) => {
      if (a.path === activeTab) return -1;
      if (b.path === activeTab) return 1;
      const sa = getMatchScore(a, searchTerm);
      const sb = getMatchScore(b, searchTerm);
      if (sa !== sb) return sb - sa;
      return a.name.localeCompare(b.name);
    });
    if (!searchTerm) {
      matched = allFiles.slice().sort((a, b) => {
        if (a.path === activeTab) return -1;
        if (b.path === activeTab) return 1;
        return a.name.localeCompare(b.name);
      });
    }
    return matched;
  }, [allFiles, searchTerm, activeTab]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [searchTerm]);

  useEffect(() => {
    if (highlightIdx >= filtered.length) {
      setHighlightIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlightIdx]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[highlightIdx]) {
          onSelect(filtered[highlightIdx].path);
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, highlightIdx, onSelect, onClose]);

  const displayName = (name: string) => {
    if (name.endsWith('.md')) return name.replace(/\.md$/, '');
    return name;
  };

  if (filtered.length === 0) {
    return (
      <div className="bg-theme-card border border-theme-border rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-theme-darker">
          <FileText className="w-3.5 h-3.5 shrink-0" />
          No matching files
        </div>
      </div>
    );
  }

  return (
    <div className="bg-theme-card border border-theme-border rounded-lg shadow-xl overflow-hidden">
      <div className="px-3 py-1.5 border-b border-theme-border flex items-center gap-1.5">
        <Search className="w-3 h-3 text-theme-darker shrink-0" />
        <span className="text-[10px] text-theme-darker font-mono">
          {filtered.length} file{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto thin-scrollbar">
        {filtered.map((entry, i) => (
          <div
            key={entry.path}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(entry.path);
            }}
            onMouseEnter={() => setHighlightIdx(i)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors ${
              i === highlightIdx
                ? 'bg-theme-active text-theme-white'
                : 'text-theme-text hover:bg-theme-hover'
            }`}
          >
            <FileText className="w-3.5 h-3.5 shrink-0 text-theme-darker" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="truncate leading-tight">{displayName(entry.name)}</span>
              {entry.parentPath && (
                <span className="truncate text-[10px] text-theme-darker leading-tight">
                  {entry.parentPath}/
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
