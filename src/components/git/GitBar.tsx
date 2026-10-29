import { useEffect, useRef, useState } from 'react';
import { GitBranch, GitCommitHorizontal, ChevronDown, ArrowDown, ArrowUp, RefreshCw, Loader2 } from 'lucide-react';
import { useGitStore } from '../../store/gitStore';
import { Button, IconButton } from '../ui/Button';
import BranchPicker from './BranchPicker';

// Branch, sync state and the commit / pull / push buttons; only shown for a folder that is a git repo
export default function GitBar() {
  const availability = useGitStore((s) => s.availability);
  const unsupportedReason = useGitStore((s) => s.unsupportedReason);
  const branch = useGitStore((s) => s.branch);
  const detachedAt = useGitStore((s) => s.detachedAt);
  const changes = useGitStore((s) => s.changes);
  const upstream = useGitStore((s) => s.upstream);
  const busy = useGitStore((s) => s.busy);
  const refreshing = useGitStore((s) => s.refreshing);
  const fetchRemote = useGitStore((s) => s.fetch);
  const pull = useGitStore((s) => s.pull);
  const push = useGitStore((s) => s.push);
  const setCommitOpen = useGitStore((s) => s.setCommitOpen);

  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  if (availability === 'none') return null;
  if (availability === 'unsupported') {
    return (
      <div className="px-3 py-2 border-b border-theme-border text-[11px] leading-snug text-theme-darker flex items-start gap-1.5">
        <GitBranch className="w-3.5 h-3.5 mt-px shrink-0" />
        <span>{unsupportedReason}</span>
      </div>
    );
  }

  const label = branch ?? `detached at ${detachedAt ?? 'HEAD'}`;
  const behind = upstream?.behind ?? 0;
  const ahead = upstream?.ahead ?? 0;
  const cap = upstream?.capped ? '+' : '';
  const working = busy !== null;

  return (
    <div ref={rootRef} className="relative px-3 py-2 border-b border-theme-border bg-theme-sidebar-header space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          disabled={working}
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
          title="Switch branch"
          className="flex-1 min-w-0 h-7 px-2 rounded-md flex items-center gap-1.5 text-xs font-mono text-theme-text bg-theme-active border border-theme-border hover:bg-theme-hover hover:border-theme-border-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'checkout' ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <GitBranch className="w-3.5 h-3.5 shrink-0 text-theme-muted" />}
          <span className="truncate">{label}</span>
          <ChevronDown className={`w-3 h-3 shrink-0 ml-auto text-theme-darker transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
        </button>
        <IconButton label="Fetch from origin" onClick={() => void fetchRemote()} disabled={working}>
          <RefreshCw className={`w-3.5 h-3.5 ${busy === 'fetch' || refreshing ? 'animate-spin' : ''}`} />
        </IconButton>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          className="flex-1 min-w-0"
          onClick={() => setCommitOpen(true)}
          disabled={working || changes.length === 0}
          title={changes.length ? `Commit ${changes.length} changed file${changes.length !== 1 ? 's' : ''}` : 'No changes to commit'}
        >
          {busy === 'commit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommitHorizontal className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate">Commit</span>
          {changes.length > 0 && (
            <span className="rounded bg-theme-hover px-1 text-[10px] font-mono tabular-nums text-theme-muted">{changes.length}</span>
          )}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void pull()}
          disabled={working || !branch}
          title={upstream ? (behind ? `Pull ${behind}${cap} new commit${behind !== 1 ? 's' : ''}` : 'Pull (already up to date as of the last fetch)') : 'Pull from origin'}
        >
          {busy === 'pull' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDown className="w-3.5 h-3.5" />}
          {behind > 0 && <span className="text-[10px] font-mono tabular-nums">{behind}{cap}</span>}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void push()}
          disabled={working || !branch}
          title={upstream ? (ahead ? `Push ${ahead}${cap} commit${ahead !== 1 ? 's' : ''}` : 'Nothing to push') : 'Publish this branch to origin'}
        >
          {busy === 'push' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
          {ahead > 0 && <span className="text-[10px] font-mono tabular-nums">{ahead}{cap}</span>}
          {!upstream && branch && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
        </Button>
      </div>

      {pickerOpen && <BranchPicker onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
