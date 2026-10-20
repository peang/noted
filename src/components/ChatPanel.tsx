import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useChatStore, Message, stripSystemReminder } from '../store/chatStore';
import { useNoteStore } from '../store/noteStore';
import { toast } from 'sonner';
import { ArrowUp, ArrowDown, Square, Trash2, FolderInput, Key, KeyRound, ExternalLink, Sparkles, FileText, FileEdit, FilePlus, Check, X, Copy, History, SquarePen, AlertCircle, Loader2 } from 'lucide-react';
import { useFileMention } from '../hooks/useFileMention';
import FileMentionDropdown from './FileMentionDropdown';
import ModelPicker from './chat/ModelPicker';
import ChatHistory from './chat/ChatHistory';
import { Button, IconButton } from './ui/Button';
import ConfirmButton from './ui/ConfirmButton';
import { diffLines } from '../utils/lineDiff';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let fileLinkCache: { source: unknown; regex: RegExp | null } | null = null;

// One regex for every workspace path, rebuilt only when the file list changes
function getFileLinkRegex(): RegExp | null {
  const state = useNoteStore.getState();
  const source = state.isSimulated ? state.simulatedFiles : state.workspacePaths;
  if (fileLinkCache?.source === source) return fileLinkCache.regex;

  const paths = state.isSimulated
    ? state.simulatedFiles.filter(f => f.kind === 'file').map(f => f.path)
    : state.workspacePaths.filter(p => !p.endsWith('/'));
  const alternatives = paths
    .sort((a, b) => b.length - a.length)
    .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Whole paths only: todo.md must not match inside mytodo.md or archive/todo.md
  const regex = alternatives.length
    ? new RegExp(`(?<![\\w./-])(?:${alternatives.join('|')})(?![\\w/-]|\\.\\w)`, 'g')
    : null;
  fileLinkCache = { source, regex };
  return regex;
}

function renderInline(text: string): string {
  const regex = getFileLinkRegex();
  const refs: string[] = [];

  let result = regex
    ? text.replace(regex, (path) => {
        refs.push(path);
        return `\x00FR${refs.length - 1}\x00`;
      })
    : text;

  result = escapeHtml(result)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Function replacement so a path containing $& or $' isn't read as a replacement pattern
  return result.replace(/\x00FR(\d+)\x00/g, (_, i) => {
    const escapedPath = escapeHtml(refs[Number(i)]);
    return `<a class="file-ref-link" data-path="${escapedPath}">${escapedPath}</a>`;
  });
}

// Keeps empty cells so columns don't shift
function splitTableRow(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function renderMarkdown(text: string): React.ReactNode[] {
  const blocks = text.split('\n\n');
  const els: React.ReactNode[] = [];
  let tableRows: string[] = [];

  const flushTable = (i: number) => {
    if (tableRows.length < 2) { els.push(<p key={i}>{tableRows.join('\n')}</p>); tableRows = []; return; }
    const header = splitTableRow(tableRows[0]);
    const body = tableRows.slice(2).map(r => {
      const cells = splitTableRow(r).map(c => renderInline(c));
      return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
    }).join('');
    els.push(<table key={i} className="chat-table"><thead><tr>{header.map((h, j) => <th key={j}>{h}</th>)}</tr></thead><tbody dangerouslySetInnerHTML={{ __html: body }} /></table>);
    tableRows = [];
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const lines = block.split('\n');

    // Table block
    if (lines.every(l => l.trim().startsWith('|') && l.trim().endsWith('|'))) {
      tableRows.push(...lines);
      continue;
    }
    if (tableRows.length) { flushTable(i); }

    // Bullet list
    if (lines.every(l => l.trim().startsWith('- '))) {
      const items = lines.map(l => `<li>${renderInline(l.trim().slice(2))}</li>`).join('');
      els.push(<ul key={i} className="list-disc pl-4 space-y-0.5" dangerouslySetInnerHTML={{ __html: items }} />);
      continue;
    }

    // Numbered list
    if (lines.every(l => /^\d+\.\s/.test(l.trim()))) {
      const items = lines.map(l => `<li>${renderInline(l.trim().replace(/^\d+\.\s/, ''))}</li>`).join('');
      els.push(<ol key={i} className="list-decimal pl-4 space-y-0.5" dangerouslySetInnerHTML={{ __html: items }} />);
      continue;
    }

    // Horizontal rule
    if (lines.every(l => /^[-*]{3,}\s*$/.test(l.trim()))) {
      els.push(<hr key={i} className="border-t border-theme-border my-2" />);
      continue;
    }

    // Regular paragraph
    const html = lines.map(l => renderInline(l)).join('<br/>');
    els.push(<p key={i} dangerouslySetInnerHTML={{ __html: html }} />);
  }

  if (tableRows.length) flushTable(blocks.length);

  return els;
}

// Memoized: during streaming only the last message object changes
const MessageBubble = memo(function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const content = msg.content ? stripSystemReminder(msg.content) : '';
  const [copied, setCopied] = useState(false);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-br-md text-[13px] leading-relaxed whitespace-pre-wrap break-words bg-theme-active text-theme-white">
          {content}
        </div>
      </div>
    );
  }

  const copy = () => {
    navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error('Could not copy to the clipboard')
    );
  };

  return (
    <div className="group flex gap-2.5">
      <AssistantAvatar />
      <div className="flex-1 min-w-0">
        <div className="chat-bubble text-[13px] leading-relaxed text-theme-text break-words">
          {renderMarkdown(content)}
        </div>
        <div className="mt-1 h-5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <IconButton label={copied ? 'Copied' : 'Copy'} className="h-5 w-5" onClick={copy}>
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </IconButton>
        </div>
      </div>
    </div>
  );
});

function AssistantAvatar() {
  return (
    <div className="w-6 h-6 rounded-full bg-theme-active border border-theme-border flex items-center justify-center shrink-0 mt-0.5">
      <Sparkles className="w-3 h-3 text-theme-muted" />
    </div>
  );
}

const DIFF_CONTEXT_LINES = 2;

function WritePreview({ oldContent, content }: { oldContent: string | null; content: string }) {
  const lines = useMemo(
    () => (oldContent === null ? null : diffLines(oldContent, content)),
    [oldContent, content]
  );
  const boxClass = 'text-[10px] leading-relaxed font-mono bg-theme-bg/60 border border-theme-border rounded-lg p-2 max-h-48 overflow-y-auto thin-scrollbar whitespace-pre-wrap break-all';

  if (!lines) {
    return (
      <>
        {oldContent !== null && (
          <p className="text-[10px] text-theme-muted mb-1">Too large to diff — full new content:</p>
        )}
        <pre className={`${boxClass} text-theme-muted`}>{content}</pre>
      </>
    );
  }

  const changed = lines.map((l) => l.type !== 'same');
  const added = lines.filter((l) => l.type === 'add').length;
  const removed = lines.filter((l) => l.type === 'del').length;
  if (!added && !removed) {
    return <p className="text-[10px] text-theme-muted">No changes.</p>;
  }

  const rows: React.ReactNode[] = [];
  let hidden = 0;
  const flushHidden = (key: string) => {
    if (hidden) rows.push(<div key={key} className="text-theme-darker">⋯ {hidden} unchanged line{hidden !== 1 ? 's' : ''}</div>);
    hidden = 0;
  };
  lines.forEach((line, i) => {
    const nearChange = changed.slice(Math.max(0, i - DIFF_CONTEXT_LINES), i + DIFF_CONTEXT_LINES + 1).some(Boolean);
    if (!nearChange) {
      hidden++;
      return;
    }
    flushHidden(`gap-${i}`);
    const style = line.type === 'add' ? 'text-emerald-500 bg-emerald-500/10'
      : line.type === 'del' ? 'text-red-500 bg-red-500/10 line-through decoration-red-500/40'
      : 'text-theme-darker';
    const prefix = line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  ';
    rows.push(<div key={i} className={style}>{prefix}{line.text || ' '}</div>);
  });
  flushHidden('gap-end');

  return (
    <>
      <p className="text-[10px] font-mono mb-1">
        <span className="text-emerald-500">+{added}</span> <span className="text-red-500">−{removed}</span>
      </p>
      <div className={boxClass}>{rows}</div>
    </>
  );
}

function PendingWriteCard() {
  const pendingWrite = useChatStore((s) => s.pendingWrite);
  const approveWrite = useChatStore((s) => s.approveWrite);
  const rejectWrite = useChatStore((s) => s.rejectWrite);
  if (!pendingWrite) return null;
  const isNew = pendingWrite.oldContent === null;

  return (
    <div className="mx-3 mb-2 shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-amber-500/20">
        {isNew ? <FilePlus className="w-4 h-4 text-amber-500 shrink-0" /> : <FileEdit className="w-4 h-4 text-amber-500 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-theme-white">{isNew ? 'Create this file?' : 'Apply this edit?'}</p>
          <p className="text-[10px] font-mono text-theme-muted truncate" title={pendingWrite.path}>{pendingWrite.path}</p>
        </div>
      </div>
      <div className="px-3 pt-2.5">
        <WritePreview oldContent={pendingWrite.oldContent} content={pendingWrite.content} />
      </div>
      <div className="flex justify-end gap-2 px-3 py-2.5">
        <Button variant="secondary" onClick={rejectWrite}>
          <X className="w-3.5 h-3.5" /> Reject
        </Button>
        <Button variant="primary" onClick={approveWrite}>
          <Check className="w-3.5 h-3.5" /> Approve
        </Button>
      </div>
    </div>
  );
}

function PendingActionCard() {
  const action = useChatStore((s) => s.pendingAction);
  const approveWrite = useChatStore((s) => s.approveWrite);
  const rejectWrite = useChatStore((s) => s.rejectWrite);
  if (!action) return null;
  const isDelete = action.kind === 'delete';
  const tone = isDelete ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5';
  const divider = isDelete ? 'border-red-500/20' : 'border-amber-500/20';
  const count = action.items.length;
  const title = isDelete
    ? `Delete ${count} item${count !== 1 ? 's' : ''}?`
    : `Move ${count} file${count !== 1 ? 's' : ''}?`;

  return (
    <div className={`mx-3 mb-2 shrink-0 rounded-xl border overflow-hidden ${tone}`}>
      <div className={`flex items-center gap-2.5 px-3 py-2 border-b ${divider}`}>
        {isDelete
          ? <Trash2 className="w-4 h-4 text-red-500 shrink-0" />
          : <FolderInput className="w-4 h-4 text-amber-500 shrink-0" />}
        <p className="flex-1 text-xs font-semibold text-theme-white">{title}</p>
      </div>
      <ul className="px-3 pt-2.5 max-h-48 overflow-y-auto thin-scrollbar space-y-1.5 text-[11px] font-mono">
        {action.items.map((item, i) => (
          <li key={i} className="min-w-0">
            <span className={`block truncate ${isDelete ? 'text-red-500' : 'text-theme-muted line-through decoration-theme-darker'}`} title={item.label}>
              {item.label}
            </span>
            {item.detail && (
              <span className={`block truncate ${isDelete ? 'text-theme-darker' : 'text-emerald-500'}`} title={item.detail}>
                {isDelete ? item.detail : `→ ${item.detail}`}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="px-3 pt-2.5 space-y-1">
        {action.notes.map((note) => (
          <p key={note} className="text-[11px] text-theme-muted">{note}</p>
        ))}
        {action.warning && <p className="text-[11px] font-medium text-red-500">{action.warning}</p>}
      </div>
      <div className="flex justify-end gap-2 px-3 py-2.5">
        <Button variant="secondary" onClick={rejectWrite}>
          <X className="w-3.5 h-3.5" /> Reject
        </Button>
        <Button variant={isDelete ? 'danger' : 'primary'} className={isDelete ? 'border border-red-500/40' : ''} onClick={approveWrite}>
          <Check className="w-3.5 h-3.5" /> {isDelete ? 'Delete' : 'Approve'}
        </Button>
      </div>
    </div>
  );
}

function visibleMessages(messages: Message[]): Message[] {
  return messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content !== null);
}

function ApiKeySetup() {
  const [inputKey, setInputKey] = useState('');
  const [saving, setSaving] = useState(false);
  const setApiKey = useChatStore((s) => s.setApiKey);
  const chatError = useChatStore((s) => s.chatError);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = inputKey.trim();
    if (!key || saving) return;
    setSaving(true);
    await setApiKey(key);
    setSaving(false);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5 text-center">
      <div className="w-12 h-12 rounded-2xl bg-theme-active border border-theme-border flex items-center justify-center">
        <Key className="w-5 h-5 text-theme-white" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-theme-white">Connect OpenCode Go</h3>
        <p className="text-xs text-theme-muted leading-relaxed mt-1 max-w-[260px]">
          Paste your API key to chat with your notes. It is only stored in this browser.
        </p>
      </div>
      <form onSubmit={handleSave} className="w-full max-w-xs space-y-2">
        <input
          type="password"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          placeholder="oc-go-..."
          autoFocus
          className="w-full h-9 bg-theme-input border border-theme-border rounded-lg px-3 text-xs text-theme-text placeholder-theme-darker outline-none focus:border-theme-border-hover transition-colors"
        />
        {chatError && <p role="alert" className="text-[11px] text-red-500 text-left">{chatError}</p>}
        <Button type="submit" variant="primary" size="md" className="w-full" disabled={!inputKey.trim() || saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {saving ? 'Checking...' : 'Save key'}
        </Button>
      </form>
      <a
        href="https://opencode.ai/auth"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-theme-muted hover:text-theme-white flex items-center gap-1 transition-colors"
      >
        Get an API key <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

function EmptyState({ activeTab, onPick }: { activeTab: string | null; onPick: (text: string) => void }) {
  const suggestions = [
    activeTab ? `Summarize @${activeTab}` : null,
    'List every open task and TODO in my notes',
    'Which notes mention ',
  ].filter((s): s is string => s !== null);

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-4">
      <div className="w-12 h-12 rounded-2xl bg-theme-active border border-theme-border flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-theme-white" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-theme-white">Ask your notes</h3>
        <p className="text-xs text-theme-muted leading-relaxed mt-1 max-w-[280px]">
          Chat can read the files in this workspace and propose edits that you approve first.
        </p>
      </div>
      <div className="flex flex-col gap-1.5 w-full max-w-xs">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="px-3 py-2 rounded-lg border border-theme-border text-xs text-theme-muted hover:text-theme-white hover:bg-theme-hover hover:border-theme-border-hover text-left truncate cursor-pointer transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const model = useChatStore((s) => s.model);
  const availableModels = useChatStore((s) => s.availableModels);
  const isLoading = useChatStore((s) => s.isLoading);
  const chatError = useChatStore((s) => s.chatError);
  const aiStatus = useChatStore((s) => s.aiStatus);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const activeTab = useNoteStore((s) => s.activeTab);
  const workspaceCounts = useNoteStore((s) => s.workspaceCounts);

  const pendingWrite = useChatStore((s) => s.pendingWrite);
  const pendingAction = useChatStore((s) => s.pendingAction);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const setModel = useChatStore((s) => s.setModel);
  const lastUsage = useChatStore((s) => s.lastUsage);

  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const mention = useFileMention(input, cursorPos);
  // Escape hides the dropdown for the @ it was opened for, until the user starts a new mention
  const [dismissedMentionAt, setDismissedMentionAt] = useState<number | null>(null);
  const mentionOpen = mention.active && mention.start !== dismissedMentionAt;
  const stickToBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const visible = visibleMessages(messages);
  const lastMessage = messages[messages.length - 1];
  // Feedback is needed whenever nothing is streaming: before the first token and, after a tool call,
  // while the next round is awaited (the last message is then the tool result, not streamed text)
  const showThinking = isLoading && !pendingWrite && !pendingAction &&
    (!!aiStatus || !lastMessage || lastMessage.role === 'user' || lastMessage.role === 'tool');

  const handleMentionSelect = useCallback((path: string) => {
    const textBefore = input.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx === -1) return;
    const suffix = input.slice(cursorPos);
    const spacer = suffix && !suffix.startsWith(' ') && !suffix.startsWith('\n') ? ' ' : '';
    const newInput = input.slice(0, atIdx) + '@' + path + spacer + suffix;
    setInput(newInput);
    const newPos = atIdx + path.length + 1 + spacer.length;
    setCursorPos(newPos);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newPos;
        textareaRef.current.selectionEnd = newPos;
      }
    });
  }, [input, cursorPos]);

  const handleMentionClose = useCallback(() => {
    setDismissedMentionAt(mention.start);
  }, [mention.start]);

  useEffect(() => {
    if (!mention.active) setDismissedMentionAt(null);
  }, [mention.active]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
    setShowJump(false);
  }, []);

  // Follow new tokens only while the user is at the bottom, so they can scroll up and read
  useEffect(() => {
    if (listRef.current && stickToBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, showThinking]);

  // Opening another chat starts at its latest message
  useEffect(() => {
    scrollToBottom();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [activeSessionId, scrollToBottom]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  useEffect(() => {
    if (isLoading) return;
    requestAnimationFrame(() => {
      // Don't pull the cursor out of the editor when an answer finishes
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('[data-chat-panel]')) {
        textareaRef.current?.focus();
      }
    });
  }, [isLoading]);

  const handleSend = () => {
    const content = input.trim();
    if (!content || isLoading) return;
    setInput('');
    setCursorPos(0);
    scrollToBottom();
    sendMessage(content);
  };

  const pickSuggestion = (text: string) => {
    setInput(text);
    setCursorPos(text.length);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = text.length;
    });
  };

  const canSend = !!input.trim();

  return (
    <>
      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={listRef}
          className="h-full overflow-y-auto px-4 py-4 thin-scrollbar space-y-5"
          onScroll={() => {
            const el = listRef.current;
            if (!el) return;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            stickToBottomRef.current = atBottom;
            setShowJump(!atBottom);
          }}
          onClick={(e) => {
            const link = (e.target as HTMLElement).closest('.file-ref-link');
            if (link) {
              e.preventDefault();
              const path = link.getAttribute('data-path');
              if (path) useNoteStore.getState().openFile(path);
            }
          }}
        >
          {visible.length === 0 && !isLoading && <EmptyState activeTab={activeTab} onPick={pickSuggestion} />}
          {visible.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
          {showThinking && (
            <div className="flex gap-2.5 items-center">
              <AssistantAvatar />
              {aiStatus ? (
                <span className="flex items-center gap-1.5 text-xs text-theme-muted">
                  <Loader2 className="w-3 h-3 animate-spin" /> {aiStatus}
                </span>
              ) : (
                <span className="flex items-center gap-1" aria-label="Thinking">
                  {[0, 150, 300].map((delay) => (
                    <span key={delay} className="w-1.5 h-1.5 bg-theme-darker rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </span>
              )}
            </div>
          )}
          {chatError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span className="flex-1 break-words">{chatError}</span>
            </div>
          )}
        </div>
        {showJump && (
          <IconButton
            label="Jump to latest"
            variant="secondary"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 h-8 w-8 rounded-full shadow-lg bg-theme-card"
            onClick={scrollToBottom}
          >
            <ArrowDown className="w-4 h-4" />
          </IconButton>
        )}
      </div>

      <PendingWriteCard />
      <PendingActionCard />

      {/* Composer */}
      <div className="px-3 pb-3 pt-1 shrink-0">
        <div
          className="relative"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const path = e.dataTransfer.getData('text/plain');
            if (path) {
              const prefix = input.length > 0 && !input.endsWith(' ') ? ' ' : '';
              setInput(prev => prev + prefix + '@' + path + ' ');
              textareaRef.current?.focus();
            }
          }}
        >
          {mentionOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
              <FileMentionDropdown
                searchTerm={mention.searchTerm}
                onSelect={handleMentionSelect}
                onClose={handleMentionClose}
                inputRef={textareaRef}
              />
            </div>
          )}
          <div className="rounded-2xl border border-theme-border bg-theme-input focus-within:border-theme-border-hover transition-colors shadow-sm">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCursorPos(e.target.selectionStart);
              }}
              onSelect={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onClick={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onKeyDown={(e) => {
                // The mention dropdown already handled this key
                if (e.nativeEvent.defaultPrevented) return;
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                } else if (e.key === 'Escape' && isLoading) {
                  stopGeneration();
                }
              }}
              // Stays editable while an answer streams (a read-only field hides the caret and
              // looks like lost focus); sending is blocked in handleSend until it finishes
              placeholder={isLoading ? 'Answering… type your next message (Esc to stop)' : 'Ask about your notes...'}
              rows={1}
              className="w-full bg-transparent px-3.5 pt-3 pb-1 text-[13px] text-theme-text placeholder-theme-darker outline-none resize-none overflow-y-auto min-h-[44px] max-h-[200px] leading-relaxed"
            />
            <div className="flex items-center gap-1 px-2 pb-2">
              <ModelPicker value={model} models={availableModels} onChange={setModel} disabled={isLoading} />
              {activeTab && (
                <span
                  className="flex items-center gap-1 min-w-0 px-1.5 text-[11px] text-theme-darker"
                  title={`Open file: ${activeTab} · ${workspaceCounts.files} file${workspaceCounts.files !== 1 ? 's' : ''} in workspace`}
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{activeTab.split('/').pop()}</span>
                </span>
              )}
              <div className="flex-1" />
              {lastUsage && !isLoading && (
                <span
                  className="hidden sm:block text-[10px] text-theme-darker font-mono tabular-nums mr-1"
                  title={lastUsage.reasoning > 0 ? `${(lastUsage.reasoning / 1000).toFixed(1)}k reasoning tokens` : undefined}
                >
                  {(lastUsage.prompt / 1000).toFixed(1)}k in · {(lastUsage.completion / 1000).toFixed(1)}k out
                </span>
              )}
              <button
                type="button"
                onClick={isLoading ? stopGeneration : handleSend}
                disabled={!isLoading && !canSend}
                title={isLoading ? 'Stop' : 'Send'}
                aria-label={isLoading ? 'Stop generating' : 'Send message'}
                className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  isLoading || canSend
                    ? 'bg-theme-white text-theme-bg hover:opacity-90 cursor-pointer'
                    : 'bg-theme-active text-theme-darker cursor-not-allowed'
                }`}
              >
                {isLoading ? <Square className="w-3.5 h-3.5 fill-current" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-theme-darker select-none">
          Enter to send · Shift+Enter for a new line · @ to mention a file
        </p>
      </div>
    </>
  );
}

export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const apiKey = useChatStore((s) => s.apiKey);
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const newChat = useChatStore((s) => s.newChat);
  const clearApiKey = useChatStore((s) => s.clearApiKey);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (apiKey) {
      useChatStore.getState().fetchModels();
    }
  }, []);

  const title = sessions.find((s) => s.id === activeSessionId)?.title ?? 'New chat';
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  return (
    <div data-chat-panel className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="h-12 shrink-0 flex items-center gap-1 px-2 border-b border-theme-border bg-theme-sidebar-header">
        {apiKey && (
          <IconButton
            label={historyOpen ? 'Back to chat' : 'Chat history'}
            active={historyOpen}
            onClick={() => setHistoryOpen((o) => !o)}
          >
            <History className="w-4 h-4" />
          </IconButton>
        )}
        <div className="flex-1 min-w-0 px-1.5 flex items-center gap-1.5">
          {!apiKey && <Sparkles className="w-3.5 h-3.5 text-theme-muted shrink-0" />}
          <span className="text-xs font-semibold text-theme-white truncate" title={apiKey ? title : undefined}>
            {!apiKey ? 'Chat' : historyOpen ? 'History' : title}
          </span>
        </div>
        {apiKey && (
          <>
            <IconButton label="New chat" onClick={() => { newChat(); setHistoryOpen(false); }}>
              <SquarePen className="w-4 h-4" />
            </IconButton>
            <ConfirmButton
              label="Remove API key"
              confirmLabel="Remove key?"
              onConfirm={() => {
                clearApiKey();
                setHistoryOpen(false);
                toast.info('API key removed. Your chats are kept.');
              }}
            >
              <KeyRound className="w-4 h-4" />
            </ConfirmButton>
          </>
        )}
        <IconButton label="Close chat" onClick={onClose}>
          <X className="w-4 h-4" />
        </IconButton>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col">
        {apiKey ? <ChatView /> : <ApiKeySetup />}
        {apiKey && historyOpen && <ChatHistory onClose={closeHistory} />}
      </div>
    </div>
  );
}
