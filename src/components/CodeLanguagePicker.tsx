import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown } from 'lucide-react';

interface LanguageOption {
  value: string;
  label: string;
}

const LANGUAGES: LanguageOption[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'tsx', label: 'TSX' },
  { value: 'jsx', label: 'JSX' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'bash', label: 'Bash' },
  { value: 'shell', label: 'Shell' },
  { value: 'sql', label: 'SQL' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Plain Text' },
];

export function getLanguageLabel(value: string): string {
  return LANGUAGES.find(l => l.value === value)?.label || value;
}

interface CodeLanguagePickerProps {
  value: string;
  onChange: (value: string) => void;
}

export default function CodeLanguagePicker({ value, onChange }: CodeLanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find(l => l.value === value) || { value, label: value };
  const filtered = LANGUAGES.filter(l =>
    l.label.toLowerCase().includes(search.toLowerCase()) ||
    l.value.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={dropdownRef} className="noted-lang-picker relative inline-flex">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono text-white/50 hover:text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors cursor-pointer"
      >
        <span className="truncate max-w-[80px]">{current.label}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-[#1e1e1e] border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/10">
            <Search className="w-3 h-3 text-white/30 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search language..."
              className="flex-1 bg-transparent text-white/70 text-[11px] outline-none placeholder:text-white/20 font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-white/30 font-mono">No results</div>
            ) : (
              filtered.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => {
                    onChange(lang.value);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors cursor-pointer ${
                    lang.value === value
                      ? 'text-white bg-white/10'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {lang.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
