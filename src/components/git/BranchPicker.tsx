import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Check, Plus, GitBranch, Cloud } from 'lucide-react';
import { useGitStore } from '../../store/gitStore';

// What git accepts for a branch name, in the part users type (spaces become dashes while typing)
function validBranchName(name: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !/^[-/.]|[/.]$|\.\.|\/\/|\.lock$/.test(name);
}

interface Item {
  name: string;
  kind: 'local' | 'remote' | 'create';
}

export default function BranchPicker({ onClose }: { onClose: () => void }) {
  const branch = useGitStore((s) => s.branch);
  const branches = useGitStore((s) => s.branches);
  const remoteOnly = useGitStore((s) => s.remoteOnlyBranches);
  const changeCount = useGitStore((s) => s.changes.length);
  const checkout = useGitStore((s) => s.checkout);

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const items = useMemo<Item[]>(() => {
    const match = (n: string) => n.toLowerCase().includes(q.toLowerCase());
    const list: Item[] = [
      ...branches.filter(match).map((name) => ({ name, kind: 'local' as const })),
      ...remoteOnly.filter(match).map((name) => ({ name, kind: 'remote' as const })),
    ];
    if (q && !branches.includes(q) && !remoteOnly.includes(q)) list.push({ name: q, kind: 'create' });
    return list;
  }, [branches, remoteOnly, q]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setHighlight(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const choose = async (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === 'create' && !validBranchName(item.name)) return;
    if (item.kind === 'local' && item.name === branch) return onClose();
    onClose();
    await checkout(item.name, item.kind === 'create');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void choose(items[highlight]);
    }
  };

  const groupLabel = (kind: Item['kind']) => (kind === 'local' ? 'Branches' : kind === 'remote' ? 'On origin' : 'New branch');

  return (
    <div
      className="absolute left-3 right-3 top-full mt-1 z-40 bg-theme-card border border-theme-border rounded-xl shadow-2xl overflow-hidden animate-fade-in"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-theme-border">
        <Search className="w-3.5 h-3.5 text-theme-darker shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value.replace(/\s+/g, '-'))}
          placeholder="Find or create a branch..."
          className="flex-1 min-w-0 bg-transparent text-xs text-theme-text placeholder-theme-darker outline-none"
        />
      </div>
      {changeCount > 0 && (
        <p className="px-3 py-1.5 text-[10px] leading-snug text-amber-500 border-b border-theme-border">
          {changeCount} uncommitted change{changeCount !== 1 ? 's' : ''} will come along; git stops if they would be overwritten.
        </p>
      )}
      <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto thin-scrollbar py-1">
        {items.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-theme-darker">No branch yet.</div>
        ) : (
          items.map((item, i) => {
            const showHeader = i === 0 || items[i - 1].kind !== item.kind;
            const invalid = item.kind === 'create' && !validBranchName(item.name);
            return (
              <div key={`${item.kind}:${item.name}`}>
                {showHeader && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase text-theme-darker">{groupLabel(item.kind)}</div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={item.name === branch && item.kind === 'local'}
                  data-idx={i}
                  disabled={invalid}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => void choose(item)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    i === highlight ? 'bg-theme-hover text-theme-white' : 'text-theme-text'
                  }`}
                >
                  {item.kind === 'create' ? (
                    <Plus className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                  ) : item.kind === 'remote' ? (
                    <Cloud className="w-3.5 h-3.5 shrink-0 text-theme-darker" />
                  ) : (
                    <GitBranch className="w-3.5 h-3.5 shrink-0 text-theme-darker" />
                  )}
                  <span className="flex-1 truncate">
                    {item.kind === 'create' ? (invalid ? `“${item.name}” is not a valid branch name` : `Create “${item.name}”`) : item.name}
                  </span>
                  {item.kind === 'local' && item.name === branch && <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
