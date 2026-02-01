import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderAsync } from 'docx-preview';
import ExcelJS from 'exceljs';
import { api, type Document } from '@/lib/api';

interface DocumentViewerPageProps {
  documentId: string;
  onBack: () => void;
}

// MIME types for Office documents
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

interface SlideData {
  index: number;
  texts: string[];
}

export function DocumentViewerPage({ documentId, onBack }: DocumentViewerPageProps) {
  const [document, setDocument] = useState<Document | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  const handleRunOcr = async () => {
    if (!document || ocrRunning) return;
    setOcrRunning(true);
    try {
      await api.documents.runOcr(documentId);
      // Refresh document to show new status
      const updatedDoc = await api.documents.get(documentId);
      setDocument(updatedDoc);
    } catch (err) {
      console.error('Failed to start OCR:', err);
    } finally {
      setOcrRunning(false);
    }
  };

  // Check if OCR is available for this document
  const canRunOcr = document &&
    document.status === 'completed' &&
    (document.mime_type.startsWith('image/') || document.mime_type === 'application/pdf') &&
    document.metadata?.ocr_engine !== 'chandra';

  useEffect(() => {
    async function load() {
      try {
        const doc = await api.documents.get(documentId);
        setDocument(doc);

        // Only fetch text content for documents that need markdown rendering
        const isPdf = doc.mime_type === 'application/pdf';
        const isImage = doc.mime_type.startsWith('image/');
        const isOffice = [DOCX_MIME, XLSX_MIME, PPTX_MIME].includes(doc.mime_type);

        if (doc.status === 'completed' && !isPdf && !isImage && !isOffice) {
          try {
            const contentRes = await api.documents.getContent(documentId);
            setContent(contentRes.content);
          } catch {
            setContent(null);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [documentId]);

  // Render DOCX files using docx-preview
  useEffect(() => {
    async function renderDocx() {
      if (!document || document.mime_type !== DOCX_MIME || !docxContainerRef.current) {
        return;
      }

      setOfficeLoading(true);
      try {
        const response = await fetch(api.documents.getFileUrl(documentId));
        const blob = await response.blob();

        const container = docxContainerRef.current;
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        await renderAsync(blob, container, undefined, {
          className: 'docx-preview',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: true,
          trimXmlDeclaration: true,
          useBase64URL: true,
        });
      } catch (err) {
        console.error('Failed to render DOCX:', err);
        try {
          const contentRes = await api.documents.getContent(documentId);
          setContent(contentRes.content);
        } catch {
          setContent(null);
        }
      } finally {
        setOfficeLoading(false);
      }
    }

    if (document?.status === 'completed' && document.mime_type === DOCX_MIME) {
      renderDocx();
    }
  }, [document, documentId]);

  // Render XLSX files using exceljs
  useEffect(() => {
    async function renderXlsx() {
      if (!document || document.mime_type !== XLSX_MIME) {
        return;
      }

      setOfficeLoading(true);
      try {
        const response = await fetch(api.documents.getFileUrl(documentId));
        const arrayBuffer = await response.arrayBuffer();

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);

        const sheetData: SheetData[] = [];
        workbook.eachSheet((worksheet) => {
          const headers: string[] = [];
          const rows: string[][] = [];

          worksheet.eachRow((row, rowNumber) => {
            const values = row.values as (string | number | boolean | null | undefined)[];
            // ExcelJS row.values is 1-indexed, first element is empty
            const cells = values.slice(1).map(v => {
              if (v === null || v === undefined) return '';
              if (typeof v === 'object' && 'text' in v) return String((v as { text: string }).text);
              if (typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result);
              return String(v);
            });

            if (rowNumber === 1) {
              headers.push(...cells);
            } else {
              rows.push(cells);
            }
          });

          if (headers.length > 0 || rows.length > 0) {
            sheetData.push({ name: worksheet.name, headers, rows });
          }
        });

        setSheets(sheetData);
        setActiveSheet(0);
      } catch (err) {
        console.error('Failed to render XLSX:', err);
        try {
          const contentRes = await api.documents.getContent(documentId);
          setContent(contentRes.content);
        } catch {
          setContent(null);
        }
      } finally {
        setOfficeLoading(false);
      }
    }

    if (document?.status === 'completed' && document.mime_type === XLSX_MIME) {
      renderXlsx();
    }
  }, [document, documentId]);

  // Render PPTX files by extracting slide content
  useEffect(() => {
    async function renderPptx() {
      if (!document || document.mime_type !== PPTX_MIME) {
        return;
      }

      setOfficeLoading(true);
      try {
        const response = await fetch(api.documents.getFileUrl(documentId));
        const arrayBuffer = await response.arrayBuffer();

        // PPTX is a ZIP file, use JSZip to extract
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(arrayBuffer);

        const slideData: SlideData[] = [];
        const slideFiles = Object.keys(zip.files)
          .filter(f => f.match(/ppt\/slides\/slide\d+\.xml$/))
          .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
            const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
            return numA - numB;
          });

        for (let i = 0; i < slideFiles.length; i++) {
          const slideXml = await zip.file(slideFiles[i])?.async('text');
          if (slideXml) {
            // Extract text content from XML using regex (simple approach)
            const texts: string[] = [];
            const textMatches = slideXml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
            for (const match of textMatches) {
              const text = match[1].trim();
              if (text) {
                texts.push(text);
              }
            }
            slideData.push({ index: i + 1, texts });
          }
        }

        setSlides(slideData);
        setActiveSlide(0);
      } catch (err) {
        console.error('Failed to render PPTX:', err);
        try {
          const contentRes = await api.documents.getContent(documentId);
          setContent(contentRes.content);
        } catch {
          setContent(null);
        }
      } finally {
        setOfficeLoading(false);
      }
    }

    if (document?.status === 'completed' && document.mime_type === PPTX_MIME) {
      renderPptx();
    }
  }, [document, documentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">{error || 'Document not found'}</p>
        <button onClick={onBack} className="mt-4 text-blue-500 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const isPdf = document.mime_type === 'application/pdf';
  const isImage = document.mime_type.startsWith('image/');
  const isDocx = document.mime_type === DOCX_MIME;
  const isXlsx = document.mime_type === XLSX_MIME;
  const isPptx = document.mime_type === PPTX_MIME;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {document.title}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {document.filename} • {document.status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canRunOcr && (
            <button
              onClick={handleRunOcr}
              disabled={ocrRunning}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {ocrRunning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running OCR...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Run OCR
                </>
              )}
            </button>
          )}
          <a
            href={api.documents.getFileUrl(documentId)}
            download={document.filename}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </a>
        </div>
      </div>

      {/* Content */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {document.status === 'processing' && (
          <div className="p-8 text-center">
            <svg className="w-8 h-8 animate-spin text-blue-500 mx-auto" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="mt-4 text-gray-500 dark:text-gray-400">Processing document...</p>
          </div>
        )}

        {document.status === 'failed' && (
          <div className="p-8 text-center">
            <p className="text-red-500">Processing failed: {document.error_message}</p>
            <button
              onClick={() => api.documents.reprocess(documentId)}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              Retry Processing
            </button>
          </div>
        )}

        {document.status === 'completed' && (
          <>
            {isPdf && (
              <iframe
                src={api.documents.getFileUrl(documentId, true)}
                className="w-full h-[calc(100vh-260px)]"
                title={document.title}
              />
            )}

            {isImage && (
              <div className="p-4 flex items-center justify-center">
                <img
                  src={api.documents.getFileUrl(documentId, true)}
                  alt={document.title}
                  className="max-w-full max-h-[calc(100vh-200px)] object-contain"
                />
              </div>
            )}

            {isDocx && (
              <div className="relative">
                {officeLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-800 z-10">
                    <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}
                <div
                  ref={docxContainerRef}
                  className="docx-container overflow-auto h-[calc(100vh-260px)]"
                />
              </div>
            )}

            {isXlsx && (
              <div className="relative">
                {officeLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-800 z-10">
                    <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}
                {sheets.length > 0 && (
                  <div className="h-[calc(100vh-260px)] flex flex-col">
                    {/* Sheet tabs */}
                    {sheets.length > 1 && (
                      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                        {sheets.map((sheet, idx) => (
                          <button
                            key={sheet.name}
                            onClick={() => setActiveSheet(idx)}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                              activeSheet === idx
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                            }`}
                          >
                            {sheet.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Sheet content */}
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100 dark:bg-gray-700 sticky top-0">
                          <tr>
                            {sheets[activeSheet]?.headers.map((h, i) => (
                              <th
                                key={i}
                                className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 border-b border-r border-gray-200 dark:border-gray-600"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sheets[activeSheet]?.rows.map((row, rowIdx) => (
                            <tr key={rowIdx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              {row.map((cell, cellIdx) => (
                                <td
                                  key={cellIdx}
                                  className="px-3 py-2 border-b border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isPptx && (
              <div className="relative">
                {officeLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-800 z-10">
                    <svg className="w-8 h-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}
                {slides.length > 0 && (
                  <div className="h-[calc(100vh-260px)] flex">
                    {/* Slide thumbnails */}
                    <div className="w-48 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-y-auto flex-shrink-0">
                      {slides.map((slide, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveSlide(idx)}
                          className={`w-full p-3 text-left border-b border-gray-200 dark:border-gray-700 transition-colors ${
                            activeSlide === idx
                              ? 'bg-blue-100 dark:bg-blue-900/30'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                            Slide {slide.index}
                          </div>
                          <div className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
                            {slide.texts[0] || '(No text)'}
                          </div>
                        </button>
                      ))}
                    </div>
                    {/* Slide content */}
                    <div className="flex-1 p-8 overflow-auto">
                      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 min-h-[400px]">
                        {slides[activeSlide]?.texts.map((text, idx) => (
                          <p
                            key={idx}
                            className={`mb-4 ${
                              idx === 0
                                ? 'text-2xl font-bold text-gray-900 dark:text-gray-100'
                                : 'text-lg text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {text}
                          </p>
                        ))}
                        {slides[activeSlide]?.texts.length === 0 && (
                          <p className="text-gray-400 dark:text-gray-500 italic">
                            This slide has no text content
                          </p>
                        )}
                      </div>
                      {/* Navigation */}
                      <div className="flex justify-center gap-4 mt-6">
                        <button
                          onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
                          disabled={activeSlide === 0}
                          className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <span className="px-4 py-2 text-gray-600 dark:text-gray-400">
                          {activeSlide + 1} / {slides.length}
                        </span>
                        <button
                          onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))}
                          disabled={activeSlide === slides.length - 1}
                          className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isPdf && !isImage && !isDocx && !isXlsx && !isPptx && content && (
              <div className="p-6 prose dark:prose-invert max-w-none overflow-auto max-h-[calc(100vh-260px)]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            )}
          </>
        )}

        {document.status === 'pending' && (
          <div className="p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">Document queued for processing...</p>
          </div>
        )}
      </div>

      {/* Styles for docx-preview */}
      <style>{`
        .docx-container .docx-wrapper {
          background: white;
          padding: 20px;
        }
        .docx-container .docx-wrapper > section.docx {
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          margin-bottom: 20px;
        }
      `}</style>
    </div>
  );
}
