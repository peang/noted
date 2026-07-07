import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  GridSuggestionMenuController,
  getDefaultReactSlashMenuItems,
  getDefaultReactEmojiPickerItems,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { useNoteStore, getFileType } from '../store/noteStore';
import { Loader2, Check } from 'lucide-react';
import CodeLanguagePicker from './CodeLanguagePicker';
import PlaintextEditor from './PlaintextEditor';
import DocumentViewer from './DocumentViewer';
import '@blocknote/mantine/style.css';

const SAVE_INTERVAL = 3000;
const blocksCache = new Map<string, any[]>();

interface NoteEditorProps {
  filePath: string;
}

export default function NoteEditor({ filePath }: NoteEditorProps) {
  const activeContent = useNoteStore((state) => state.activeContent);
  const activeFileObject = useNoteStore((state) => state.activeFileObject);
  const saveActiveFile = useNoteStore((state) => state.saveActiveFile);
  const rightSidebarOpen = useNoteStore((state) => state.rightSidebarOpen);
  const setRightSidebarOpen = useNoteStore((state) => state.setRightSidebarOpen);
  const theme = useNoteStore((state) => state.theme);

  const [isLoading, setIsLoading] = useState(true);
  const lastSavedRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const mountedRef = useRef(false);

  const schema = useMemo(() => BlockNoteSchema.create({
    blockSpecs: defaultBlockSpecs as any,
  }), []);

  const editor = useCreateBlockNote({ schema });

  const attachLangPicker = useCallback((container: HTMLElement, blockId: string, language: string) => {
    const select = container.querySelector<HTMLSelectElement>('.bn-block-content[data-content-type=codeBlock] > div > select');
    const codeBlock = container.querySelector<HTMLElement>('.bn-block-content[data-content-type=codeBlock]');
    if (!select || !codeBlock) return;

    select.style.opacity = '0';
    select.style.pointerEvents = 'none';
    select.style.position = 'absolute';

    if (codeBlock.querySelector('.noted-lang-picker')) return;

    const mount = document.createElement('div');
    mount.className = 'noted-lang-picker';
    mount.style.cssText = 'position:absolute;top:7px;left:12px;z-index:10;';
    codeBlock.style.position = codeBlock.style.position || 'relative';
    codeBlock.appendChild(mount);

    const handleChange = (newLang: string) => {
      const block = editor.getBlock(blockId);
      if (block) {
        editor.updateBlock(blockId, { props: { language: newLang } } as any);
        select.value = newLang;
      }
    };

    import('react-dom/client').then(({ createRoot }) => {
      const root = createRoot(mount);
      root.render(<CodeLanguagePicker value={language} onChange={handleChange} />);
    });
  }, [editor]);

  // MutationObserver for code language pickers — no polling
  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;

    const attachToCodeBlock = (cb: HTMLElement) => {
      const blockOuter = cb.closest('[data-id]') as HTMLElement | null;
      const blockId = blockOuter?.getAttribute('data-id');
      const select = cb.querySelector<HTMLSelectElement>('div > select');
      if (select && blockId && !cb.querySelector('.noted-lang-picker')) {
        attachLangPicker(cb, blockId, select.value);
      }
    };

    dom.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type=codeBlock]')
      .forEach(attachToCodeBlock);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.matches?.('.bn-block-content[data-content-type=codeBlock]')) {
              attachToCodeBlock(node);
            } else if (node.querySelector?.('.bn-block-content[data-content-type=codeBlock]')) {
              node.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type=codeBlock]')
                .forEach(attachToCodeBlock);
            }
          }
        }
      }
    });

    observer.observe(dom, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [editor, attachLangPicker]);

  const fileType = getFileType(filePath);

  const initialLoadRef = useRef(true);

  // Load content into editor on mount or when filePath changes
  useEffect(() => {
    if (fileType !== 'markdown') return;

    let active = true;

    async function loadContent() {
      if (initialLoadRef.current) {
        setIsLoading(true);
      }

      try {
        if (!activeContent) {
          await useNoteStore.getState().openFile(filePath);
        }

        const state = useNoteStore.getState();
        const contentToLoad = state.activeContent || `# ${filePath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled'}\n\n`;
        
        lastSavedRef.current = contentToLoad;
        let blocks = blocksCache.get(contentToLoad);
        if (!blocks) {
          blocks = await editor.tryParseMarkdownToBlocks(contentToLoad);
          blocksCache.set(contentToLoad, blocks);
        }
        
        if (active) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch (err) {
        console.error("Failed to parse markdown to blocks", err);
      } finally {
        if (active) {
          setIsLoading(false);
          mountedRef.current = true;
          initialLoadRef.current = false;
        }
      }
    }

    loadContent();

    return () => {
      active = false;
    };
  }, [editor, filePath, fileType]);

  // Lightweight onChange — just mark dirty
  const handleEditorChange = useCallback(() => {
    if (isLoading) return;
    dirtyRef.current = true;
  }, [isLoading]);

  // Perform actual save: convert blocks → markdown → persist
  const performSave = useCallback(async () => {
    if (isLoading || pendingSaveRef.current || !dirtyRef.current) return;

    pendingSaveRef.current = true;
    dirtyRef.current = false;

    try {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);

      // User typed during conversion — skip, next cycle catches up
      if (dirtyRef.current) {
        pendingSaveRef.current = false;
        return;
      }

      if (markdown === lastSavedRef.current) {
        pendingSaveRef.current = false;
        return;
      }

      lastSavedRef.current = markdown;
      await saveActiveFile(markdown);
    } catch (err) {
      console.error("Error saving:", err);
      dirtyRef.current = true;
    } finally {
      pendingSaveRef.current = false;
    }
  }, [editor, isLoading, saveActiveFile]);

  // 3s save interval
  useEffect(() => {
    if (fileType !== 'markdown') return;

    const id = setInterval(performSave, SAVE_INTERVAL);
    return () => clearInterval(id);
  }, [fileType, performSave]);

  // Save dirty content on unmount (tab switch)
  const flushRef = useRef(performSave);
  flushRef.current = performSave;

  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        flushRef.current();
      }
    };
  }, []);

  useEffect(() => {
    return () => { blocksCache.clear(); };
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Reload editor only for external content changes (AI write_file)
  useEffect(() => {
    if (fileType !== 'markdown') return;
    if (!mountedRef.current) return;
    if (!activeContent || !lastSavedRef.current) return;
    if (activeContent === lastSavedRef.current) return;

    lastSavedRef.current = activeContent;

    const cursorPos = (() => {
      try {
        const pm = (editor as any)._tiptapEditor;
        if (!pm) return null;
        const { from } = pm.state.selection;
        let pos = 0;
        for (let i = 0; i < pm.state.doc.childCount; i++) {
          const child = pm.state.doc.child(i);
          const size = child.nodeSize;
          if (pos + size > from) {
            return { blockIndex: i, offset: Math.max(0, from - pos - 1) };
          }
          pos += size;
        }
      } catch {}
      return null;
    })();

    (async () => {
      try {
        const content = activeContent;
        let blocks = blocksCache.get(content);
        if (!blocks) {
          blocks = await editor.tryParseMarkdownToBlocks(content);
          blocksCache.set(content, blocks);
        }
        editor.replaceBlocks(editor.document, blocks);

        if (cursorPos) {
          requestAnimationFrame(() => {
            try {
              const pm = (editor as any)._tiptapEditor;
              if (!pm) return;
              const { state, view } = pm;
              let targetPos = 0;
              for (let i = 0; i < state.doc.childCount && i <= cursorPos.blockIndex; i++) {
                const child = state.doc.child(i);
                if (i < cursorPos.blockIndex) {
                  targetPos += child.nodeSize;
                } else {
                  const txtLen = child.textContent?.length || 0;
                  const off = Math.min(cursorPos.offset, txtLen);
                  const tr = state.tr.setSelection(
                    new (state.selection.constructor as any)(targetPos + 1 + off, targetPos + 1 + off)
                  );
                  view.dispatch(tr);
                  view.focus();
                }
              }
            } catch {}
          });
        }
      } catch (err) {
        console.error("Failed to reload content:", err);
      }
    })();
  }, [activeContent, fileType, editor]);

  // Route non-markdown file types to specialized editors
  if (fileType === 'text') {
    return <PlaintextEditor filePath={filePath} />;
  }

  if (fileType === 'pdf' || fileType === 'doc') {
    return <DocumentViewer filePath={filePath} />;
  }

  if (fileType === 'binary') {
    const fileObj = activeFileObject;
    const metaMatch = activeContent?.match(/^binary-file-metadata:(.+):(\d+):(.+):(\d+)$/);
    const ext = filePath.split('.').pop()?.toUpperCase() || '';

    return (
      <div className="flex-1 flex flex-col bg-theme-bg h-full text-theme-text font-sans">
        <div className="h-12 border-b border-theme-border px-6 flex items-center justify-between text-xs text-theme-muted select-none bg-theme-sidebar-header">
          <div className="flex items-center gap-2">
            <span className="font-mono bg-theme-active text-theme-darker px-2 py-0.5 rounded border border-theme-border text-[10px] tracking-wide uppercase">
              {ext}
            </span>
            <span className="text-theme-darker font-mono select-none">/</span>
            <span className="truncate font-medium text-theme-muted max-w-xs">{filePath}</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <div className="w-16 h-16 rounded-xl bg-theme-active border border-theme-border flex items-center justify-center text-2xl font-bold text-theme-darker">
            {ext.slice(0, 2)}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-theme-white">Unsupported file format</h2>
            <p className="text-xs text-theme-muted mt-1 max-w-sm">
              Noted doesn't have a built-in viewer for <strong className="text-theme-text">.{ext.toLowerCase()}</strong> files.
            </p>
          </div>
          <div className="text-[11px] text-theme-darker font-mono space-y-1">
            {metaMatch && (
              <>
                <div>Size: {(parseInt(metaMatch[2]) / 1024).toFixed(1)} KB</div>
                <div>Type: {metaMatch[3] || 'Unknown'}</div>
              </>
            )}
          </div>
          {fileObj && (
            <a
              href={URL.createObjectURL(fileObj)}
              download={fileObj.name}
              className="mt-2 px-4 py-2 text-xs font-semibold rounded bg-theme-white text-theme-bg hover:opacity-90 transition-opacity cursor-pointer"
              onClick={(e) => {
                const link = e.currentTarget;
                link.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(link.href), 1000), { once: true });
              }}
            >
              Download file
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-theme-bg h-full overflow-hidden text-theme-text font-sans relative">
      {/* Editor Header Bar */}
      <div className="h-12 border-b border-theme-border px-6 flex items-center justify-between text-xs text-theme-muted select-none bg-theme-sidebar-header">
        <div className="flex items-center gap-2">
          <span className="font-mono bg-theme-active text-theme-muted px-2 py-0.5 rounded border border-theme-border text-[10px] tracking-wide uppercase">
            Markdown Mode
          </span>
          <span className="text-theme-darker font-mono select-none">/</span>
          <span className="truncate font-medium text-theme-muted max-w-xs">{filePath}</span>
          <SaveStatus />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            title={rightSidebarOpen ? "Hide Open Documents list" : "Show Open Documents list"}
            className="px-2.5 py-0.5 rounded transition-all cursor-pointer text-xs font-mono font-semibold bg-theme-white text-theme-bg hover:opacity-90"
          >
            Open Chat
          </button>
        </div>
      </div>

      {/* Editor Main Canvas */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-theme-bg text-theme-muted gap-2">
          <Loader2 className="w-8 h-8 animate-spin text-theme-darker" />
          <p className="font-mono text-xs text-theme-darker">Parsing blocks...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-12 py-10 mx-auto w-full beauty-scrollbar">
          <div className="blocknote-theme rounded-lg py-2">
            <BlockNoteView
              editor={editor}
              onChange={handleEditorChange}
              theme={theme}
              slashMenu={false}
              emojiPicker={false}
            >
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query) => {
                  const items = getDefaultReactSlashMenuItems(editor);
                  // Put emoji picker at the very first position
                  const emojiIdx = items.findIndex((item) => (item as any).key === 'emoji');
                  let sortedItems = [...items];
                  if (emojiIdx !== -1) {
                    const [emojiItem] = sortedItems.splice(emojiIdx, 1);
                    sortedItems = [emojiItem, ...sortedItems];
                  }
                  
                  // Filter items by match with query
                  return sortedItems.filter(
                    ({ title, aliases }) =>
                      title.toLowerCase().includes(query.toLowerCase()) ||
                      (aliases &&
                        aliases.filter((alias) =>
                          alias.toLowerCase().includes(query.toLowerCase()),
                        ).length !== 0),
                  );
                }}
              />
              <GridSuggestionMenuController
                triggerCharacter=":"
                getItems={async (query) => getDefaultReactEmojiPickerItems(editor, query)}
                columns={10}
                minQueryLength={0}
              />
            </BlockNoteView>
          </div>
        </div>
      )}

      {/* Quick slash command hint at footer */}
      <div className="h-6 bg-theme-sidebar-header border-t border-theme-border px-6 flex items-center justify-between text-[10px] font-mono text-theme-darker select-none">
        <div>Press <kbd className="bg-theme-active border border-theme-border text-theme-muted px-1 py-0.5 rounded text-[9px] font-sans">Shift + Enter</kbd> for carriage return</div>
        <div>Type <kbd className="bg-theme-active border border-theme-border text-theme-muted px-1 py-0.5 rounded text-[9px] font-sans">/</kbd> on clean line for block list</div>
      </div>
    </div>
  );
}

const SaveStatus = () => {
  const isSaving = useNoteStore((s) => s.isSaving);
  return isSaving ? (
    <div className="flex items-center gap-1.5 text-theme-muted ml-1">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-theme-text" />
      <span className="font-mono text-[11px]">Saving...</span>
    </div>
  ) : (
    <div className="flex items-center gap-1.5 text-emerald-500 bg-theme-input px-2.5 py-0.5 rounded border border-theme-border ml-1">
      <Check className="w-3.5 h-3.5" />
      <span className="font-mono text-[11px] font-medium">Saved</span>
    </div>
  );
};
