import React, { useState, useRef, useEffect } from 'react';
import { useChatStore, Message } from '../store/chatStore';
import { useNoteStore, FileNode } from '../store/noteStore';
import { toast } from 'sonner';
import { Send, Key, ExternalLink, Trash2, Sparkles, Loader2, FileText, Folder } from 'lucide-react';

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-lg text-xs leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-theme-active text-theme-white rounded-br-sm'
            : 'bg-theme-card border border-theme-border text-theme-text rounded-bl-sm'
        }`}
      >
        {msg.content}
      </div>
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
  const folderName = useNoteStore((s) => s.folderName);
  const activeTab = useNoteStore((s) => s.activeTab);
  const fileTree = useNoteStore((s) => s.fileTree);

  const sendMessage = useChatStore((s) => s.sendMessage);
  const setModel = useChatStore((s) => s.setModel);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const lastUsage = useChatStore((s) => s.lastUsage);
  const clearChat = useChatStore((s) => s.clearChat);
  const clearApiKey = useChatStore((s) => s.clearApiKey);

  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const countFiles = (nodes: FileNode[]): number =>
    nodes.reduce((acc, n) => acc + (n.kind === 'file' ? 1 : 0) + (n.children ? countFiles(n.children) : 0), 0);

  const fileCount = countFiles(fileTree);
  const contextLabel = mode === 'plan'
    ? `Recalling all ${fileCount} file${fileCount !== 1 ? 's' : ''} in "${folderName}"`
    : activeTab
      ? `Active: ${activeTab} · ${fileCount} file${fileCount !== 1 ? 's' : ''} in workspace`
      : `${fileCount} file${fileCount !== 1 ? 's' : ''} in workspace ${fileCount > 0 ? '- open a file for deeper context' : ''}`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && document.activeElement === textareaRef.current) {
        e.preventDefault();
        const newMode = mode === 'plan' ? 'build' : 'plan';
        setMode(newMode);
        toast[newMode === 'plan' ? 'warning' : 'success'](newMode === 'plan' ? 'Plan Mode' : 'Build Mode', { duration: 3000 });
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mode, setMode]);

  const handleSend = () => {
    const content = input.trim();
    if (!content || isLoading) return;
    setInput('');
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
          onClick={clearChat}
          title="Start a new chat session"
          className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border border-theme-border text-theme-muted hover:text-theme-white hover:bg-theme-hover cursor-pointer transition-all shrink-0"
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

      {/* Mode status bar */}
      <div className={`px-3 py-1 text-[10px] font-mono flex items-center gap-1.5 border-b border-theme-border ${
        mode === 'plan' ? 'text-amber-400 bg-amber-400/5' : 'text-emerald-400 bg-emerald-400/5'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${mode === 'plan' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        {mode === 'plan' ? 'Plan mode — analysis only' : 'Build mode — can read files'}
        <span className="ml-auto text-theme-darker text-[9px]">Tab to switch</span>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 thin-scrollbar space-y-3">
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
      </div>

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
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about your workspace..."
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
