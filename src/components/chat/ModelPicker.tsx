import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

interface ModelOption {
  id: string;
  name: string;
}

interface ModelPickerProps {
  value: string;
  models: ModelOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
}

// "glm-5.3" -> "glm", "claude-haiku-5-5" -> "claude": the provider family is the leading letters
function familyOf(id: string): string {
  return id.match(/^[a-z]+/i)?.[0].toLowerCase() ?? 'other';
}

export default function ModelPicker({ value, models, onChange, disabled }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => m.name.toLowerCase().includes(q)) : models;
  }, [models, query]);

  // Keep the API's order inside each family and the order families first appear in
  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const m of filtered) {
      const family = familyOf(m.id);
      if (!map.has(family)) map.set(family, []);
      map.get(family)!.push(m);
    }
    return [...map.entries()];
  }, [filtered]);

  // Flat in display order, so the arrow keys follow what is on screen
  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const current = flat.findIndex((m) => m.id === value);
    setHighlight(Math.max(0, current));
    requestAnimationFrame(() => searchRef.current?.focus());
    // Only when opening; typing must not reset the highlight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[highlight]) select(flat[highlight].id);
    }
  };

  let index = -1;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose model"
        className="flex items-center gap-1 h-7 pl-2 pr-1.5 max-w-full rounded-md text-[11px] font-mono text-theme-muted hover:text-theme-white hover:bg-theme-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className="truncate">{value}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-theme-card border border-theme-border rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-in"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-theme-border">
            <Search className="w-3.5 h-3.5 text-theme-darker shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${models.length} models...`}
              className="flex-1 min-w-0 bg-transparent text-xs text-theme-text placeholder-theme-darker outline-none"
            />
          </div>
          <div ref={listRef} role="listbox" className="max-h-72 overflow-y-auto thin-scrollbar py-1">
            {models.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-theme-darker">No models loaded yet.</div>
            ) : flat.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-theme-darker">No model matches “{query}”.</div>
            ) : (
              groups.map(([family, items]) => (
                <div key={family}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase text-theme-darker">
                    {family}
                  </div>
                  {items.map((m) => {
                    index++;
                    const i = index;
                    const selected = m.id === value;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-idx={i}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => select(m.id)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono cursor-pointer transition-colors ${
                          i === highlight ? 'bg-theme-hover text-theme-white' : 'text-theme-text'
                        }`}
                      >
                        <span className="flex-1 truncate">{m.name}</span>
                        {selected && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
