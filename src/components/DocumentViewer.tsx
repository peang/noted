import { useState, useEffect, useRef } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useNoteStore } from '../store/noteStore';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download } from 'lucide-react';

GlobalWorkerOptions.workerSrc = workerUrl;

interface DocumentViewerProps {
  filePath: string;
}

export default function DocumentViewer({ filePath }: DocumentViewerProps) {
  const activeFileObject = useNoteStore((state) => state.activeFileObject);
  const isSimulated = useNoteStore((state) => state.isSimulated);
  const activeContent = useNoteStore((state) => state.activeContent);

  const [localFile, setLocalFile] = useState<File | null>(null);
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const extension = filePath.toLowerCase().split('.').pop() || '';
  const isPdf = extension === 'pdf';
  const fileName = filePath.split('/').pop() || 'Document';

  useEffect(() => {
    if (activeFileObject) {
      setLocalFile(activeFileObject);
    } else if (isSimulated && activeContent?.startsWith('data:')) {
      fetch(activeContent)
        .then((r) => r.blob())
        .then((blob) => setLocalFile(new File([blob], fileName, { type: blob.type })))
        .catch(console.error);
    } else {
      setLocalFile(null);
    }
    setCurrentPage(1);
  }, [activeFileObject, activeContent, filePath, isSimulated]);

  useEffect(() => {
    if (!localFile || !isPdf) {
      setPdfDoc(null);
      setNumPages(0);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    localFile.arrayBuffer()
      .then((buf) => getDocument({ data: buf }).promise)
      .then((pdf) => { if (!cancelled) { setPdfDoc(pdf); setNumPages(pdf.numPages); } })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load PDF'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [localFile, isPdf]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || currentPage < 1 || currentPage > numPages) return;

    let cancelled = false;

    pdfDoc.getPage(currentPage).then((page: any) => {
      if (cancelled) return;
      const scale = zoom / 100;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      return page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    }).catch(console.error);

    return () => { cancelled = true; };
  }, [pdfDoc, currentPage, zoom, numPages]);

  const handleDownload = () => {
    if (localFile) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(localFile);
      link.download = localFile.name;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-theme-bg h-full text-theme-text font-sans relative select-none">
      {/* Header */}
      <div className="h-12 border-b border-theme-border px-4 flex items-center justify-between text-xs bg-theme-sidebar-header shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wider font-semibold uppercase px-2 py-0.5 rounded border bg-rose-950/40 text-rose-400 border-rose-900/60">
            PDF
          </span>
          <span className="text-theme-darker">/</span>
          <span className="truncate max-w-xs text-theme-muted font-medium">{fileName}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border border-theme-border bg-theme-input rounded px-2 py-1">
            <button onClick={() => setZoom(Math.max(50, zoom - 10))} className="text-theme-muted hover:text-theme-white cursor-pointer">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono text-theme-muted min-w-[2.5rem] text-center">{zoom}%</span>
            <button onClick={() => setZoom(Math.min(200, zoom + 10))} className="text-theme-muted hover:text-theme-white cursor-pointer">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
          {localFile && (
            <button onClick={handleDownload} className="p-1.5 text-theme-muted hover:text-theme-white cursor-pointer" title="Download">
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-theme-bg flex items-start justify-center p-4 beauty-scrollbar">
        {!localFile && !isPdf ? (
          <div className="text-theme-darker text-xs font-mono mt-20">Document not available</div>
        ) : loading ? (
          <div className="flex items-center gap-2 text-theme-muted mt-20">
            <div className="w-4 h-4 border-2 border-theme-muted border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono">Loading PDF...</span>
          </div>
        ) : error ? (
          <div className="text-theme-muted text-xs font-mono mt-20 text-center max-w-md">
            <div className="text-red-400 font-semibold mb-1">Failed to load PDF</div>
            <div className="text-[10px] text-theme-darker">{error}</div>
          </div>
        ) : pdfDoc ? (
          <div className="shadow-2xl bg-white rounded-sm overflow-hidden">
            <canvas ref={canvasRef} className="block" />
          </div>
        ) : (
          <div className="text-theme-darker text-xs font-mono mt-20">No PDF loaded</div>
        )}
      </div>

      {/* Footer pagination */}
      <div className="h-10 bg-theme-sidebar-header border-t border-theme-border px-4 flex items-center justify-center text-xs shrink-0 select-none">
        {numPages > 0 ? (
          <div className="flex items-center gap-3">
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(currentPage - 1)}
              className="p-1 text-theme-muted hover:text-theme-white disabled:opacity-30 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-theme-muted">Page {currentPage} of {numPages}</span>
            <button
              disabled={currentPage >= numPages}
              onClick={() => setCurrentPage(currentPage + 1)}
              className="p-1 text-theme-muted hover:text-theme-white disabled:opacity-30 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span className="text-theme-darker text-[10px] font-mono">PDF Reader</span>
        )}
      </div>
    </div>
  );
}
