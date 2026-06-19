import { useEffect, useRef, useState } from 'react';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  GridSuggestionMenuController,
  getDefaultReactSlashMenuItems,
  getDefaultReactEmojiPickerItems,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { useNoteStore, getFileType } from '../store/noteStore';
import { Loader2, Check, Columns } from 'lucide-react';
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

  // Initialize BlockNote
  const editor = useCreateBlockNote();

  const fileType = getFileType(filePath);

  // Load content into editor on first mount (for Markdown files only)
  useEffect(() => {
    if (fileType !== 'markdown') return;

    let active = true;

    async function loadContent() {
      setIsLoading(true);
      try {
        const contentToLoad = activeContent || `# ${filePath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled'}\n\n`;
        
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

  const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';

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
            className={`p-1.5 rounded border border-theme-border transition-all cursor-pointer flex items-center justify-center ${
              rightSidebarOpen
                ? 'bg-theme-active text-theme-white hover:bg-theme-hover'
                : 'bg-theme-input text-theme-muted hover:text-theme-white hover:bg-theme-active'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
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
        <div className="flex-1 overflow-y-auto px-12 py-10 max-w-2xl mx-auto w-full beauty-scrollbar">
          {/* Document Title / Cover space */}
          <div className="mb-0">
            <h1 className="text-4xl font-sans font-bold tracking-tight text-theme-white mb-2 leading-tight">
              {fileName}
            </h1>
            <div className="flex items-center gap-2 text-theme-darker text-xs font-mono select-none mb-10">
              <span>Last edited: just now</span>
              <span>•</span>
              <span>Local-first Sync</span>
            </div>
          </div>
          
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
