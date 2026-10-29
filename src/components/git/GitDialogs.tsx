import { useEffect, useMemo, useState } from 'react';
import { GitCommitHorizontal, KeyRound, X, Loader2, ExternalLink } from 'lucide-react';
import { useGitStore } from '../../store/gitStore';
import { Button, IconButton } from '../ui/Button';
import type { GitChange, GitIdentity } from '../../git/gitClient';

const STATUS_STYLE: Record<GitChange['status'], { letter: string; className: string; label: string }> = {
  modified: { letter: 'M', className: 'text-amber-500', label: 'Modified' },
  added: { letter: 'A', className: 'text-emerald-500', label: 'New file' },
  deleted: { letter: 'D', className: 'text-red-500', label: 'Deleted' },
};

function Modal({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="w-full max-w-lg max-h-[90vh] flex flex-col bg-theme-card border border-theme-border rounded-xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 h-12 border-b border-theme-border shrink-0">
          {icon}
          <h2 className="flex-1 text-sm font-semibold text-theme-white truncate">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputClass =
  'w-full h-8 bg-theme-input border border-theme-border rounded-lg px-2.5 text-xs text-theme-text placeholder-theme-darker outline-none focus:border-theme-border-hover transition-colors';

function CommitDialog() {
  const branch = useGitStore((s) => s.branch);
  const changes = useGitStore((s) => s.changes);
  const busy = useGitStore((s) => s.busy);
  const upstream = useGitStore((s) => s.upstream);
  const commit = useGitStore((s) => s.commit);
  const loadIdentity = useGitStore((s) => s.loadIdentity);
  const setCommitOpen = useGitStore((s) => s.setCommitOpen);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(changes.map((c) => c.path)));
  const [message, setMessage] = useState('');
  const [identity, setIdentity] = useState<GitIdentity | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    void loadIdentity().then((found) => {
      setIdentity(found);
      if (found) {
        setName(found.name);
        setEmail(found.email);
      }
    });
  }, [loadIdentity]);

  const chosen = useMemo(() => changes.filter((c) => picked.has(c.path)), [changes, picked]);
  const identityOk = name.trim() !== '' && /\S+@\S+/.test(email);
  const canCommit = chosen.length > 0 && message.trim() !== '' && identityOk && busy === null;

  const submit = (thenPush: boolean) => {
    if (!canCommit) return;
    void commit(message.trim(), chosen, { name: name.trim(), email: email.trim() }, thenPush);
  };

  const toggle = (path: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const close = () => setCommitOpen(false);

  return (
    <Modal title={`Commit to ${branch ?? 'HEAD'}`} icon={<GitCommitHorizontal className="w-4 h-4 text-theme-muted" />} onClose={close}>
      <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-theme-darker">
              Changes ({chosen.length}/{changes.length})
            </span>
            <button
              type="button"
              className="text-[11px] text-theme-muted hover:text-theme-white cursor-pointer"
              onClick={() => setPicked(chosen.length === changes.length ? new Set() : new Set(changes.map((c) => c.path)))}
            >
              {chosen.length === changes.length ? 'Select none' : 'Select all'}
            </button>
          </div>
          <ul className="max-h-48 overflow-y-auto thin-scrollbar rounded-lg border border-theme-border divide-y divide-theme-border">
            {changes.map((c) => {
              const style = STATUS_STYLE[c.status];
              return (
                <li key={c.path}>
                  <label className="flex items-center gap-2.5 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-theme-hover">
                    <input type="checkbox" checked={picked.has(c.path)} onChange={() => toggle(c.path)} className="accent-current" />
                    <span className={`w-4 text-center font-mono text-[11px] font-semibold ${style.className}`} title={style.label}>
                      {style.letter}
                    </span>
                    <span className="flex-1 truncate font-mono text-theme-text" title={c.path}>{c.path}</span>
                    {c.staged && <span className="text-[10px] text-theme-darker">staged</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-theme-darker" htmlFor="git-message">
            Message
          </label>
          <textarea
            id="git-message"
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit(false);
              }
            }}
            placeholder="Describe what changed"
            rows={3}
            className="w-full bg-theme-input border border-theme-border rounded-lg px-2.5 py-2 text-xs leading-relaxed text-theme-text placeholder-theme-darker outline-none focus:border-theme-border-hover resize-none transition-colors"
          />
        </div>

        {identity !== undefined && (identity === null || !identityOk) && (
          <div>
            <p className="mb-1.5 text-[11px] text-theme-muted">
              This repository has no author set. Noted can't read your global git config, so enter it once (it stays in this browser).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputClass} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <input className={inputClass} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-theme-border shrink-0">
        <span className="mr-auto text-[10px] text-theme-darker hidden sm:block">Ctrl/⌘+Enter to commit</span>
        <Button variant="secondary" size="md" onClick={close}>Cancel</Button>
        <Button variant="secondary" size="md" disabled={!canCommit} onClick={() => submit(false)}>
          {busy === 'commit' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Commit
        </Button>
        <Button variant="primary" size="md" disabled={!canCommit} onClick={() => submit(true)} title={upstream ? 'Commit, then push to origin' : 'Commit, then publish the branch to origin'}>
          Commit & Push
        </Button>
      </div>
    </Modal>
  );
}

function AuthDialog() {
  const prompt = useGitStore((s) => s.authPrompt)!;
  const save = useGitStore((s) => s.saveRemoteSettings);
  const dismiss = useGitStore((s) => s.dismissAuthPrompt);
  const [httpsUrl, setHttpsUrl] = useState(prompt.httpsUrl);
  const [token, setToken] = useState('');

  const needsToken = !prompt.needsUrl || token !== '';
  const ready = (!prompt.needsUrl || /^https?:\/\/\S+/.test(httpsUrl.trim())) && (prompt.retry !== 'push' || token.trim() !== '' || !needsToken);
  const tokenHelp: Record<string, { text: string; href: string }> = {
    'github.com': { text: 'Create a fine-grained token (Contents: read & write)', href: 'https://github.com/settings/personal-access-tokens/new' },
    'gitlab.com': { text: 'Create a personal access token (write_repository)', href: 'https://gitlab.com/-/user_settings/personal_access_tokens' },
  };
  const help = tokenHelp[prompt.host];

  return (
    <Modal title={prompt.host ? `Connect to ${prompt.host}` : 'Connect to the remote'} icon={<KeyRound className="w-4 h-4 text-theme-muted" />} onClose={dismiss}>
      <form
        className="p-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void save({ httpsUrl, token });
        }}
      >
        <p className="text-xs leading-relaxed text-theme-muted">{prompt.message}</p>

        {prompt.needsUrl && (
          <div>
            <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-theme-darker" htmlFor="git-https">
              Repository address (https://…)
            </label>
            <input id="git-https" autoFocus className={inputClass} placeholder="https://github.com/owner/repo.git" value={httpsUrl} onChange={(e) => setHttpsUrl(e.target.value)} />
          </div>
        )}

        <div>
          <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-theme-darker" htmlFor="git-token">
            Access token
          </label>
          <input id="git-token" type="password" autoFocus={!prompt.needsUrl} className={inputClass} placeholder="Paste a token" value={token} onChange={(e) => setToken(e.target.value)} />
          {help && (
            <a href={help.href} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-theme-muted hover:text-theme-white">
              {help.text} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-theme-darker">
          The token is kept in this browser only. Requests go through this site's git relay, which forwards them to {prompt.host || 'the git host'} and stores nothing.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={dismiss}>Cancel</Button>
          <Button type="submit" variant="primary" size="md" disabled={!ready}>Save & continue</Button>
        </div>
      </form>
    </Modal>
  );
}

// Rendered once near the app root so both pick up the active theme
export default function GitDialogs() {
  const commitOpen = useGitStore((s) => s.commitOpen);
  const changeCount = useGitStore((s) => s.changes.length);
  const authPrompt = useGitStore((s) => s.authPrompt);
  return (
    <>
      {commitOpen && changeCount > 0 && <CommitDialog />}
      {authPrompt && <AuthDialog />}
    </>
  );
}
