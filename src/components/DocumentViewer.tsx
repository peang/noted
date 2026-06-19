import { useState, useEffect, useRef } from 'react';
import { useNoteStore } from '../store/noteStore';
import { 
  FileText, Download, Upload, ZoomIn, ZoomOut, Search, 
  Printer, ChevronLeft, ChevronRight, Eye, RefreshCw, Info, Check, ShieldAlert
} from 'lucide-react';

interface DocumentViewerProps {
  filePath: string;
}

export default function DocumentViewer({ filePath }: DocumentViewerProps) {
  const activeFileObject = useNoteStore((state) => state.activeFileObject);
  const isSimulated = useNoteStore((state) => state.isSimulated);
  const activeContent = useNoteStore((state) => state.activeContent);
  const updateSimulatedFileContent = useNoteStore((state) => state.updateSimulatedFileContent);

  const [localFile, setLocalFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New features for robust sandbox execution
  const [viewMode, setViewMode] = useState<'interactive' | 'raw'>('interactive');
  const [extractedMetadata, setExtractedMetadata] = useState<{
    title?: string;
    author?: string;
    creator?: string;
    producer?: string;
    pages?: string;
  } | null>(null);
  const [extractedParagraphs, setExtractedParagraphs] = useState<string[]>([]);

  const extension = filePath.toLowerCase().split('.').pop() || '';
  const isPdf = extension === 'pdf';
  const isWord = extension === 'doc' || extension === 'docx';
  const fileName = filePath.split('/').pop() || 'Document';

  // Revoke previous object URL on teardown or file change
  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  // Load physical file if it exists in local-first handle
  useEffect(() => {
    if (activeFileObject) {
      setLocalFile(activeFileObject);
      const url = URL.createObjectURL(activeFileObject);
      setObjectUrl(url);
    } else if (isSimulated && activeContent && activeContent.startsWith('data:')) {
      // Content is a base64 encoded file upload in simulated mode
      try {
        const fetchBase64 = async () => {
          const res = await fetch(activeContent);
          const blob = await res.blob();
          const file = new File([blob], fileName, { type: blob.type });
          setLocalFile(file);
          setObjectUrl(URL.createObjectURL(blob));
        };
        fetchBase64();
      } catch (err) {
        console.error("Failed to decode base64 simulated document:", err);
      }
    } else {
      setLocalFile(null);
      setObjectUrl(null);
    }
    // Switch to interactive view on file change since raw iframe is prone to sandbox blocks
    setViewMode('interactive');
    setCurrentPage(1);
  }, [activeFileObject, activeContent, filePath, isSimulated]);

  // Decode standard PDF string escapes
  const decodePdfString = (str: string): string => {
    return str
      .replace(/\\([\d]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\(.)/g, '$1');
  };

  // Extract PDF Text and Metadata Client-Side using pure JS to bypass sandbox problems!
  useEffect(() => {
    if (!localFile) {
      setExtractedMetadata(null);
      setExtractedParagraphs([]);
      return;
    }

    if (!isPdf) {
      // Only do deep parsing for PDF
      return;
    }

    const parsePdf = async () => {
      try {
        const textContent = await localFile.text();
        
        // 1) Metadata Extraction
        const meta: typeof extractedMetadata = {
          title: '',
          author: '',
          creator: '',
          producer: '',
          pages: '1'
        };

        const titleMatch = textContent.match(/\/Title\s*\(([^)]+)\)/);
        if (titleMatch) meta.title = decodePdfString(titleMatch[1]);

        const authorMatch = textContent.match(/\/Author\s*\(([^)]+)\)/);
        if (authorMatch) meta.author = decodePdfString(authorMatch[1]);

        const creatorMatch = textContent.match(/\/Creator\s*\(([^)]+)\)/);
        if (creatorMatch) meta.creator = decodePdfString(creatorMatch[1]);

        const producerMatch = textContent.match(/\/Producer\s*\(([^)]+)\)/);
        if (producerMatch) meta.producer = decodePdfString(producerMatch[1]);

        const countMatch = textContent.match(/\/Count\s+(\d+)/);
        if (countMatch) {
          meta.pages = countMatch[1];
        } else {
          const pagesCount = (textContent.match(/\/Type\s*\/Page\b/g) || []).length;
          if (pagesCount > 0) {
            meta.pages = String(pagesCount);
          }
        }
        setExtractedMetadata(meta);

        // 2) Text Paragraph Extraction (BT ... ET streams / plain strings)
        const btEtRegex = /BT[\s\S]*?ET/g;
        let matches;
        const paragraphs: string[] = [];
        
        while ((matches = btEtRegex.exec(textContent)) !== null) {
          const block = matches[0];
          const textSegments: string[] = [];
          const parenRegex = /\(([^)]+)\)/g;
          let textMatch;
          while ((textMatch = parenRegex.exec(block)) !== null) {
            const cleanVal = decodePdfString(textMatch[1]);
            // Filter out non-printable ASCII or strange control characters
            const printable = cleanVal.replace(/[^\x20-\x7E\xA0-\xFF\s\u00A0-\u017F]/g, '');
            if (printable.trim().length > 1) {
              textSegments.push(printable.trim());
            }
          }
          if (textSegments.length > 0) {
            paragraphs.push(textSegments.join(' '));
          }
        }

        // Fallback search if no streams matched (which is typical for simple flat text structures)
        if (paragraphs.length === 0) {
          const fallbackRegex = /\(([\w\s.,;:()!'"+=\-*&%$#@?]{12,100})\)/g;
          let fallbackMatch;
          while ((fallbackMatch = fallbackRegex.exec(textContent)) !== null) {
            paragraphs.push(decodePdfString(fallbackMatch[1]));
            if (paragraphs.length >= 200) break;
          }
        }

        const cleanedParagraphs = paragraphs
          .map(p => p.trim())
          .filter(p => p.length > 4 && !p.startsWith('/') && !p.includes('/') && !p.startsWith('%%'));

        setExtractedParagraphs(cleanedParagraphs);
      } catch (err) {
        console.error("Failed to parse local pdf file:", err);
      }
    };

    parsePdf();
  }, [localFile, isPdf]);

  // Handle direct file uploads (for simulated mode sandbox or custom views)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadDroppedFile(file);
  };

  const loadDroppedFile = (file: File) => {
    setLocalFile(file);
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);

    // If simulated, convert to data URI so it persists in simulatedFiles store
    if (isSimulated) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          updateSimulatedFileContent(filePath, reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDownload = () => {
    if (objectUrl && localFile) {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = localFile.name;
      link.click();
    } else {
      // Download the simulated mock text
      const content = isPdf ? getMockPdfContent() : getMockWordContent();
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName.endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  // Drag and drop mechanics
  const [dragActive, setDragActive] = useState(false);
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadDroppedFile(e.dataTransfer.files[0]);
    }
  };

  // Simulated content lists
  function getMockPdfContent() {
    return `--- PDF DOCUMENT STRUCTURE ---\nFile: ${fileName}\nFormat: PDF/A\nPages: 3\n\nNoted Corporate System Specs & Standard Agreement.\nLicensed for: Sandbox Guest.\n\n[PAGE 1]\nSecurity: Local Sandboxed Storage. No external servers are called.\nFeatures: Auto-saving triggers, customizable sidebar configurations.\n\n[PAGE 2]\nPDF Documents render read-only inside Noted. Perfect for quick reviews, references, or checklists.\n\n[PAGE 3]\nThis notes workspace remains 100% private. All assets are securely kept in local storage and client-side database schemas.`;
  }

  function getMockWordContent() {
    return `--- WORD DOCUMENT FORMAT ---\nFile: ${fileName}\nFormat: Microsoft Word Open XML (.docx)\nPages: 2\n\nExecutive Project Status Report & Briefing doc\n\n[PAGE 1]\nProject: Noted Launch Spec\nStatus: Active (Local Sandbox Mode)\nDetails: Working client-side text engine initialized. FileTree systems loaded.\n\n[PAGE 2]\nMeeting Notes & Transcripts:\n- Resolved sidebar toggle on main grid container.\n- Added full read-only preview support for Microsoft Word docs and Adobe PDFs.`;
  }

  // Calculate total pages for proper pagination
  const isRealPdfLoaded = isPdf && localFile;
  const totalPages = isRealPdfLoaded
    ? Math.max(1, Math.ceil(extractedParagraphs.length / 6))
    : (isPdf ? 3 : 2);

  return (
    <div className="flex-1 flex flex-col bg-theme-bg h-full text-theme-text font-sans relative select-none">
      {/* Document Viewer Header */}
      <div className="h-12 border-b border-theme-border px-4 flex items-center justify-between text-xs bg-theme-sidebar-header shrink-0">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[10px] tracking-wider font-semibold uppercase px-2 py-0.5 rounded border ${
            isPdf 
              ? 'bg-rose-950/40 text-rose-400 border-rose-900/60' 
              : 'bg-blue-955/40 text-blue-400 border-blue-900/60'
          }`}>
            {isPdf ? 'PDF Reader' : 'Word Document'}
          </span>
          <span className="text-[#3a3a3a]">/</span>
          <span className="truncate max-w-xs text-theme-muted font-medium">{fileName}</span>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-2">
          {/* View Mode Switching Tab (Only for PDFs) */}
          {isPdf && (
            <div className="flex bg-theme-input border border-theme-border p-0.5 rounded mr-2">
              <button
                onClick={() => setViewMode('interactive')}
                className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded cursor-pointer transition-all ${
                  viewMode === 'interactive'
                    ? 'bg-theme-bg text-theme-white'
                    : 'text-theme-muted hover:text-theme-white'
                }`}
                title="Bypass browser blocks with beautiful local client parser"
              >
                📖 Interactive Reader
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded cursor-pointer transition-all ${
                  viewMode === 'raw'
                    ? 'bg-theme-bg text-theme-white'
                    : 'text-theme-muted hover:text-theme-white'
                }`}
                title="Try browser's default PDF viewer (might fail in sandboxes)"
              >
                🔌 Raw Frame
              </button>
            </div>
          )}

          {/* Zoom controls (only applicable in interactive mode) */}
          {viewMode === 'interactive' && (
            <div className="flex items-center gap-1.5 border border-theme-border bg-theme-input rounded px-2 py-1 select-none">
              <button 
                onClick={() => setZoom(Math.max(50, zoom - 10))}
                className="text-theme-muted hover:text-theme-white cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono text-theme-muted min-w-[2.5rem] text-center">{zoom}%</span>
              <button 
                onClick={() => setZoom(Math.min(200, zoom + 10))}
                className="text-theme-muted hover:text-theme-white cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Download button */}
          <button 
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-active hover:bg-theme-hover hover:text-theme-white text-theme-text rounded border border-theme-border cursor-pointer transition-all text-[11px] font-medium"
            title="Download document file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>

          {/* Re-upload / Upload File Trigger */}
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center p-1.5 bg-transparent border border-theme-border text-theme-muted hover:text-theme-white hover:bg-theme-hover transition-all rounded cursor-pointer"
            title="Import/Replace with real file"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept={isPdf ? ".pdf" : ".doc,.docx"} 
            className="hidden" 
          />
        </div>
      </div>

      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* VIEWMODE: RAW PDF FRAME (Iframe previewer support) */}
        {viewMode === 'raw' && objectUrl ? (
          <div className="flex-1 flex flex-col bg-theme-bg p-3 relative h-full">
            {/* Warning explaining iframe sandbox limitations */}
            <div className="bg-amber-955/20 text-amber-300 border border-amber-900/40 p-2.5 rounded-lg text-[11px] leading-relaxed mb-2.5 flex items-start gap-2.5 shadow">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
              <div>
                <strong>Sandbox Security Restriction Notice:</strong> Nested preview zones (like inside AI Studio) disable default browser plugins like Adobe/Chrome PDF viewers for blob URLs. If this screen is blank or displays "Failed to load", switch to the <strong>📖 Interactive Reader View</strong> or download the file directly, or launch the applet in a <strong>New Tab</strong> using the setting wheel.
              </div>
            </div>
            
            <iframe 
              src={`${objectUrl}#toolbar=1`} 
              className="flex-1 w-full border-none bg-neutral-900 rounded-lg shadow-2xl" 
              title={fileName}
            />
          </div>

        ) : (
          
          /* VIEWMODE: INTERACTIVE NATIVE READER VIEW (Never crashes, fully sandboxed-ready) */
          <div className="flex-1 flex overflow-hidden">
            {/* Left Outline Navigation bar */}
            <div className="w-56 border-r border-theme-border bg-theme-sidebar-bg p-4 flex flex-col font-sans select-none shrink-0 text-xs text-theme-muted">
              <span className="text-[10px] uppercase font-bold tracking-wider text-theme-darker mb-3 block">Document Outline</span>
              <div className="space-y-1.5">
                {isRealPdfLoaded ? (
                  Array.from({ length: totalPages }).slice(0, 8).map((_, idx) => (
                    <button 
                      key={idx}
                      onClick={() => setCurrentPage(idx + 1)} 
                      className={`w-full text-left p-2 rounded block duration-100 hover:bg-theme-hover hover:text-theme-white ${currentPage === idx + 1 ? 'bg-theme-active text-theme-white border-l-2 border-rose-500 font-medium' : ''}`}
                    >
                      • Virtual Page {idx + 1}
                    </button>
                  ))
                ) : (
                  <>
                    <button 
                      onClick={() => setCurrentPage(1)} 
                      className={`w-full text-left p-2 rounded block duration-100 hover:bg-theme-hover hover:text-theme-white ${currentPage === 1 ? 'bg-theme-active text-theme-white border-l-2 border-emerald-500 font-medium' : ''}`}
                    >
                      1. Executive Briefing
                    </button>
                    <button 
                      onClick={() => setCurrentPage(2)} 
                      className={`w-full text-left p-2 rounded block duration-100 hover:bg-theme-hover hover:text-theme-white ${currentPage === 2 ? 'bg-theme-active text-theme-white border-l-2 border-emerald-500 font-medium' : ''}`}
                    >
                      2. Systems Engineering Specs
                    </button>
                    {isPdf && (
                      <button 
                        onClick={() => setCurrentPage(3)} 
                        className={`w-full text-left p-2 rounded block duration-100 hover:bg-theme-hover hover:text-theme-white ${currentPage === 3 ? 'bg-theme-active text-theme-white border-l-2 border-emerald-500 font-medium' : ''}`}
                      >
                        3. Local Security Verification
                      </button>
                    )}
                  </>
                )}
                {isRealPdfLoaded && totalPages > 8 && (
                  <span className="text-[10px] font-mono text-theme-darker block px-2 py-1">
                    + {totalPages - 8} more pages...
                  </span>
                )}
              </div>

              {/* Status and instruction boxes */}
              <div className="mt-auto bg-theme-active p-3 rounded border border-theme-border text-[10px] leading-relaxed text-theme-muted flex flex-col gap-1.5">
                <div className="font-bold text-theme-white flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-blue-500" />
                  <span>Sandbox Safe Active</span>
                </div>
                {isRealPdfLoaded ? (
                  <span>Noted parsed text contents page-by-page directly from your physical file. Use the tabs above to toggle between interactive layout & raw PDF frame blocks.</span>
                ) : (
                  <span>Noted runs fully client-side. Drag and drop any real PDF or Word docx onto the canvas sheet to test custom live files directly!</span>
                )}
              </div>
            </div>

            {/* Document display section inside the page canvas */}
            <div className="flex-1 bg-theme-bg flex flex-col relative overflow-hidden">
              <div 
                className={`flex-1 overflow-y-auto p-12 flex justify-center beauty-scrollbar bg-theme-bg relative transition-colors ${
                  dragActive ? 'bg-emerald-950/20' : ''
                }`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
              >
                {/* Standard US Letter Sheet container scaled relative to zoom */}
                <div 
                  className="bg-white text-zinc-900 shadow-2xl p-[0.7in] font-serif rounded-sm flex flex-col justify-between transition-all duration-300"
                  style={{
                    width: `${8.5 * (zoom / 100)}in`,
                    minHeight: `${11 * (zoom / 100)}in`,
                    transformOrigin: 'top center',
                  }}
                >
                  
                  {/* Word document view inside visual container */}
                  {isWord && localFile ? (
                    <div>
                      {/* Header rule */}
                      <div className="border-b-2 border-blue-800 pb-3 mb-6 flex justify-between items-center text-xs font-sans text-neutral-500 tracking-wide uppercase">
                        <span>OFFICE BRIEF</span>
                        <span>Noted formatted text view</span>
                      </div>

                      <div className="mb-8 flex items-start gap-4">
                        <FileText className="w-12 h-12 text-blue-800 shrink-0 mt-1" />
                        <div>
                          <h1 className="text-3xl font-bold tracking-tight font-sans text-neutral-900 mb-1">{localFile?.name}</h1>
                          <p className="text-xs text-neutral-500 font-sans font-mono tracking-wider">
                            SIZE: {(localFile!.size / (1024 * 1024)).toFixed(2)} MB • TYPE: {localFile?.type || "Word DOCX"}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4 text-sm leading-relaxed text-neutral-700 font-sans">
                        <div className="bg-neutral-50 border-l-4 border-blue-600 p-4 rounded text-xs leading-5">
                          <h4 className="font-bold text-neutral-900 mb-1 flex items-center gap-1.5 font-sans uppercase tracking-wider text-[10px]">
                            <Info className="w-4 h-4 text-blue-600" /> Web Word-Doc Preview Node
                          </h4>
                          Web browsers do not compile native interactive Docx viewers. Feel free to download the file anytime to read/update using Microsoft Word or Google Docs. Below is the metadata extracted from the file.
                        </div>

                        <div className="pt-6 space-y-4">
                          <h3 className="text-lg font-bold text-neutral-900 border-b border-neutral-200 pb-2">Document Details</h3>
                          <div className="grid grid-cols-2 gap-4 text-xs font-mono text-neutral-600">
                            <div className="bg-neutral-50 p-3 rounded border border-neutral-100">
                              <span className="text-[10px] text-neutral-400 block mb-0.5">FILE NAME:</span>
                              <span className="text-neutral-800 break-all">{localFile?.name}</span>
                            </div>
                            <div className="bg-neutral-50 p-3 rounded border border-neutral-100">
                              <span className="text-[10px] text-neutral-400 block mb-0.5">FILE SIZE:</span>
                              <span className="text-neutral-800">{(localFile!.size / 1024).toFixed(1)} KB ({localFile?.size} bytes)</span>
                            </div>
                            <div className="bg-neutral-50 p-3 rounded border border-neutral-100">
                              <span className="text-[10px] text-neutral-400 block mb-0.5">LAST MODIFIED:</span>
                              <span className="text-neutral-800">{new Date(localFile!.lastModified).toLocaleString()}</span>
                            </div>
                            <div className="bg-neutral-50 p-3 rounded border border-neutral-100">
                              <span className="text-[10px] text-neutral-400 block mb-0.5">MIME TYPE:</span>
                              <span className="text-neutral-800">{localFile?.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  ) : isRealPdfLoaded ? (
                    
                    /* Real PDF Visual Reader Pages inside interactive viewer */
                    <div>
                      {/* Header rule */}
                      <div className="border-b border-neutral-350 pb-2 mb-6 flex justify-between items-center text-[10px] font-sans text-neutral-400 tracking-wider">
                        <span className="uppercase">{fileName} • PDF REAL PREVIEW</span>
                        <span>INTERACTIVE SANDBOX ENGINE</span>
                      </div>

                      <div className="font-sans">
                        <div className="flex items-center gap-3 mb-5">
                          <div className="w-10 h-10 rounded flex items-center justify-center font-bold text-white text-lg bg-rose-600">
                            PDF
                          </div>
                          <div>
                            <h2 className="text-xl font-bold font-sans tracking-tight text-neutral-950 mb-0.5">{extractedMetadata?.title || fileName}</h2>
                            <span className="text-[10px] font-mono text-neutral-400 block uppercase">
                              Size: {(localFile!.size / (1024 * 1024)).toFixed(2)} MB • {extractedMetadata?.pages ? `${extractedMetadata.pages} pages found` : 'Local PDF Document'}
                            </span>
                          </div>
                        </div>

                        {/* Display metadata if any is defined */}
                        {(extractedMetadata?.author || extractedMetadata?.creator || extractedMetadata?.producer) && (
                          <div className="grid grid-cols-3 gap-3 mb-6 font-mono text-[10px] text-neutral-500 bg-neutral-50 p-2.5 rounded border border-neutral-150">
                            {extractedMetadata.author && (
                              <div>
                                <span className="block text-neutral-400 font-sans font-semibold uppercase tracking-wider text-[8px] mb-0.5">AUTHOR:</span>
                                <span className="text-neutral-800 truncate block">{extractedMetadata.author}</span>
                              </div>
                            )}
                            {extractedMetadata.creator && (
                              <div>
                                <span className="block text-neutral-400 font-sans font-semibold uppercase tracking-wider text-[8px] mb-0.5">CREATOR:</span>
                                <span className="text-neutral-800 truncate block">{extractedMetadata.creator}</span>
                              </div>
                            )}
                            {extractedMetadata.producer && (
                              <div>
                                <span className="block text-neutral-400 font-sans font-semibold uppercase tracking-wider text-[8px] mb-0.5">PRODUCER:</span>
                                <span className="text-neutral-800 truncate block">{extractedMetadata.producer}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Alert box */}
                        <div className="border border-red-200 bg-red-50 text-red-900/80 px-4 py-3 rounded text-[11px] leading-relaxed mb-6 font-sans">
                          <strong>Noted Client-Side Rendering Mode:</strong> To work perfectly inside this preview cage, we extracted the document's raw text and metadata strings below. Keep in mind that direct layout styling, tables, and images are read-only. Enjoy checking textual content safely!
                        </div>

                        <div className="space-y-4 pt-2">
                          {extractedParagraphs.length > 0 ? (
                            extractedParagraphs.slice((currentPage - 1) * 6, currentPage * 6).map((paragraph, index) => (
                              <p key={index} className="font-serif text-[13px] leading-relaxed text-neutral-700">
                                {paragraph}
                              </p>
                            ))
                          ) : (
                            <div className="text-center py-10 text-neutral-400 font-sans">
                              <Info className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                              <p className="text-xs font-semibold text-neutral-800">Unextractable Binary Form</p>
                              <p className="text-[11px] text-neutral-500 mt-1 max-w-xs mx-auto">
                                No raw textual blocks could be parsed client-side (compressed or scanned PDF image format). Feel free to click the <strong>Download</strong> button above to review locally on your disk, or try toggling the <strong>Raw Frame</strong> tab!
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                  ) : (
                    
                    /* Simulated/Active Document Pages (Fallback when no physical file is active) */
                    <div>
                      {/* Header rule */}
                      <div className="border-b border-neutral-350 pb-2 mb-6 flex justify-between items-center text-[10px] font-sans text-neutral-400 tracking-wider">
                        <span className="uppercase">{fileName} • {isPdf ? 'PORTABLE DOC' : 'OFFICE XML'}</span>
                        <span>SIMULATED NOTEOS READER</span>
                      </div>

                      {currentPage === 1 && (
                        <div className="animate-fade-in font-sans">
                          <div className="flex items-center gap-3 mb-6">
                            <div className={`w-10 h-10 rounded flex items-center justify-center font-bold text-white text-lg ${isPdf ? 'bg-rose-600' : 'bg-blue-600'}`}>
                              {isPdf ? 'PDF' : 'DOC'}
                            </div>
                            <div>
                              <h2 className="text-xl font-bold font-sans tracking-tight text-neutral-950 mb-0.5">{fileName}</h2>
                              <span className="text-[10px] font-mono text-neutral-400 block uppercase">Section 1: Project Overview & Executive Briefing</span>
                            </div>
                          </div>

                          <div className="border border-neutral-200 rounded p-4 bg-neutral-50 text-xs text-neutral-600 font-sans mb-6">
                            <strong>Noted Simulated Document Workspaces:</strong> This view is simulating the document format of file <code>{fileName}</code>. Noted supports loading fully qualified real documents. Drag & drop a real file on this page or use the toolbar uploader to see real document content!
                          </div>

                          <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wide border-b border-neutral-200 pb-1.5 mb-3 font-sans mt-8">1. Abstract Overview</h3>
                          <p className="font-serif text-[13px] leading-relaxed text-neutral-700 mb-4">
                            Noted is engineered as a privacy-centric notepad targeting the local filesystem directly. Through modern system-level APIs like the W3C File System Access standard, users can map entire directories from their home disk environment into this sandboxed applet safely.
                          </p>
                          <p className="font-serif text-[13px] leading-relaxed text-neutral-700">
                            Traditional word processors rely on heavily bloated background binaries and cloud databases that can compromise privacy. Noted operates purely in client memory loops, respecting the absolute ceiling of local data ownership.
                          </p>
                        </div>
                      )}

                      {currentPage === 2 && (
                        <div className="animate-fade-in font-sans">
                          <h2 className="text-lg font-bold font-sans tracking-tight text-neutral-950 mb-1 border-b border-neutral-350 pb-1.5">Section 2: Engineering Specifications</h2>
                          <span className="text-[10px] font-mono text-neutral-400 block uppercase mb-6">Database, filesystem, and layout loops</span>

                          <p className="font-serif text-[13px] leading-relaxed text-neutral-700 mb-4">
                            The underlying architecture binds React v18 components with Vite as a bundling optimizer. Directory traversals run inside web workers when loading incredibly deep nested structures, ensuring consistent 60 FPS visual outputs during fluid sidebar animations.
                          </p>

                          <div className="mt-6 bg-zinc-50 border border-zinc-200 rounded p-4 font-mono text-[11px] leading-5 text-neutral-600">
                            <code className="text-zinc-800 font-bold block mb-1">=== SYSTEM PERMISSIONS CHECK ===</code>
                            - IFRAME SANDBOX: STRICT CONSTRAINED<br />
                            - LOCAL PERSISTENCE: READY<br />
                            - FILE ACCESS CODES: APPROVED<br />
                            - DIRECTORY DEPTH: WALK COMPLETED
                          </div>
                        </div>
                      )}

                      {currentPage === 3 && isPdf && (
                        <div className="animate-fade-in font-sans">
                          <h2 className="text-lg font-bold font-sans tracking-tight text-neutral-950 mb-1 border-b border-neutral-350 pb-1.5">Section 3: Security Certifications</h2>
                          <span className="text-[10px] font-mono text-neutral-400 block uppercase mb-6">Local sandboxing and data boundaries</span>

                          <p className="font-serif text-[13px] leading-relaxed text-neutral-700 mb-4">
                            The document verifies that Noted does not contain telemetry hooks. No external tracking domains are referenced in the runtime structure, rendering this layout completely safe for high-security enterprise drafting, sensitive notes logging, and personal diary keeping.
                          </p>

                          <div className="flex gap-2 items-center bg-emerald-50 text-emerald-800 border-l-4 border-emerald-600 p-3 rounded mt-8 text-xs font-sans">
                            <Check className="w-4 h-4 text-emerald-600" />
                            <span>Noted Sandbox environment complies with browser data protection standards.</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Standard PDF Footer card */}
                  <div className="border-t border-neutral-200 pt-3 mt-10 flex justify-between text-[10px] font-sans text-neutral-450 select-none">
                    <span className="uppercase">PAGE {currentPage} OF {totalPages}</span>
                    <span>CONFIDENTIAL REVIEW COPY</span>
                  </div>
                </div>
              </div>

              {/* Bottom Pagination controls */}
              <div className="h-10 bg-theme-sidebar-header border-t border-theme-border px-4 flex items-center justify-between text-xs shrink-0 select-none">
                <span className="text-theme-muted font-mono">Simulated Layout View</span>
                
                {/* Page Navigation Actions */}
                <div className="flex items-center gap-3">
                  <button 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(currentPage - 1)}
                    className="p-1 text-theme-muted hover:text-theme-white disabled:opacity-30 disabled:hover:text-theme-muted cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-theme-muted">Page {currentPage} of {totalPages}</span>
                  <button 
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(currentPage + 1)}
                    className="p-1 text-theme-muted hover:text-theme-white disabled:opacity-30 disabled:hover:text-theme-muted cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Upload notify success alert */}
                <div>
                  {uploadSuccess ? (
                    <span className="text-emerald-500 flex items-center gap-1 font-sans text-[11px] animate-pulse">
                      <Check className="w-3.5 h-3.5" /> File Loaded!
                    </span>
                  ) : (
                    <span className="text-theme-muted text-[10px]">Drag a real file over to display</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
