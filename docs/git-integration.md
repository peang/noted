# Git in the sidebar

When the opened folder has a `.git` directory, the sidebar shows the current branch, how far it is
from `origin`, and buttons to commit, pull and push. Nothing runs on a server: git works inside the
browser with [isomorphic-git](https://isomorphic-git.org) directly on the folder the user opened.

## What you can do

| | |
|---|---|
| Branch picker | Switch, create (`+ Create "name"`), or check out a branch that only exists on `origin` |
| Commit | Tick the files to include, write a message; **Commit** or **Commit & Push** |
| Fetch ↻ | Updates the ahead/behind counters from `origin` |
| Pull ↓ | Fast-forward or merge; a conflict stops the pull and changes nothing |
| Push ↑ | Pushes the current branch (publishes it if `origin` doesn't have it yet) |

The status refreshes on its own when the tab regains focus, after files are created/moved/deleted,
and after every git action. Fetching, pulling and pushing only happen when you click.

## How it is wired

- `src/git/fsaFs.ts` – a Node-style `fs.promises` over a `FileSystemDirectoryHandle`.
- `src/git/gitClient.ts` – status, commit, branches, fetch/pull/push, remote URL and token handling.
- `src/store/gitStore.ts` – state and actions; follows the opened folder.
- `src/components/git/` – `GitBar` (sidebar), `BranchPicker`, `GitDialogs` (commit, token).
- `src/server/gitProxy.ts` – the relay, used by `worker.ts` (production) and `vite.config.ts` (dev).

## Remotes and sign-in

Browsers can't speak SSH, and `github.com` & co send no CORS headers, so network operations use
**https through a relay** at `/api/git-proxy/<host>/…`:

- The relay only forwards the three git endpoints (`info/refs`, `git-upload-pack`, `git-receive-pack`)
  to `github.com`, `gitlab.com`, `bitbucket.org` and `codeberg.org`. It does not log or store headers.
- A remote like `git@github.com:owner/repo.git` is converted to https automatically. An SSH **alias**
  (`git@irvan-github:owner/repo.git`) can't be converted, so Noted asks for the https address once and
  remembers it per folder.
- Pushing needs an access token (GitHub: a fine-grained token with *Contents: read & write*). Reading
  public repositories needs none. Tokens and addresses live in this browser's `localStorage`
  (`noted_git_tokens`, `noted_git_remotes`); anything running on the page could read them.
- The author of a commit comes from the repo's `user.name`/`user.email`. Noted can't read the global
  `~/.gitconfig`, so it asks once and remembers the answer (`noted_git_identity`).

## Limits

- Worktrees and submodules (`.git` is a file) are not supported; the bar says so.
- A pull that needs a real merge resolution (the same lines changed on both sides) stops with a message;
  resolve it with the git CLI. Nothing is modified when that happens.
- The executable bit can't be read from the browser, so it is never reported as a change.
- Index format v4 and SHA-256 repositories are not supported by isomorphic-git.
- Hosts other than the four above need to be added to `ALLOWED_HOSTS` in `gitProxy.ts`.

## Testing against a local server

`NOTED_GIT_PROXY_DEV_HOSTS=127.0.0.1:9419 npm run dev` lets the dev relay reach a plain-http git
server on that address (for example `git http-backend` behind a small Node server).
