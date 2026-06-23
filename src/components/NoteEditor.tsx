import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  GridSuggestionMenuController,
  getDefaultReactSlashMenuItems,
  getDefaultReactEmojiPickerItems,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs } from '@blocknote/core';
import { useNoteStore, getFileType } from '../store/noteStore';
import { Loader2, Check, Columns } from 'lucide-react';
import { createPortal } from 'react-dom';
import CodeLanguagePicker, { getLanguageLabel } from './CodeLanguagePicker';
import PlaintextEditor from './PlaintextEditor';
import DocumentViewer from './DocumentViewer';
import '@blocknote/mantine/style.css';

interface NoteEditorProps {
  filePath: string;
}

export default function NoteEditor({ filePath }: NoteEditorProps) {
  const activeContent = useNoteStore((state) => state.activeContent);
  const saveActiveFile = useNoteStore((state) => state.saveActiveFile);
  const isSaving = useNoteStore((state) => state.isSaving);
  const rightSidebarOpen = useNoteStore((state) => state.rightSidebarOpen);
  const setRightSidebarOpen = useNoteStore((state) => state.setRightSidebarOpen);
  const theme = useNoteStore((state) => state.theme);

  const [isLoading, setIsLoading] = useState(true);
  const lastSavedRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Schema with Shiki syntax highlighting for code blocks
  const schema = useMemo(() => BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock: createCodeBlockSpec({
        defaultLanguage: 'javascript',
        createHighlighter: () =>
          import('shiki').then((m: any) => {
            const hl = m.createHighlighter({
              themes: ['github-dark'],
              langs: ['javascript', 'typescript', 'json', 'bash', 'markdown', 'text'],
            });
            hl.catch((err: any) => console.error('[Shiki] highlighter creation failed:', err));
            return hl;
          }),
        supportedLanguages: {
          javascript: { name: 'JavaScript' },
          typescript: { name: 'TypeScript' },
          tsx: { name: 'TSX' },
          jsx: { name: 'JSX' },
          json: { name: 'JSON' },
          yaml: { name: 'YAML' },
          html: { name: 'HTML' },
          css: { name: 'CSS' },
          scss: { name: 'SCSS' },
          python: { name: 'Python' },
          rust: { name: 'Rust' },
          go: { name: 'Go' },
          bash: { name: 'Bash' },
          shell: { name: 'Shell' },
          sql: { name: 'SQL' },
          markdown: { name: 'Markdown' },
          text: { name: 'Plain Text' },
        },
      } as any),
    },
  }), []);

  // Init BlockNote
  const editor = useCreateBlockNote({ schema });

  // Inject searchable language pickers into code blocks
  const pickerRootsRef = useRef<Map<Element, { root: any; cleanup: () => void }>>(new Map());

  const triggerHighlightRefresh = useCallback(() => {
    try {
      (editor as any)._tiptapEditor?.view?.dispatch?.(
        (editor as any)._tiptapEditor.state.tr.setMeta("prosemirror-highlight-refresh", true)
      );
    } catch {}
  }, [editor]);

  const attachLangPicker = useCallback((container: HTMLElement, blockId: string, language: string) => {
    const select = container.querySelector<HTMLSelectElement>('.bn-block-content[data-content-type=codeBlock] > div > select');
    const codeBlock = container.querySelector<HTMLElement>('.bn-block-content[data-content-type=codeBlock]');
    if (!select || !codeBlock) return;

    // Hide the original select visually
    select.style.opacity = '0';
    select.style.pointerEvents = 'none';
    select.style.position = 'absolute';

    // Don't double-mount
    if (codeBlock.querySelector('.noted-lang-picker')) return;

    const mount = document.createElement('div');
    mount.style.cssText = 'position:absolute;top:7px;left:12px;z-index:10;';
    codeBlock.style.position = codeBlock.style.position || 'relative';
    codeBlock.appendChild(mount);

    const handleChange = (newLang: string) => {
      const block = editor.getBlock(blockId);
      if (block) {
        editor.updateBlock(blockId, { props: { language: newLang } } as any);
        select.value = newLang;
        // Force prosemirror-highlight to re-parse
        triggerHighlightRefresh();
      }
    };

    import('react-dom/client').then(({ createRoot }) => {
      const root = createRoot(mount);
      root.render(<CodeLanguagePicker value={language} onChange={handleChange} />);
      pickerRootsRef.current.set(mount, { root, cleanup: () => root.unmount() });
    });
  }, [editor]);

  useEffect(() => {
    const interval = setInterval(() => {
      const dom = editor.domElement;
      if (!dom) return;
      const codeBlocks = dom.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type=codeBlock]');
      codeBlocks.forEach((cb) => {
        const blockOuter = cb.closest('[data-id]') as HTMLElement | null;
        const blockId = blockOuter?.getAttribute('data-id');
        const select = cb.querySelector<HTMLSelectElement>('div > select');
        if (select && blockId && !cb.querySelector('.noted-lang-picker')) {
          attachLangPicker(cb, blockId, select.value);
        }
      });
    }, 500);

    return () => {
      clearInterval(interval);
      pickerRootsRef.current.forEach((v) => v.cleanup());
      pickerRootsRef.current.clear();
    };
  }, [editor, attachLangPicker]);

  const fileType = getFileType(filePath);

  // Load content into editor on mount or when filePath changes
  useEffect(() => {
    if (fileType !== 'markdown') return;

    let active = true;

    async function loadContent() {
      setIsLoading(true);
      try {
        // Ensure activeContent is loaded
        if (!activeContent) {
          await useNoteStore.getState().openFile(filePath);
        }

        const state = useNoteStore.getState();
        const contentToLoad = state.activeContent || `# ${filePath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled'}\n\n`;
        
        lastSavedRef.current = contentToLoad;
        const blocks = await editor.tryParseMarkdownToBlocks(contentToLoad);
        
        if (active) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch (err) {
        console.error("Failed to parse markdown to blocks", err);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    loadContent();

    return () => {
      active = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [editor, filePath, fileType]);

  // Handle changes with 500ms debounce to save to Zustand store
  const handleEditorChange = async () => {
    if (isLoading) return;
    try {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      
      if (markdown !== lastSavedRef.current) {
        lastSavedRef.current = markdown;

        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
          await saveActiveFile(markdown);
        }, 500);
      }
    } catch (err) {
      console.error("Error converting blocks to markdown", err);
    }
  };

  // Route non-markdown file types to specialized editors
  if (fileType === 'text') {
    return <PlaintextEditor filePath={filePath} />;
  }

  if (fileType === 'pdf' || fileType === 'doc' || fileType === 'binary') {
    return <DocumentViewer filePath={filePath} />;
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
        </div>
        <div className="flex items-center gap-3">
          {isSaving ? (
            <div className="flex items-center gap-1.5 text-theme-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-theme-text" />
              <span className="font-mono text-[11px]">Saving to disk...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-emerald-500 bg-theme-input px-2.5 py-0.5 rounded border border-theme-border">
              <Check className="w-3.5 h-3.5" />
              <span className="font-mono text-[11px] font-medium">Auto-saved</span>
            </div>
          )}

          <button
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            title={rightSidebarOpen ? "Hide Open Documents list" : "Show Open Documents list"}
            className={`px-2.5 py-1 rounded border transition-all cursor-pointer text-xs font-mono font-semibold ${
              rightSidebarOpen
                ? 'bg-theme-active text-theme-white hover:bg-theme-hover border-theme-border'
                : 'bg-theme-input text-amber-400 hover:bg-theme-hover border-amber-500/30'
            }`}
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
