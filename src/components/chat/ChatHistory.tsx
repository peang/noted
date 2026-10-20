import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Pencil, Trash2, MessageSquare, X } from 'lucide-react';
import { useChatStore, sessionBelongsTo, workspaceKeyOf, ChatSession } from '../../store/chatStore';
import { useNoteStore } from '../../store/noteStore';
import { IconButton } from '../ui/Button';
import ConfirmButton from '../ui/ConfirmButton';

const DAY_MS = 86_400_000;

function groupOf(ts: number): string {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - DAY_MS) return 'Yesterday';
  if (ts >= startOfToday - 6 * DAY_MS) return 'Previous 7 days';
  return 'Older';
}

function relativeTime(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function turnCount(session: ChatSession): number {
  return session.messages.filter((m) => m.role === 'user').length;
}

function SessionRow({ session, active, onOpen }: { session: ChatSession; active: boolean; onOpen: () => void }) {
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    renameSession(session.id, draft);
    setRenaming(false);
  };

  const turns = turnCount(session);

  return (
    <div
      onClick={() => !renaming && onOpen()}
      className={`group relative flex items-center gap-2 mx-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
        active ? 'bg-theme-active' : 'hover:bg-theme-hover'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-theme-white" />}
      <div className="flex-1 min-w-0">
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false); }
            }}
            className="w-full bg-theme-input border border-theme-border-hover rounded px-1.5 py-0.5 text-xs text-theme-text outline-none"
          />
        ) : (
          <div className="text-xs font-medium text-theme-text truncate">{session.title}</div>
        )}
        <div className="text-[10px] text-theme-darker mt-0.5">
          {relativeTime(session.updatedAt)} · {turns} message{turns !== 1 ? 's' : ''}
        </div>
      </div>
      {!renaming && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <IconButton
            label="Rename"
            onClick={(e) => { e.stopPropagation(); setDraft(session.title); setRenaming(true); }}
          >
            <Pencil className="w-3.5 h-3.5" />
          </IconButton>
          <ConfirmButton label="Delete chat" confirmLabel="Delete?" onConfirm={() => deleteSession(session.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}

export default function ChatHistory({ onClose }: { onClose: () => void }) {
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const openSession = useChatStore((s) => s.openSession);
  const deleteWorkspaceSessions = useChatStore((s) => s.deleteWorkspaceSessions);
  const workspace = useNoteStore((s) => workspaceKeyOf(s));
  const folderName = useNoteStore((s) => s.folderName);
  const isSimulated = useNoteStore((s) => s.isSimulated);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mine = useMemo(
    () => sessions.filter((s) => sessionBelongsTo(s, workspace)).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, workspace]
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? mine.filter((s) => s.title.toLowerCase().includes(q) || s.messages.some((m) => m.content?.toLowerCase().includes(q)))
      : mine;
    const groups = new Map<string, ChatSession[]>();
    for (const s of matches) {
      const g = groupOf(s.updatedAt);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(s);
    }
    return { groups: [...groups.entries()], total: matches.length };
  }, [mine, query]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-theme-sidebar-bg animate-fade-in">
      <div className="px-3 py-2.5 border-b border-theme-border">
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-theme-input border border-theme-border focus-within:border-theme-border-hover transition-colors">
          <Search className="w-3.5 h-3.5 text-theme-darker shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats..."
            className="flex-1 min-w-0 bg-transparent text-xs text-theme-text placeholder-theme-darker outline-none"
          />
          {query && (
            <IconButton label="Clear search" className="h-5 w-5" onClick={() => setQuery('')}>
              <X className="w-3 h-3" />
            </IconButton>
          )}
        </div>
        <p className="mt-2 px-0.5 text-[10px] text-theme-darker truncate">
          Chats in {isSimulated ? 'the sandbox' : `“${folderName}”`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar py-2">
        {grouped.total === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-theme-darker">
            <MessageSquare className="w-6 h-6" />
            <p className="text-xs">{query ? `No chat matches “${query}”.` : 'No saved chats yet. Start one and it will show up here.'}</p>
          </div>
        ) : (
          grouped.groups.map(([label, items]) => (
            <div key={label} className="mb-2">
              <div className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase text-theme-darker">{label}</div>
              {items.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === activeSessionId}
                  onOpen={() => { openSession(s.id); onClose(); }}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {mine.length > 0 && (
        <div className="px-3 py-2 border-t border-theme-border flex items-center justify-between gap-2">
          <span className="text-[10px] text-theme-darker">{mine.length} saved</span>
          <ConfirmButton
            label="Delete all chats in this workspace"
            confirmLabel="Delete all?"
            onConfirm={deleteWorkspaceSessions}
            text="Delete all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
