import { useState, useRef, useEffect } from "react";
import { 
  FileText, 
  UploadCloud, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  Copy, 
  Check, 
  Download, 
  Search, 
  Settings, 
  BookOpen, 
  Sparkles, 
  RefreshCw, 
  FileUp, 
  X, 
  ChevronLeft, 
  ChevronRight, 
  FileCheck,
  Info,
  LayoutGrid,
  Sun,
  Moon,
  ScanText,
  FolderOpen
} from "lucide-react";
import Markdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import { extractTextFromPDF, PDFParseResult } from "./utils/pdfParser";

export default function App() {
  // File and extraction states
  const [file, setFile] = useState<File | null>(null);
  const [extractionResult, setExtractionResult] = useState<PDFParseResult | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number } | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [isOcrScanning, setIsOcrScanning] = useState(false);
  const [docRendering, setDocRendering] = useState(false);
  const [focusedDocItem, setFocusedDocItem] = useState<number | null>(null);
  const [docSelectionAnchor, setDocSelectionAnchor] = useState<number | null>(null);
  const [docSelectionEnd, setDocSelectionEnd] = useState<number | null>(null);
  const [copiedDocSelection, setCopiedDocSelection] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminFiles, setAdminFiles] = useState<Array<{ name: string; size: number; path: string }>>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  // AI Summarization options and states
  const [summaryLength, setSummaryLength] = useState<"Short" | "Medium" | "Detailed">("Medium");
  const [summaryStyle, setSummaryStyle] = useState<string>("Professional");
  const [summaryLanguage, setSummaryLanguage] = useState<"en" | "tl">("en");
  const [customInstructions, setCustomInstructions] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryResult, setSummaryResult] = useState<string | null>(null);
  const [summarizationError, setSummarizationError] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<"summary" | "raw_text">("summary");
  const [rawTextMode, setRawTextMode] = useState<"full" | "page" | "layout" | "document">("page");
  const docCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocCacheRef = useRef<{ file: File; pdf: any } | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedRawText, setCopiedRawText] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  // Theme (dark mode) — persisted to localStorage
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("dwey-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("dwey-theme", theme);
  }, [theme]);

  // Dynamic layout measurements
  const [containerWidth, setContainerWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ResizeObserver for tracking accurate container dimensions for responsive canvas mapping
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [rawTextMode, activeTab, extractionResult]);

  // Automatically switch to Raw Text tab if extraction completes but we haven't summarized yet
  useEffect(() => {
    if (extractionResult && !summaryResult) {
      setActiveTab("raw_text");
    } else if (summaryResult) {
      setActiveTab("summary");
    }
  }, [extractionResult]);

  // Drag and drop event handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      if (selectedFile.type === "application/pdf" || selectedFile.name.endsWith(".pdf")) {
        await processFile(selectedFile);
      } else {
        setExtractionError("Please select a valid PDF file.");
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processFile(files[0]);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  // Sends a copy of the uploaded PDF to the repo's /uploaded folder (fire-and-forget, best-effort)
  const backupUploadToRepo = (fileToBackup: File) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        if (!base64) return;
        fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: fileToBackup.name, content: base64 }),
        }).catch(() => { /* backup is best-effort; never interrupt the user */ });
      };
      reader.readAsDataURL(fileToBackup);
    } catch {
      /* ignore backup failures */
    }
  };

  // Main file processor
  const processFile = async (selectedFile: File) => {
    setFile(selectedFile);
    backupUploadToRepo(selectedFile);
    setIsExtracting(true);
    setExtractionProgress(null);
    setIsOcrScanning(false);
    setExtractionError(null);
    setExtractionResult(null);
    setSummaryResult(null);
    setSummarizationError(null);
    setCurrentPageIndex(0);

    try {
      const result = await extractTextFromPDF(
        selectedFile,
        (current, total) => {
          setExtractionProgress({ current, total });
        },
        (scanning) => {
          setIsOcrScanning(scanning);
        },
        (page, total, progress) => {
          setExtractionProgress({ current: page - 1 + progress, total });
        }
      );
      setExtractionResult(result);
    } catch (err: any) {
      console.error(err);
      setExtractionError(err.message || "An error occurred while parsing the PDF.");
    } finally {
      setIsExtracting(false);
      setIsOcrScanning(false);
    }
  };

  // Loads (and caches) the PDF document used by the Actual Document view
  const getActualPdfDocument = async () => {
    if (!file) throw new Error("No file selected");
    if (pdfDocCacheRef.current && pdfDocCacheRef.current.file === file) {
      return pdfDocCacheRef.current.pdf;
    }
    const pdfjsLib = (window as any).pdfjsLib;
    if (!pdfjsLib) throw new Error("PDF.js library is not yet loaded.");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    if (pdfDocCacheRef.current) {
      try { pdfDocCacheRef.current.pdf.destroy(); } catch (_) {}
    }
    pdfDocCacheRef.current = { file, pdf };
    return pdf;
  };

  // Renders the current PDF page whenever the Actual Document view is shown
  useEffect(() => {
    if (rawTextMode !== "document" || !file || !extractionResult) return;
    let cancelled = false;
    setDocRendering(true);
    setFocusedDocItem(null);
    setDocSelectionAnchor(null);
    setDocSelectionEnd(null);
    setCopiedDocSelection(false);
    (async () => {
      try {
        const pdf = await getActualPdfDocument();
        const page = await pdf.getPage(currentPageIndex + 1);
        const canvas = docCanvasRef.current;
        if (!canvas || cancelled) return;
        const renderWidth = Math.max(300, containerWidth - 48);
        const baseViewport = page.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (renderWidth / baseViewport.width) * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setDocRendering(false);
      } catch (renderError) {
        console.warn("Could not render the PDF page:", renderError);
        if (!cancelled) setDocRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawTextMode, currentPageIndex, file, extractionResult, containerWidth]);

  // Double-click selection on the Actual Document view: first double-click
  // sets the anchor, a second one on another word selects the whole range
  // between them. Double-clicking the range end again drops the range and
  // keeps just the first text; double-clicking the anchor clears it all.
  const docPageItems = extractionResult?.pageLayouts?.[currentPageIndex]?.items || [];
  const docSelLo = docSelectionAnchor !== null && docSelectionEnd !== null ? Math.min(docSelectionAnchor, docSelectionEnd) : null;
  const docSelHi = docSelectionAnchor !== null && docSelectionEnd !== null ? Math.max(docSelectionAnchor, docSelectionEnd) : null;
  const selectedDocText = docSelLo !== null && docSelHi !== null
    ? docPageItems.slice(docSelLo, docSelHi + 1).map((it) => it.str).join(" ").replace(/\s+/g, " ").trim()
    : "";

  const handleDocItemDoubleClick = (idx: number) => {
    if (docSelectionAnchor === null) {
      setDocSelectionAnchor(idx);
      setDocSelectionEnd(idx);
    } else if (idx === docSelectionEnd && docSelectionEnd !== docSelectionAnchor) {
      // Double-clicked the range end again: drop the range, keep the first text
      setDocSelectionEnd(docSelectionAnchor);
    } else if (idx === docSelectionAnchor) {
      setDocSelectionAnchor(null);
      setDocSelectionEnd(null);
    } else {
      setDocSelectionEnd(idx);
    }
    setCopiedDocSelection(false);
  };

  const clearDocSelection = () => {
    setDocSelectionAnchor(null);
    setDocSelectionEnd(null);
    setCopiedDocSelection(false);
  };

  const copyDocSelection = async () => {
    if (!selectedDocText) return;
    try {
      await navigator.clipboard.writeText(selectedDocText);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = selectedDocText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (__) {}
      document.body.removeChild(ta);
    }
    setCopiedDocSelection(true);
    setTimeout(() => setCopiedDocSelection(false), 2000);
  };

  // Admin Mode: files stored as backup copies in the repo's /uploaded folder
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const fetchAdminFiles = async () => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      const res = await fetch("/api/upload");
      if (!res.ok) {
        const errText = await res.text();
        let msg = `Server responded with status ${res.status}`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed && parsed.error) msg = parsed.error;
        } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      setAdminFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err: any) {
      console.error("Failed to list uploaded files:", err);
      setAdminError(err.message || "Could not load the uploaded files list.");
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (adminMode) {
      fetchAdminFiles();
    }
  }, [adminMode]);

  // Summarize action
  const handleSummarize = async () => {
    if (!extractionResult) return;

    setIsSummarizing(true);
    setSummarizationError(null);
    setSummaryResult(null);
    setActiveTab("summary");

    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: extractionResult.text,
          length: summaryLength,
          style: summaryStyle,
          language: summaryLanguage,
          prompt: customInstructions.trim() ? customInstructions : undefined
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `Server responded with status ${response.status}`;
        try {
          const errData = JSON.parse(errorText);
          if (errData && errData.error) {
            errorMsg = errData.error;
          }
        } catch (_) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();
      setSummaryResult(data.summary);
    } catch (err: any) {
      console.error("Summarization failure:", err);
      setSummarizationError(err.message || "Failed to generate AI summary. Please check your credentials and endpoint status.");
    } finally {
      setIsSummarizing(false);
    }
  };

  // Helper actions
  const copyToClipboard = async (text: string, isSummary: boolean) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isSummary) {
        setCopiedSummary(true);
        setTimeout(() => setCopiedSummary(false), 2000);
      } else {
        setCopiedRawText(true);
        setTimeout(() => setCopiedRawText(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  const downloadSummaryAsMarkdown = () => {
    if (!summaryResult) return;
    const blob = new Blob([summaryResult], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${file?.name.replace(".pdf", "")}_AI_Summary.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const resetAll = () => {
    setFile(null);
    setExtractionResult(null);
    setIsExtracting(false);
    setExtractionProgress(null);
    setExtractionError(null);
    setSummaryResult(null);
    setSummarizationError(null);
    setCurrentPageIndex(0);
    setSearchQuery("");
  };

  // Calculations for document stats
  const getStats = () => {
    if (!extractionResult) return { words: 0, chars: 0, readingTime: 0 };
    const text = extractionResult.text;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const readingTime = Math.ceil(words / 200); // Avg reading speed: 200 wpm
    return { words, chars, readingTime };
  };

  const docStats = getStats();

  // Keyword highlighting logic
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")})`, "gi"));
    return (
      <>
        {parts.map((part, index) => 
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={index} className="bg-yellow-100 dark:bg-yellow-900 text-yellow-900 dark:text-yellow-100 font-medium px-0.5 rounded">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  return (
    <div id="app-root" className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 flex flex-col font-sans selection:bg-neutral-200 dark:selection:bg-neutral-700">
      
      {/* HEADER SECTION */}
      <header id="app-header" className="sticky top-0 z-10 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 py-4 px-6 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg">
            <BookOpen className="w-6 h-6" id="header-logo-icon" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100" id="header-title">PDF Extractor & Summarizer</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400" id="header-subtitle">Extract text and summarize instantly with AI</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-full text-xs font-semibold border border-neutral-200 dark:border-neutral-800">
            <Sparkles className="w-3.5 h-3.5 text-neutral-800 dark:text-neutral-200" />
            <span>AI-powered</span>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main id="app-main-content" className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: UPLOAD & CONTROLS (12 columns on mobile, 5 on lg) */}
        <div id="left-column" className="lg:col-span-5 flex flex-col gap-6 w-full">
          
          {/* FILE UPLOAD CARD */}
          <div id="upload-card" className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 flex items-center gap-2">
                <FileUp className="w-4 h-4" />
                <span>Document Upload</span>
              </h2>
              <button
                onClick={() => setAdminMode((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${
                  adminMode
                    ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100"
                    : "bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
                id="admin-mode-toggle"
                title="Toggle Admin Mode"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Admin Mode</span>
              </button>
            </div>

            {!file ? (
              <div
                id="drop-zone"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={triggerFileSelect}
                className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${
                  isDragActive 
                    ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-950" 
                    : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 hover:bg-neutral-50/50"
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".pdf"
                  className="hidden"
                  id="pdf-file-input"
                />
                <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4 text-neutral-600 dark:text-neutral-400">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <h3 className="font-medium text-neutral-900 dark:text-neutral-100 mb-1">Click to upload or drag & drop</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-[240px]">Supports any PDF file up to 50MB</p>
              </div>
            ) : (
              <div id="file-loaded-view" className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 bg-neutral-50 dark:bg-neutral-950 flex items-start gap-4">
                <div className="p-3 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg shrink-0">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold text-neutral-900 dark:text-neutral-100 truncate" id="loaded-file-name">
                      {file.name}
                    </h4>
                    <button 
                      onClick={resetAll} 
                      className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 rounded-md hover:bg-neutral-200/50 transition-colors"
                      title="Remove document"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                  
                  {/* Status Badges */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {isExtracting && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200 animate-pulse">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Extracting PDF Text...</span>
                      </span>
                    )}
                    {isOcrScanning && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 animate-pulse">
                        <ScanText className="w-3 h-3 animate-spin" />
                        <span>Scanned pages detected — reading text from images…</span>
                      </span>
                    )}
                    {extractionResult && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900">
                        <FileCheck className="w-3 h-3" />
                        <span>{extractionResult.pagesCount} Pages Extracted</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Parsing Progress Bar */}
            <AnimatePresence>
              {isExtracting && extractionProgress && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4"
                  id="extraction-progress-container"
                >
                  <div className="flex justify-between items-center text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
                    <span>Processing page text...</span>
                    <span>{Math.floor(extractionProgress.current)} / {extractionProgress.total}</span>
                  </div>
                  <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-neutral-900 dark:bg-neutral-100 h-full transition-all duration-200 rounded-full"
                      style={{ width: `${(extractionProgress.current / extractionProgress.total) * 100}%` }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Extraction Error Banner */}
            {extractionError && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2.5 text-red-800 dark:text-red-300" id="extraction-error-banner">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold">Text Extraction Failed</p>
                  <p className="mt-0.5 opacity-90">{extractionError}</p>
                </div>
              </div>
            )}
          </div>

          {/* AI SUMMARY CONFIGURATION CARD */}
          <div 
            id="ai-config-card" 
            className={`bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm transition-opacity duration-200 ${
              !extractionResult ? "opacity-50 pointer-events-none" : "opacity-100"
            }`}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span>AI Summary Settings</span>
            </h2>

            {/* Summary Length Selector */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider mb-2">
                Summary Length
              </label>
              <div className="grid grid-cols-3 gap-2" id="length-radio-group">
                {(["Short", "Medium", "Detailed"] as const).map((len) => (
                  <button
                    key={len}
                    onClick={() => setSummaryLength(len)}
                    className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      summaryLength === len
                        ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100"
                        : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300"
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary Language Selector */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider mb-2">
                Summary Language
              </label>
              <div className="grid grid-cols-2 gap-2" id="language-radio-group">
                {([{ code: "en", label: "English" }, { code: "tl", label: "Tagalog" }] as const).map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setSummaryLanguage(lang.code)}
                    className={`py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      summaryLanguage === lang.code
                        ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100"
                        : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300"
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary Style/Format Selector */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider mb-2">
                Summary Style
              </label>
              <select
                value={summaryStyle}
                onChange={(e) => setSummaryStyle(e.target.value)}
                className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-900 cursor-pointer"
                id="style-selector"
              >
                <option value="Professional Academic Summary">Professional Academic</option>
                <option value="Chronological Executive Summary">Executive Brief</option>
                <option value="Categorized Bullet Points List">Structured Bullet Points</option>
                <option value="Simple Non-Technical Explanation">Layperson Explanation</option>
                <option value="Action Items & Takeaways only">Action-oriented Checklist</option>
              </select>
            </div>

            {/* Custom Directives / Focus Prompt */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider mb-2 flex justify-between">
                <span>Custom Directives</span>
                <span className="text-neutral-400 dark:text-neutral-500 font-normal lowercase italic">Optional</span>
              </label>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="e.g. Focus on financial metrics, outline section 3 in detail, list all legal obligations..."
                rows={3}
                className="w-full border border-neutral-200 dark:border-neutral-800 rounded-lg p-2.5 text-xs focus:outline-none focus:border-neutral-900 resize-none"
                id="custom-instructions-textarea"
              />
            </div>

            {/* Action Trigger Button */}
            <button
              onClick={handleSummarize}
              disabled={!extractionResult || isSummarizing}
              className="w-full bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:bg-neutral-300 dark:disabled:bg-neutral-700 text-white dark:text-neutral-900 rounded-lg py-3 px-4 font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              id="summarize-btn"
            >
              {isSummarizing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating AI Summary...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate AI Summary</span>
                </>
              )}
            </button>
          </div>

          {/* DOCUMENT STATS INFO BLOCK */}
          {extractionResult && (
            <div id="stats-card" className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-3 flex items-center gap-2">
                <Info className="w-4 h-4" />
                <span>Document Metrics</span>
              </h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-neutral-50 dark:bg-neutral-950 rounded-lg p-2.5 border border-neutral-100 dark:border-neutral-800">
                  <span className="block text-xl font-bold text-neutral-900 dark:text-neutral-100">{docStats.words.toLocaleString()}</span>
                  <span className="text-[10px] uppercase font-bold text-neutral-400 dark:text-neutral-500 tracking-wider">Words</span>
                </div>
                <div className="bg-neutral-50 dark:bg-neutral-950 rounded-lg p-2.5 border border-neutral-100 dark:border-neutral-800">
                  <span className="block text-xl font-bold text-neutral-900 dark:text-neutral-100">{docStats.chars.toLocaleString()}</span>
                  <span className="text-[10px] uppercase font-bold text-neutral-400 dark:text-neutral-500 tracking-wider">Characters</span>
                </div>
                <div className="bg-neutral-50 dark:bg-neutral-950 rounded-lg p-2.5 border border-neutral-100 dark:border-neutral-800">
                  <span className="block text-xl font-bold text-neutral-900 dark:text-neutral-100">{docStats.readingTime} min</span>
                  <span className="text-[10px] uppercase font-bold text-neutral-400 dark:text-neutral-500 tracking-wider">Reading Time</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: WORKSPACE & RENDERING (7 columns on lg) */}
        <div id="right-column" className="lg:col-span-7 flex flex-col w-full h-full lg:min-h-[640px]">
          {adminMode ? (
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden" id="admin-panel">
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 flex items-center gap-2">
                    <FolderOpen className="w-4 h-4" />
                    <span>Uploaded Files</span>
                  </h2>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Backup copies stored in the repository's /uploaded folder.</p>
                </div>
                <button
                  onClick={fetchAdminFiles}
                  disabled={adminLoading}
                  className="p-2 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40 transition-all shrink-0"
                  title="Refresh file list"
                >
                  <RefreshCw className={`w-4 h-4 ${adminLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {adminLoading ? (
                <div className="flex-1 flex items-center justify-center p-12 text-neutral-400 dark:text-neutral-500">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : adminError ? (
                <div className="p-6">
                  <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>{adminError}</span>
                  </div>
                </div>
              ) : adminFiles.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-neutral-400 dark:text-neutral-500">
                  <FolderOpen className="w-10 h-10 mb-3" />
                  <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">No files yet</p>
                  <p className="text-xs mt-1">Uploaded PDFs will appear here as backup copies.</p>
                </div>
              ) : (
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 overflow-auto flex-1">
                  {adminFiles.map((f) => (
                    <li key={f.path} className="flex items-center gap-3 px-5 py-3">
                      <div className="p-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg shrink-0">
                        <FileText className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate" title={f.name}>{f.name}</p>
                        <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{f.path}</p>
                      </div>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">{formatFileSize(f.size)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-400 dark:text-neutral-500">
                {adminFiles.length} file{adminFiles.length === 1 ? "" : "s"} in /uploaded
              </div>
            </div>
          ) : (
            <>

          {/* VIEW TAB HEADERS */}
          <div id="tab-headers-container" className="flex border-b border-neutral-200 dark:border-neutral-800 mb-4 bg-white dark:bg-neutral-900 rounded-lg p-1 border">
            <button
              onClick={() => setActiveTab("summary")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-semibold transition-all ${
                activeTab === "summary"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 hover:bg-neutral-50"
              }`}
              id="summary-tab-btn"
            >
              <Sparkles className="w-4 h-4" />
              <span>AI Summary</span>
            </button>
            <button
              onClick={() => setActiveTab("raw_text")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-semibold transition-all ${
                activeTab === "raw_text"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 hover:bg-neutral-50"
              }`}
              id="raw-text-tab-btn"
            >
              <FileText className="w-4 h-4" />
              <span>Extracted Raw Text</span>
            </button>
          </div>

          {/* ACTIVE CONTENT VIEW WINDOW */}
          <div ref={containerRef} id="active-content-viewport" className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm flex-1 flex flex-col overflow-hidden min-h-[480px]">
            
            {/* TAB CONTENT: AI SUMMARY */}
            {activeTab === "summary" && (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Actions Ribbon */}
                {summaryResult && (
                  <div className="border-b border-neutral-100 dark:border-neutral-800 px-6 py-3 bg-neutral-50 dark:bg-neutral-950 flex items-center justify-between gap-4 shrink-0">
                    <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Generated markdown summary
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyToClipboard(summaryResult, true)}
                        className="p-1.5 border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-100 text-neutral-600 dark:text-neutral-400 rounded-md transition-all text-xs flex items-center gap-1 font-semibold"
                        title="Copy markdown content"
                        id="copy-summary-btn"
                      >
                        {copiedSummary ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                            <span className="text-green-600 dark:text-green-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={downloadSummaryAsMarkdown}
                        className="p-1.5 border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-100 text-neutral-600 dark:text-neutral-400 rounded-md transition-all text-xs flex items-center gap-1 font-semibold"
                        title="Download as .md file"
                        id="download-summary-btn"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Body Area */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8">
                  {isSummarizing ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8">
                      <Loader2 className="w-8 h-8 animate-spin text-neutral-950 dark:text-neutral-50 mb-3" />
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">DeepSeek AI is summarizing your document...</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm">This may take a few seconds depending on document size.</p>
                      
                      {/* Pulse Shimmer Skeleton Effect */}
                      <div className="w-full max-w-md mt-8 space-y-3.5 animate-pulse">
                        <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded-full w-2/3" />
                        <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded-full w-full" />
                        <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded-full w-5/6" />
                        <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded-full w-full" />
                        <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded-full w-1/3 mt-6" />
                        <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded-full w-full" />
                        <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded-full w-4/5" />
                      </div>
                    </div>
                  ) : summarizationError ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-red-50/50">
                      <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center text-red-600 dark:text-red-400 mb-4">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <h3 className="font-bold text-red-800 dark:text-red-300 text-lg">AI Summarization Failed</h3>
                      <p className="text-sm text-red-600 dark:text-red-400 mt-1 max-w-md">{summarizationError}</p>
                      <button
                        onClick={handleSummarize}
                        className="mt-6 inline-flex items-center gap-2 bg-red-900 dark:bg-red-800 hover:bg-red-800 dark:hover:bg-red-700 text-white rounded-lg px-4 py-2 font-semibold text-xs shadow-sm transition-colors cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry Summary</span>
                      </button>
                    </div>
                  ) : summaryResult ? (
                    <div className="prose prose-neutral max-w-none prose-sm md:prose-base leading-relaxed" id="markdown-container">
                      <Markdown>{summaryResult}</Markdown>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-400 dark:text-neutral-500">
                      <div className="p-4 bg-neutral-50 dark:bg-neutral-950 text-neutral-400 dark:text-neutral-500 rounded-full border border-neutral-100 dark:border-neutral-800 mb-4">
                        <Sparkles className="w-8 h-8" />
                      </div>
                      <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 text-base mb-1">No summary generated yet</h3>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm">
                        {!extractionResult 
                          ? "Please upload a PDF document on the left panel first." 
                          : "Configure the AI parameters and click 'Generate AI Summary' to begin."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: EXTRACTED RAW TEXT */}
            {activeTab === "raw_text" && (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Search & Actions Ribbon */}
                {extractionResult && (
                  <div className="border-b border-neutral-100 dark:border-neutral-800 px-6 py-3 bg-neutral-50 dark:bg-neutral-950 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
                    {/* Search Field */}
                    <div className="relative flex-1 max-w-xs">
                      <Search className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search keywords..."
                        className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:border-neutral-900"
                        id="text-search-input"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2.5 top-2.5 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* View Controls & Copy Button */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 rounded-lg p-0.5" id="text-view-toggle">
                        <button
                          onClick={() => setRawTextMode("page")}
                          className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md transition-all ${
                            rawTextMode === "page"
                              ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-xs"
                              : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800"
                          }`}
                        >
                          Page Text
                        </button>
                        <button
                          onClick={() => setRawTextMode("layout")}
                          className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md transition-all flex items-center gap-1 ${
                            rawTextMode === "layout"
                              ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-xs"
                              : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800"
                          }`}
                        >
                          <LayoutGrid className="w-3 h-3" />
                          <span>Visual Layout</span>
                        </button>
                        <button
                          onClick={() => setRawTextMode("document")}
                          className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md transition-all flex items-center gap-1 ${
                            rawTextMode === "document"
                              ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-xs"
                              : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800"
                          }`}
                        >
                          <FileText className="w-3 h-3" />
                          <span>Actual Document</span>
                        </button>
                        <button
                          onClick={() => setRawTextMode("full")}
                          className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md transition-all ${
                            rawTextMode === "full"
                              ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-xs"
                              : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800"
                          }`}
                        >
                          Continuous
                        </button>
                      </div>

                      <button
                        onClick={() => copyToClipboard(extractionResult.text, false)}
                        className="p-1.5 border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-100 text-neutral-600 dark:text-neutral-400 rounded-md transition-all text-xs flex items-center gap-1 font-semibold"
                        title="Copy raw extracted text"
                        id="copy-raw-text-btn"
                      >
                        {copiedRawText ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                            <span className="text-green-600 dark:text-green-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy All</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Body Area */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 font-mono text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed bg-neutral-50/50">
                  {extractionResult ? (
                    rawTextMode === "page" ? (
                      <div className="flex flex-col h-full justify-between gap-6">
                        {/* Page Content Block */}
                        <div className="flex-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 shadow-sm overflow-y-auto min-h-[300px]" id="page-content-viewer">
                          <div className="flex justify-between items-center border-b border-neutral-100 dark:border-neutral-800 pb-3 mb-4">
                            <span className="text-[10px] uppercase font-bold text-neutral-400 dark:text-neutral-500 tracking-wider">
                              Page {currentPageIndex + 1} of {extractionResult.pagesCount}
                            </span>
                            {extractionResult.metadata && extractionResult.metadata.title && (
                              <span className="text-xs text-neutral-500 dark:text-neutral-400 max-w-[200px] truncate" title={extractionResult.metadata.title}>
                                {extractionResult.metadata.title}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap select-text break-words">
                            {extractionResult.pages[currentPageIndex]?.trim() 
                              ? highlightText(extractionResult.pages[currentPageIndex], searchQuery)
                              : <span className="text-neutral-400 dark:text-neutral-500 italic">This page does not contain extractable text characters.</span>
                            }
                          </p>
                        </div>

                        {/* Page Paging Controls */}
                        <div className="flex items-center justify-between mt-auto bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 shadow-sm shrink-0" id="paging-controls">
                          <button
                            onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                            disabled={currentPageIndex === 0}
                            className="p-1.5 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent transition-all flex items-center gap-1 text-xs font-semibold"
                          >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Previous</span>
                          </button>
                          
                          <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                            Page <span className="font-bold text-neutral-950 dark:text-neutral-50">{currentPageIndex + 1}</span> of <span className="font-bold text-neutral-950 dark:text-neutral-50">{extractionResult.pagesCount}</span>
                          </span>

                          <button
                            onClick={() => setCurrentPageIndex((prev) => Math.min(extractionResult.pagesCount - 1, prev + 1))}
                            disabled={currentPageIndex === extractionResult.pagesCount - 1}
                            className="p-1.5 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent transition-all flex items-center gap-1 text-xs font-semibold"
                          >
                            <span>Next</span>
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : rawTextMode === "layout" ? (
                      <div className="flex flex-col h-full justify-between gap-6">
                        {/* Legend of Document Layout */}
                        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex flex-wrap items-center gap-4 text-xs select-none">
                          <span className="font-semibold text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500" />
                            Visual Map Guide:
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 bg-neutral-900/10 dark:bg-white/10 border border-neutral-400 dark:border-neutral-600 rounded-sm" />
                            Text Blocks
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 bg-yellow-200 dark:bg-yellow-800 border border-yellow-400 dark:border-yellow-600 rounded-sm" />
                            Search Keyword Matches
                          </span>
                          <span className="text-neutral-400 dark:text-neutral-500 italic text-[10px] ml-auto">
                            Hover over elements to inspect text content
                          </span>
                        </div>

                        {/* Layout Preview Canvas Sheet */}
                        <div className="flex-1 bg-neutral-200/50 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 flex justify-center items-start overflow-auto min-h-[400px]">
                          {extractionResult.pageLayouts && extractionResult.pageLayouts[currentPageIndex] ? (
                            (() => {
                              const pageLayout = extractionResult.pageLayouts[currentPageIndex];
                              const widthToHeightRatio = pageLayout.width / pageLayout.height;
                              const renderWidth = Math.max(300, containerWidth - 48);
                              const renderHeight = renderWidth / widthToHeightRatio;
                              const scale = renderWidth / pageLayout.width;

                              return (
                                <div
                                  className="relative bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 shadow-md select-none rounded overflow-hidden"
                                  style={{
                                    width: `${renderWidth}px`,
                                    height: `${renderHeight}px`,
                                    backgroundImage: "radial-gradient(#e5e7eb 1px, transparent 1px)",
                                    backgroundSize: "16px 16px"
                                  }}
                                  id="layout-page-sheet"
                                >
                                  {pageLayout.items.map((item, idx) => {
                                    const left = item.x * scale;
                                    const top = item.y * scale;
                                    const width = item.width * scale;
                                    const height = item.height * scale;
                                    const fontSize = item.height * scale * 0.95;

                                    const isHighlighted = searchQuery && item.str.toLowerCase().includes(searchQuery.toLowerCase());

                                    return (
                                      <div
                                        key={idx}
                                        className={`absolute flex items-center overflow-hidden transition-all duration-100 rounded border border-transparent group/box ${
                                          isHighlighted
                                            ? "bg-yellow-200/80 border-yellow-400 dark:border-yellow-600 font-bold z-10"
                                            : "bg-neutral-900/5 dark:bg-white/5 hover:bg-neutral-950/10 dark:hover:bg-white/10 hover:border-neutral-900/30 dark:hover:border-white/30"
                                        }`}
                                        style={{
                                          left: `${left}px`,
                                          top: `${top}px`,
                                          width: `${Math.max(2, width)}px`,
                                          height: `${Math.max(2, height)}px`,
                                        }}
                                      >
                                        <span
                                          className="text-neutral-950 dark:text-neutral-50 leading-none select-text whitespace-nowrap overflow-hidden text-ellipsis font-sans tracking-tight"
                                          style={{ fontSize: `${Math.max(4, fontSize)}px` }}
                                        >
                                          {item.str}
                                        </span>
                                        {/* Pure CSS Hover Overlays */}
                                        <div className="absolute left-1/2 bottom-full mb-1 z-30 hidden group-hover/box:block bg-neutral-950 dark:bg-neutral-800 text-white text-[10px] px-2 py-1.5 rounded-lg shadow-xl max-w-[200px] -translate-x-1/2 whitespace-normal break-words leading-relaxed select-all">
                                          {item.str}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()
                          ) : (
                            <div className="text-center py-12 text-neutral-400 dark:text-neutral-500">
                              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                              <p className="text-xs">No visual map details exist for this page.</p>
                            </div>
                          )}
                        </div>

                        {/* Page Paging Controls */}
                        <div className="flex items-center justify-between bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 shadow-sm shrink-0" id="paging-controls">
                          <button
                            onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                            disabled={currentPageIndex === 0}
                            className="p-1.5 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent transition-all flex items-center gap-1 text-xs font-semibold"
                          >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Previous</span>
                          </button>
                          
                          <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                            Page <span className="font-bold text-neutral-950 dark:text-neutral-50">{currentPageIndex + 1}</span> of <span className="font-bold text-neutral-950 dark:text-neutral-50">{extractionResult.pagesCount}</span>
                          </span>

                          <button
                            onClick={() => setCurrentPageIndex((prev) => Math.min(extractionResult.pagesCount - 1, prev + 1))}
                            disabled={currentPageIndex === extractionResult.pagesCount - 1}
                            className="p-1.5 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent transition-all flex items-center gap-1 text-xs font-semibold"
                          >
                            <span>Next</span>
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : rawTextMode === "document" ? (
                      <div className="flex flex-col h-full justify-between gap-6">
                        {/* Focused traced-text readout */}
                        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 h-11 flex flex-nowrap items-center gap-3 text-xs select-none overflow-hidden shrink-0">
                          <span className="font-semibold text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5 shrink-0">
                            <Info className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500" />
                            Traced Text:
                          </span>
                          {selectedDocText ? (
                            <>
                              <span className="text-neutral-800 dark:text-neutral-200 font-medium truncate flex-1 min-w-0" title={selectedDocText}>
                                {selectedDocText}
                              </span>
                              <button
                                onClick={copyDocSelection}
                                className="shrink-0 px-2 py-1 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] font-semibold hover:opacity-90 transition-opacity"
                              >
                                {copiedDocSelection ? "Copied!" : "Copy"}
                              </button>
                              <button
                                onClick={clearDocSelection}
                                className="shrink-0 px-2 py-1 rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 text-[11px] font-semibold"
                              >
                                Clear
                              </button>
                            </>
                          ) : focusedDocItem !== null && extractionResult.pageLayouts && extractionResult.pageLayouts[currentPageIndex] && extractionResult.pageLayouts[currentPageIndex].items[focusedDocItem] ? (
                            <span className="text-neutral-800 dark:text-neutral-200 font-medium truncate">
                              {extractionResult.pageLayouts[currentPageIndex].items[focusedDocItem].str}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex-1 bg-neutral-200/50 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 flex justify-center items-start overflow-auto min-h-[400px]">
                          {extractionResult.pageLayouts && extractionResult.pageLayouts[currentPageIndex] ? (
                            (() => {
                              const pageLayout = extractionResult.pageLayouts[currentPageIndex];
                              const widthToHeightRatio = pageLayout.width / pageLayout.height;
                              const renderWidth = Math.max(300, containerWidth - 48);
                              const renderHeight = renderWidth / widthToHeightRatio;
                              const scale = renderWidth / pageLayout.width;

                              return (
                                <div
                                  className="relative bg-white dark:bg-neutral-800 shadow-md select-none rounded overflow-hidden shrink-0"
                                  style={{ width: `${renderWidth}px`, height: `${renderHeight}px` }}
                                  id="actual-document-sheet"
                                >
                                  <canvas
                                    ref={docCanvasRef}
                                    style={{ width: `${renderWidth}px`, height: `${renderHeight}px` }}
                                    className="block"
                                  />
                                  {docRendering && (
                                    <div className="absolute inset-0 bg-white/70 dark:bg-neutral-900/70 flex items-center justify-center">
                                      <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
                                    </div>
                                  )}
                                  {pageLayout.items.map((item, idx) => {
                                    const isFocused = focusedDocItem === idx;
                                    const isSelected = docSelLo !== null && docSelHi !== null && idx >= docSelLo && idx <= docSelHi;
                                    return (
                                      <div
                                        key={idx}
                                        onMouseEnter={() => setFocusedDocItem(idx)}
                                        onMouseLeave={() => setFocusedDocItem(null)}
                                        onDoubleClick={() => handleDocItemDoubleClick(idx)}
                                        className={`absolute cursor-pointer transition-colors duration-75 ${
                                          isSelected
                                            ? "bg-blue-500/35 border border-blue-600 z-10"
                                            : isFocused
                                              ? "bg-amber-300/50 border border-amber-500 z-10"
                                              : "bg-sky-400/10 border border-sky-500/30 hover:bg-sky-300/30"
                                        }`}
                                        style={{
                                          left: `${item.x * scale}px`,
                                          top: `${item.y * scale}px`,
                                          width: `${Math.max(item.width * scale, 4)}px`,
                                          height: `${Math.max(item.height * scale, 6)}px`
                                        }}
                                        title={item.str}
                                      />
                                    );
                                  })}
                                </div>
                              );
                            })()
                          ) : (
                            <div className="text-center py-12 text-neutral-400 dark:text-neutral-500">
                              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                              <p className="text-xs">No traced text available for this page.</p>
                            </div>
                          )}
                        </div>

                        {/* Page Paging Controls */}
                        <div className="flex items-center justify-between bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 shadow-sm shrink-0" id="paging-controls">
                          <button
                            onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                            disabled={currentPageIndex === 0}
                            className="p-1.5 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent transition-all flex items-center gap-1 text-xs font-semibold"
                          >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Previous</span>
                          </button>

                          <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                            Page <span className="font-bold text-neutral-950 dark:text-neutral-50">{currentPageIndex + 1}</span> of <span className="font-bold text-neutral-950 dark:text-neutral-50">{extractionResult.pagesCount}</span>
                          </span>

                          <button
                            onClick={() => setCurrentPageIndex((prev) => Math.min(extractionResult.pagesCount - 1, prev + 1))}
                            disabled={currentPageIndex === extractionResult.pagesCount - 1}
                            className="p-1.5 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent transition-all flex items-center gap-1 text-xs font-semibold"
                          >
                            <span>Next</span>
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 shadow-sm whitespace-pre-wrap break-words select-text" id="continuous-text-viewer">
                        {highlightText(extractionResult.text, searchQuery)}
                      </div>
                    )
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-400 dark:text-neutral-500">
                      <div className="p-4 bg-neutral-50 dark:bg-neutral-950 text-neutral-400 dark:text-neutral-500 rounded-full border border-neutral-100 dark:border-neutral-800 mb-4">
                        <FileText className="w-8 h-8" />
                      </div>
                      <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 text-base mb-1">No document parsed yet</h3>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm">
                        Please upload a PDF file on the left panel to trigger automatic text extraction.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </main>

      {/* FOOTER */}
      <footer id="app-footer" className="bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 py-6 px-6 md:px-12 mt-12 shrink-0 text-center sm:text-left">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-neutral-400 dark:text-neutral-500">
          <p>© 2026 PDF Extractor & Summarizer App. Powered by DeepSeek API via APMix.</p>
          <div className="flex gap-4">
            <span className="hover:text-neutral-600 cursor-help" title="Converts pages locally using HTML5 Canvas text rendering contexts">Client-Side Parser</span>
            <span>•</span>
            <span className="hover:text-neutral-600 cursor-help" title="Safely proxies requests through server.ts to secure the API key">Server-Side AI Proxy</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
