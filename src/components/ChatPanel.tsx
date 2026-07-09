import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore, Message } from '../store/chatStore';
import { useNoteStore } from '../store/noteStore';
import { toast } from 'sonner';
import { Send, Key, ExternalLink, Trash2, Sparkles, Loader2, FileText, Folder, FileEdit, Check, X } from 'lucide-react';
import { useFileMention } from '../hooks/useFileMention';
import FileMentionDropdown from './FileMentionDropdown';

function stripSystemReminder(text: string): string {
  const idx = text.indexOf('<system-reminder>');
  if (idx !== -1) text = text.slice(0, idx).trim();
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getCurrentFilePaths(): string[] {
  const state = useNoteStore.getState();
  if (state.isSimulated) {
    return state.simulatedFiles.filter(f => f.kind === 'file').map(f => f.path);
  }
  return state.workspacePaths.filter(p => !p.endsWith('/'));
}

function renderInline(text: string): string {
  const filePaths = getCurrentFilePaths();

  let result = text;
  const refs: string[] = [];

  const sorted = [...filePaths].sort((a, b) => b.length - a.length);
  for (const path of sorted) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), () => {
      refs.push(path);
      return `\x00FR${refs.length - 1}\x00`;
    });
  }

  result = escapeHtml(result)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');

  for (let i = 0; i < refs.length; i++) {
    const escapedPath = escapeHtml(refs[i]);
    result = result.replace(`\x00FR${i}\x00`, `<a class="file-ref-link" data-path="${escapedPath}">${escapedPath}</a>`);
  }

  return result;
}

function renderMarkdown(text: string): React.ReactNode[] {
  const blocks = text.split('\n\n');
  const els: React.ReactNode[] = [];
  let tableRows: string[] = [];

  const flushTable = (i: number) => {
    if (tableRows.length < 2) { els.push(<p key={i}>{tableRows.join('\n')}</p>); tableRows = []; return; }
    const header = tableRows[0].split('|').filter(c => c.trim()).map(c => c.trim());
    const body = tableRows.slice(2).map(r => {
      const cells = r.split('|').filter(c => c.trim()).map(c => renderInline(c.trim()));
      return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
    }).join('');
    els.push(<table key={i} className="chat-table"><thead><tr>{header.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody dangerouslySetInnerHTML={{ __html: body }} /></table>);
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

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const content = msg.content ? stripSystemReminder(msg.content) : '';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {isUser ? (
        <div className="max-w-[85%] px-3 py-2 rounded-lg rounded-br-sm text-xs leading-relaxed whitespace-pre-wrap bg-theme-active text-theme-white">
          {content}
        </div>
      ) : (
        <div className="chat-bubble max-w-[85%] px-3 py-2 rounded-lg rounded-bl-sm text-xs leading-relaxed bg-theme-card border border-theme-border text-theme-text">
          {renderMarkdown(content)}
        </div>
      )}
    </div>
  );
}

function visibleMessages(messages: Message[]): Message[] {
  return messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content !== null);
}

function ApiKeySetup() {
  const [inputKey, setInputKey] = useState('');
  const setApiKey = useChatStore((s) => s.setApiKey);
  const chatError = useChatStore((s) => s.chatError);

  const handleSave = () => {
    const key = inputKey.trim();
    if (key) setApiKey(key);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 gap-4 text-center">
      <Key className="w-8 h-8 text-theme-darker" />
      <div>
        <h3 className="text-sm font-semibold text-theme-white mb-1">OpenCode Go API Key</h3>
        <p className="text-[11px] text-theme-muted leading-relaxed">
          Enter your OpenCode Go API key to enable AI chat.
        </p>
      </div>
      <input
        type="password"
        value={inputKey}
        onChange={(e) => setInputKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        placeholder="oc-go-..."
        className="w-full bg-theme-input border border-theme-border rounded px-3 py-2 text-xs text-theme-text placeholder-theme-darker outline-none focus:border-theme-border-hover"
      />
      {chatError && (
        <p className="text-[11px] text-red-400">{chatError}</p>
      )}
      <button
        onClick={handleSave}
        disabled={!inputKey.trim()}
        className="w-full bg-theme-active hover:bg-theme-hover text-theme-white border border-theme-border rounded px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        Save Key
      </button>
      <a
        href="https://opencode.ai/auth"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-theme-muted hover:text-theme-white flex items-center gap-1 transition-colors"
      >
        Get API key from opencode.ai <ExternalLink className="w-3 h-3" />
      </a>
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
  const folderName = useNoteStore((s) => s.folderName);
  const activeTab = useNoteStore((s) => s.activeTab);
  const workspaceCounts = useNoteStore((s) => s.workspaceCounts);

  const pendingWrite = useChatStore((s) => s.pendingWrite);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setModel = useChatStore((s) => s.setModel);
  const lastUsage = useChatStore((s) => s.lastUsage);
  const clearChat = useChatStore((s) => s.clearChat);
  const clearApiKey = useChatStore((s) => s.clearApiKey);
  const approveWrite = useChatStore((s) => s.approveWrite);
  const rejectWrite = useChatStore((s) => s.rejectWrite);

  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const mention = useFileMention(input, cursorPos);

  const fileCount = workspaceCounts.files;
  const contextLabel = activeTab
    ? `Active: ${activeTab} · ${fileCount} file${fileCount !== 1 ? 's' : ''} in workspace`
    : `${fileCount} file${fileCount !== 1 ? 's' : ''} in workspace`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [isLoading]);

  const handleSend = () => {
    const content = input.trim();
    if (!content || isLoading) return;
    setInput('');
    setCursorPos(0);
    sendMessage(content);
  };

  return (
    <>
      {/* Model selector + actions */}
      <div className="px-3 py-2 border-b border-theme-border flex items-center gap-2">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="flex-1 bg-theme-input border border-theme-border rounded px-2 py-1 text-[10px] text-theme-text outline-none focus:border-theme-border-hover"
        >
          {availableModels.length === 0 && (
            <option value={model}>{model}</option>
          )}
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            toast('Start a new chat?', {
              description: 'This will clear the current conversation.',
              duration: 10000,
              action: {
                label: 'Clear',
                onClick: () => clearChat(),
              },
            });
          }}
          title="Start a new chat session"
          className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border border-sky-500/30 text-sky-400 hover:text-sky-400 hover:bg-theme-hover cursor-pointer transition-all shrink-0"
        >
          New Chat
        </button>
        <button
          onClick={() => {
            toast('Remove API key?', {
              description: 'You will need to re-enter it to use the chat.',
              duration: 10000,
              action: {
                label: 'Remove',
                onClick: () => {
                  clearApiKey();
                  toast.info('API key removed');
                },
              },
            });
          }}
          title="Remove API key"
          className="text-theme-darker hover:text-red-400 p-1 rounded hover:bg-theme-hover cursor-pointer shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Context bar */}
      <div className="px-3 py-1.5 border-b border-theme-border bg-theme-sidebar-header flex items-center gap-1.5 text-[10px] text-theme-darker font-mono">
        <FileText className="w-3 h-3 shrink-0" />
        <span className="truncate">{contextLabel}</span>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 thin-scrollbar space-y-3"
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest('.file-ref-link');
          if (link) {
            e.preventDefault();
            const path = link.getAttribute('data-path');
            if (path) useNoteStore.getState().openFile(path);
          }
        }}
      >
        {visibleMessages(messages).length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-theme-darker">
            <Sparkles className="w-6 h-6" />
            <p className="text-[11px]">Ask anything about your notes</p>
          </div>
        )}
        {visibleMessages(messages).map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {isLoading && visibleMessages(messages).length > 0 && (
          <div className="flex justify-start">
            <div className="bg-theme-card border border-theme-border rounded-lg rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-theme-darker rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-theme-darker rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-theme-darker rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        {chatError && (
          <p className="text-[11px] text-red-400 text-center">{chatError}</p>
        )}
        {aiStatus && (
          <div className="flex justify-start">
            <div className="text-[10px] text-theme-muted italic px-1 py-0.5">{aiStatus}</div>
          </div>
        )}
      </div>

      {/* Pending write confirmation */}
      {pendingWrite && (
        <div className="mx-3 my-2 p-3 bg-yellow-950/40 border border-yellow-700/50 rounded-lg">
          <div className="flex items-start gap-2">
            <FileEdit className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-yellow-300 mb-1">AI wants to edit a file</p>
              <p className="text-[10px] text-yellow-400/80 font-mono mb-2 truncate">{pendingWrite.path}</p>
              <pre className="text-[10px] text-yellow-200/70 bg-black/30 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all mb-3">
                {pendingWrite.content.length > 600
                  ? pendingWrite.content.slice(0, 600) + '...'
                  : pendingWrite.content}
              </pre>
              <div className="flex gap-2">
                <button
                  onClick={approveWrite}
                  className="flex items-center gap-1 px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-[10px] font-semibold cursor-pointer transition-colors"
                >
                  <Check className="w-3 h-3" /> Approve
                </button>
                <button
                  onClick={rejectWrite}
                  className="flex items-center gap-1 px-3 py-1 bg-red-800/60 hover:bg-red-700 text-red-300 rounded text-[10px] font-semibold cursor-pointer transition-colors"
                >
                  <X className="w-3 h-3" /> Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Token usage + Input */}
      {/* Input */}
      <div className="border-t border-theme-border">
        {/* Token usage bar */}
        {lastUsage && !isLoading && (
          <div className="px-3 py-1 bg-theme-sidebar-header/50 flex items-center gap-1.5 text-[9px] text-theme-darker font-mono tabular-nums">
            {lastUsage.reasoning > 0 && <span>{(lastUsage.reasoning / 1000).toFixed(1)}k reasoning</span>}
            <span>(context: {(lastUsage.prompt / 1000).toFixed(1)}k in · {(lastUsage.completion / 1000).toFixed(1)}k out)</span>
          </div>
        )}
        <div className="p-3">
          <div
            className="relative flex items-end gap-2"
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
            {mention.active && (
              <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
                <FileMentionDropdown
                  searchTerm={mention.searchTerm}
                  onSelect={handleMentionSelect}
                  onClose={handleMentionClose}
                />
              </div>
            )}
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
                if (mention.active && ['Enter', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) {
                  e.preventDefault();
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about your workspace... (@ to reference files)"
              readOnly={isLoading}
              rows={1}
              className="flex-1 bg-theme-input border border-theme-border rounded px-3 py-2 text-xs text-theme-text placeholder-theme-darker outline-none focus:border-theme-border-hover read-only:opacity-50 resize-none overflow-y-auto min-h-[32px] max-h-[200px] leading-relaxed"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="p-2 bg-theme-active hover:bg-theme-hover text-theme-white border border-theme-border rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ChatPanel() {
  const apiKey = useChatStore((s) => s.apiKey);

  useEffect(() => {
    if (apiKey) {
      useChatStore.getState().fetchModels();
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {apiKey ? <ChatView /> : <ApiKeySetup />}
    </div>
  );
}
