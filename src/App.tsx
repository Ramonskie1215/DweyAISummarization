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
  FolderOpen,
  User,
  KeyRound,
  Users,
  History
} from "lucide-react";
import Markdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import { extractTextFromPDF, PDFPageLayout, PDFParseResult } from "./utils/pdfParser";

const FIXED_SUMMARY_SETTINGS = {
  length: "Detailed",
  style: "Professional Academic Summary",
  language: "en",
  format: "page-ranges",
} as const;


type RoomFileItem = { name: string; size: number; path: string; uploadedAt?: string | null };

type SummaryRangeEntry = {
  start: number;
  end: number;
  title: string;
  markdown: string;
};

function matchSummaryRangeStart(line: string): { start: number; end: number; title: string; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const isHeading = /^#{1,6}\s+/.test(trimmed);
  const isListItem = /^[-*]\s+/.test(trimmed);
  const isBoldLabel = /^\*\*/.test(trimmed);
  if (!isHeading && !isListItem && !isBoldLabel && trimmed.length > 160) return null;

  const clean = trimmed
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .trim();

  const rangeMatch = clean.match(/pages?\s+(\d+)\s*(?:-|–|—|to)\s*(\d+)/i);
  const singleMatch = !rangeMatch ? clean.match(/page\s+(\d+)\b/i) : null;
  if (!rangeMatch && !singleMatch) return null;
  if (!isHeading && !isListItem && !isBoldLabel && !/:\s|—|–|\s-\s/.test(clean)) return null;

  const start = Number((rangeMatch || singleMatch)![1]);
  const end = rangeMatch ? Number(rangeMatch[2]) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return null;

  const colonIndex = clean.indexOf(":");
  const title = (!isHeading && colonIndex > -1 ? clean.slice(0, colonIndex) : clean).trim();
  const rest = !isHeading && colonIndex > -1 ? clean.slice(colonIndex + 1).trim() : "";
  return { start, end, title: title || `Pages ${start}-${end}`, rest };
}

function parseSummaryRangeEntries(summary: string): SummaryRangeEntry[] {
  const lines = String(summary || "").split(/\r?\n/);
  const sectionLines: string[] = [];
  let inBreakdown = false;
  let breakdownLevel = 2;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2] || "";
      if (/page\s+range\s+breakdown/i.test(text)) {
        inBreakdown = true;
        breakdownLevel = level;
        continue;
      }
      if (inBreakdown && level <= breakdownLevel) break;
    }
    if (inBreakdown) sectionLines.push(line);
  }

  const workingLines = sectionLines.length ? sectionLines : lines;
  const entries: Array<{ start: number; end: number; title: string; bodyLines: string[] }> = [];
  let current: { start: number; end: number; title: string; bodyLines: string[] } | null = null;

  for (const line of workingLines) {
    const startMatch = matchSummaryRangeStart(line);
    if (startMatch) {
      if (current) entries.push(current);
      current = {
        start: startMatch.start,
        end: startMatch.end,
        title: startMatch.title,
        bodyLines: startMatch.rest ? [startMatch.rest] : [],
      };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) entries.push(current);

  return entries
    .map((entry) => {
      const body = entry.bodyLines.join("\n").trim();
      return {
        start: entry.start,
        end: entry.end,
        title: entry.title,
        markdown: `### ${entry.title}${body ? `\n\n${body}` : ""}`,
      };
    })
    .sort((a, b) => a.start - b.start);
}

type SummaryViewProps = {
  summary: string;
  pagesCount?: number | null;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  contentId?: string;
  compact?: boolean;
};

function SummaryView({ summary, pagesCount, currentPage, onPageChange, contentId, compact }: SummaryViewProps) {
  const [mode, setMode] = useState<"full" | "per-page">("full");
  const [internalPage, setInternalPage] = useState(1);

  useEffect(() => {
    setMode("full");
    setInternalPage(1);
  }, [summary]);

  const entries = parseSummaryRangeEntries(summary);
  const maxEntryPage = entries.reduce((max, entry) => Math.max(max, entry.end), 0);
  const totalPages = Math.max(1, pagesCount || maxEntryPage || 1);
  const rawPage = onPageChange ? (currentPage || 1) : internalPage;
  const page = Math.min(Math.max(1, rawPage), totalPages);
  const setPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), totalPages);
    if (onPageChange) onPageChange(clamped);
    else setInternalPage(clamped);
  };
  const activeEntry = entries.find((entry) => page >= entry.start && page <= entry.end) || null;
  const proseClass = compact
    ? "prose prose-neutral prose-sm max-w-none"
    : "prose prose-neutral max-w-none prose-sm md:prose-base leading-relaxed";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded-full p-1 border border-neutral-200 dark:border-neutral-700" role="group" aria-label="Summary view mode">
          {(["Full", "Per Page"] as const).map((label) => {
            const value = label === "Full" ? "full" : "per-page";
            const active = mode === value;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setMode(value)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                    : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
                id={`${contentId || "summary"}-${value}-btn`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {mode === "per-page" && (
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1} className="p-1.5 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40 flex items-center gap-1 font-semibold" id={`${contentId || "summary"}-prev-page-btn`}>
              <ChevronLeft className="w-4 h-4" />
              <span>Prev</span>
            </button>
            <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">Page <b>{page}</b> of <b>{totalPages}</b></span>
            <button type="button" onClick={() => setPage(page + 1)} disabled={page >= totalPages} className="p-1.5 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40 flex items-center gap-1 font-semibold" id={`${contentId || "summary"}-next-page-btn`}>
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {mode === "per-page" && activeEntry && activeEntry.end > activeEntry.start && (
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-3">Showing the shared summary for Pages {activeEntry.start}-{activeEntry.end}.</p>
      )}

      <div className={proseClass} id={contentId}>
        {mode === "full" ? (
          <Markdown>{summary}</Markdown>
        ) : activeEntry ? (
          <Markdown>{activeEntry.markdown}</Markdown>
        ) : entries.length ? (
          <p>No page-range summary was found for Page {page}. Try another page or switch back to Full.</p>
        ) : (
          <p>No page-range breakdown was found in this summary yet, so Per Page cannot split it. The Full summary is still available above.</p>
        )}
      </div>
    </div>
  );
}


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
  const [appView, setAppView] = useState<"files" | "upload">("files");
  const [profileRole, setProfileRole] = useState<"Admin" | "Guest">(() => {
    const saved = localStorage.getItem("dwey-profile");
    return saved === "Guest" || saved === "Admin" ? saved : "Admin";
  });
  const [roomCode, setRoomCode] = useState("");
  const [isRoomCodeModalOpen, setIsRoomCodeModalOpen] = useState(false);
  const [selectedRoomFilePaths, setSelectedRoomFilePaths] = useState<string[]>([]);
  const [isSelectingRoomFiles, setIsSelectingRoomFiles] = useState(false);
  const [isHostingRoom, setIsHostingRoom] = useState(false);
  const [hostRoomError, setHostRoomError] = useState<string | null>(null);
  const [hostedRoom, setHostedRoom] = useState<{ code: string; createdAt?: string | null; startedAt?: string | null; endedAt?: string | null; files: Array<{ name: string; size: number; path: string; uploadedAt?: string | null }> } | null>(null);
  const [copiedRoomCode, setCopiedRoomCode] = useState(false);
  const [isRoomHistoryOpen, setIsRoomHistoryOpen] = useState(false);
  const [roomHistory, setRoomHistory] = useState<Array<{ code: string; createdAt?: string | null; startedAt?: string | null; endedAt?: string | null; files: Array<{ name: string; size: number; path: string; uploadedAt?: string | null }> }>>([]);
  const [roomHistoryLoading, setRoomHistoryLoading] = useState(false);
  const [roomHistoryError, setRoomHistoryError] = useState<string | null>(null);
  const [endingRoomCode, setEndingRoomCode] = useState<string | null>(null);
  const [guestRoom, setGuestRoom] = useState<{ code: string; createdAt?: string | null; startedAt?: string | null; endedAt?: string | null; files: Array<{ name: string; size: number; path: string; uploadedAt?: string | null }> } | null>(null);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [joinRoomError, setJoinRoomError] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSavingCompanion, setIsSavingCompanion] = useState(false);
  const [companionSaved, setCompanionSaved] = useState(false);
  const [isSavingTraces, setIsSavingTraces] = useState(false);
  const [traceBoxesSaved, setTraceBoxesSaved] = useState(false);
  const [showUploadSummary, setShowUploadSummary] = useState(false);
  const [uploadAutoError, setUploadAutoError] = useState<string | null>(null);
  const [selectedGuestFile, setSelectedGuestFile] = useState<RoomFileItem | null>(null);
  const [guestSummary, setGuestSummary] = useState<string | null>(null);
  const [guestSummaryError, setGuestSummaryError] = useState<string | null>(null);
  const [guestPdfFile, setGuestPdfFile] = useState<File | null>(null);
  const [guestDocResult, setGuestDocResult] = useState<PDFParseResult | null>(null);
  const [guestDocLoading, setGuestDocLoading] = useState(false);
  const [guestDocError, setGuestDocError] = useState<string | null>(null);
  const [guestPageIndex, setGuestPageIndex] = useState(0);
  const [guestDocRendering, setGuestDocRendering] = useState(false);
  const [guestFocusedItem, setGuestFocusedItem] = useState<number | null>(null);
  const [adminFiles, setAdminFiles] = useState<Array<{ name: string; size: number; path: string; uploadedAt?: string | null }>>([]);
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
  const uploadModalInputRef = useRef<HTMLInputElement>(null);
  const currentUploadFolderRef = useRef<string>("");
  const guestCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const guestPdfCacheRef = useRef<{ file: File; pdf: any } | null>(null);
  const guestDocWrapRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    localStorage.setItem("dwey-profile", profileRole);
    setIsRoomCodeModalOpen(false);
  }, [profileRole]);

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

  const getUploadDateFolder = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = (t: string) => parts.find((x) => x.type === t)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };

  // Sends a copy of the uploaded PDF to the repo's uploaded/<date>/ folder (fire-and-forget, best-effort)
  const backupUploadToRepo = (fileToBackup: File, dateFolder: string) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        if (!base64) return;
        fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: fileToBackup.name, content: base64, dateFolder }),
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
    const uploadFolder = getUploadDateFolder();
    currentUploadFolderRef.current = uploadFolder;
    backupUploadToRepo(selectedFile, uploadFolder);
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
      return result;
    } catch (err: any) {
      console.error(err);
      setExtractionError(err.message || "An error occurred while parsing the PDF.");
      return null;
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

  const formatUploadedDateTime = (value?: string | null) => {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  };

  const groupFilesByDay = (files: Array<{ name: string; size: number; path: string; uploadedAt?: string | null }>) => {
    const groups = new Map<string, { key: string; label: string; sortTime: number; files: Array<{ name: string; size: number; path: string; uploadedAt?: string | null }> }>();
    for (const f of files) {
      const date = f.uploadedAt ? new Date(f.uploadedAt) : null;
      const valid = date && !Number.isNaN(date.getTime());
      const key = valid
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : "unknown";
      const label = valid
        ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date)
        : "Date unavailable";
      const sortTime = valid ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() : 0;
      const existing = groups.get(key);
      if (existing) existing.files.push(f);
      else groups.set(key, { key, label, sortTime, files: [f] });
    }
    return Array.from(groups.values())
      .sort((a, b) => {
        if (a.key === "unknown") return 1;
        if (b.key === "unknown") return -1;
        return b.sortTime - a.sortTime;
      })
      .map((g) => ({ ...g, files: [...g.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })) }));
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
    if (appView === "files") {
      fetchAdminFiles();
    }
  }, [appView]);

  const toggleRoomFileSelection = (path: string) => {
    setSelectedRoomFilePaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  };

  const startHostingRoom = () => {
    setHostedRoom(null);
    setHostRoomError(null);
    setCopiedRoomCode(false);
    setIsSelectingRoomFiles(true);
  };

  const cancelHostingRoom = () => {
    setIsSelectingRoomFiles(false);
    setSelectedRoomFilePaths([]);
    setHostRoomError(null);
  };

  const createHostedRoom = async () => {
    const files = adminFiles.filter((f) => selectedRoomFilePaths.includes(f.path));
    if (files.length === 0) {
      setHostRoomError("Select at least one file for the room.");
      return;
    }
    setIsHostingRoom(true);
    setHostRoomError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Server responded with status ${res.status}`);
      setHostedRoom({ code: String(data.code), createdAt: data.createdAt || data.startedAt || null, startedAt: data.startedAt || data.createdAt || null, endedAt: data.endedAt || null, files: Array.isArray(data.files) ? data.files : files });
      setIsSelectingRoomFiles(false);
      setSelectedRoomFilePaths([]);
      fetchRoomHistory().catch(() => {});
    } catch (err: any) {
      console.error("Failed to host room:", err);
      setHostRoomError(err.message || "Could not create the room.");
    } finally {
      setIsHostingRoom(false);
    }
  };

  const copyHostedRoomCode = async () => {
    if (!hostedRoom?.code) return;
    try {
      await navigator.clipboard.writeText(hostedRoom.code);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = hostedRoom.code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (__) {}
      document.body.removeChild(ta);
    }
    setCopiedRoomCode(true);
    setTimeout(() => setCopiedRoomCode(false), 2000);
  };

  const fetchRoomHistory = async () => {
    setRoomHistoryLoading(true);
    setRoomHistoryError(null);
    try {
      const res = await fetch("/api/rooms");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Server responded with status ${res.status}`);
      setRoomHistory(Array.isArray(data.rooms) ? data.rooms : []);
    } catch (err: any) {
      console.error("Failed to load room history:", err);
      setRoomHistoryError(err.message || "Could not load room history.");
    } finally {
      setRoomHistoryLoading(false);
    }
  };

  const openRoomHistory = () => {
    setIsRoomHistoryOpen(true);
    fetchRoomHistory();
  };

  const endHostedRoom = async (code: string) => {
    setEndingRoomCode(code);
    setRoomHistoryError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Server responded with status ${res.status}`);
      const ended = { code: String(data.code || code), createdAt: data.createdAt || null, startedAt: data.startedAt || data.createdAt || null, endedAt: data.endedAt || new Date().toISOString(), files: Array.isArray(data.files) ? data.files : [] };
      setRoomHistory((prev) => prev.map((r) => (r.code === ended.code ? { ...r, ...ended, files: ended.files.length ? ended.files : r.files } : r)));
      setHostedRoom((prev) => (prev && prev.code === ended.code ? { ...prev, endedAt: ended.endedAt } : prev));
      if (!isRoomHistoryOpen) fetchRoomHistory().catch(() => {});
    } catch (err: any) {
      console.error("Failed to end room:", err);
      setRoomHistoryError(err.message || "Could not end that room.");
      if (!isRoomHistoryOpen) setHostRoomError(err.message || "Could not end that room.");
    } finally {
      setEndingRoomCode(null);
    }
  };

  const joinGuestRoom = async () => {
    const code = roomCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setJoinRoomError("Enter a valid 6-digit room code.");
      return;
    }
    setIsJoiningRoom(true);
    setJoinRoomError(null);
    try {
      const res = await fetch(`/api/rooms?code=${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Server responded with status ${res.status}`);
      setGuestRoom({ code: String(data.code || code), createdAt: data.createdAt || data.startedAt || null, startedAt: data.startedAt || data.createdAt || null, endedAt: data.endedAt || null, files: Array.isArray(data.files) ? data.files : [] });
      setIsRoomCodeModalOpen(false);
    } catch (err: any) {
      console.error("Failed to join room:", err);
      setGuestRoom(null);
      setJoinRoomError(err.message || "Could not open that room.");
    } finally {
      setIsJoiningRoom(false);
    }
  };

  const leaveGuestRoom = () => {
    setGuestRoom(null);
    setSelectedGuestFile(null);
    setGuestSummary(null);
    setGuestPdfFile(null);
    setGuestDocResult(null);
    setRoomCode("");
    setJoinRoomError(null);
    setIsRoomCodeModalOpen(false);
  };


  const getUploadedRepoPath = (fileName: string) => {
    const baseName = String(fileName).split(/[\\/]/).pop() || "upload.pdf";
    const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.pdf";
    const folder = currentUploadFolderRef.current || getUploadDateFolder();
    return `uploaded/${folder}/${safeName}`;
  };


  const normalizeSavedPageLayouts = (data: any): PDFPageLayout[] => {
    const source = Array.isArray(data?.pageLayouts) ? data.pageLayouts : Array.isArray(data?.pages) ? data.pages : [];
    return source
      .map((page: any) => {
        const items = Array.isArray(page?.items) ? page.items : [];
        return {
          width: Number(page?.width) || 0,
          height: Number(page?.height) || 0,
          items: items
            .map((item: any) => {
              if (Array.isArray(item)) {
                return {
                  str: String(item[0] || ""),
                  x: Number(item[1]) || 0,
                  y: Number(item[2]) || 0,
                  width: Number(item[3]) || 0,
                  height: Number(item[4]) || 0,
                };
              }
              return {
                str: String(item?.str || ""),
                x: Number(item?.x) || 0,
                y: Number(item?.y) || 0,
                width: Number(item?.width) || 0,
                height: Number(item?.height) || 0,
              };
            })
            .filter((item: any) => String(item.str || "").trim() !== ""),
        } as PDFPageLayout;
      })
      .filter((page: PDFPageLayout) => page.width > 0 && page.height > 0);
  };

  const buildResultFromSavedTraces = (data: any): PDFParseResult | null => {
    const pageLayouts = normalizeSavedPageLayouts(data);
    if (!pageLayouts.length) return null;
    const pagesCount = typeof data?.pagesCount === "number" && data.pagesCount > 0 ? data.pagesCount : pageLayouts.length;
    const pages = pageLayouts.map((page) => page.items.map((item) => item.str).join(" "));
    while (pages.length < pagesCount) pages.push("");
    return {
      text: pages.join("\n\n"),
      pagesCount,
      pages: pages.slice(0, pagesCount),
      pageLayouts,
    };
  };

  const generateFixedSummary = async (result: PDFParseResult) => {
    setIsSummarizing(true);
    setSummarizationError(null);
    try {
      const pagedText = result.pages.map((pageText, idx) => `[Page ${idx + 1}]\n${pageText || ""}`).join("\n\n");
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: pagedText,
          length: FIXED_SUMMARY_SETTINGS.length,
          style: FIXED_SUMMARY_SETTINGS.style,
          language: FIXED_SUMMARY_SETTINGS.language,
          format: FIXED_SUMMARY_SETTINGS.format,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `Server responded with status ${response.status}`;
        try {
          const errData = JSON.parse(errorText);
          if (errData && errData.error) errorMsg = errData.error;
        } catch (_) {}
        throw new Error(errorMsg);
      }
      const data = await response.json();
      if (!data.summary) throw new Error("No summary was returned.");
      setSummaryResult(data.summary);
      return String(data.summary);
    } catch (err: any) {
      console.error("Fixed summarization failure:", err);
      setSummarizationError(err.message || "Failed to generate AI summary.");
      throw err;
    } finally {
      setIsSummarizing(false);
    }
  };

  const saveCompanionSummary = async (selectedFile: File, result: PDFParseResult, summary: string) => {
    setIsSavingCompanion(true);
    setCompanionSaved(false);
    try {
      const filePath = getUploadedRepoPath(selectedFile.name);
      const res = await fetch("/api/companion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath,
          fileName: filePath.split("/").pop() || selectedFile.name,
          fileSize: selectedFile.size,
          pagesCount: result.pagesCount,
          summary,
          settings: FIXED_SUMMARY_SETTINGS,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Server responded with status ${res.status}`);
      setCompanionSaved(true);
      return data;
    } finally {
      setIsSavingCompanion(false);
    }
  };

  const saveTraceBoxes = async (selectedFile: File, result: PDFParseResult) => {
    setIsSavingTraces(true);
    setTraceBoxesSaved(false);
    try {
      if (!result.pageLayouts || result.pageLayouts.length === 0) {
        throw new Error("No trace boxes were captured for this file.");
      }
      const filePath = getUploadedRepoPath(selectedFile.name);
      const res = await fetch("/api/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath,
          fileName: filePath.split("/").pop() || selectedFile.name,
          fileSize: selectedFile.size,
          pagesCount: result.pagesCount,
          pageLayouts: result.pageLayouts,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Server responded with status ${res.status}`);
      setTraceBoxesSaved(true);
      return data;
    } finally {
      setIsSavingTraces(false);
    }
  };

  const saveUploadCompanions = async (selectedFile: File, result: PDFParseResult, summary: string) => {
    // Save one after the other: both write commits to the same repo branch,
    // and parallel GitHub commits can collide (HTTP 409).
    let firstError: any = null;
    try {
      await saveCompanionSummary(selectedFile, result, summary);
    } catch (err) {
      firstError = err;
    }
    try {
      await saveTraceBoxes(selectedFile, result);
    } catch (err) {
      if (!firstError) firstError = err;
    }
    if (firstError) throw firstError;
  };

  const runUploadAutoProcess = async (selectedFile: File) => {
    setUploadAutoError(null);
    setCompanionSaved(false);
    setTraceBoxesSaved(false);
    setShowUploadSummary(false);
    setSummaryResult(null);
    const result = await processFile(selectedFile);
    if (!result) return;
    try {
      const summary = await generateFixedSummary(result);
      await saveUploadCompanions(selectedFile, result, summary);
      fetchAdminFiles().catch(() => {});
    } catch (err: any) {
      setUploadAutoError(err.message || "Could not finish processing this file.");
    }
  };

  const retryUploadAutoSummary = async () => {
    if (!file || !extractionResult) return;
    setUploadAutoError(null);
    try {
      const summary = summaryResult || (await generateFixedSummary(extractionResult));
      await saveUploadCompanions(file, extractionResult, summary);
      fetchAdminFiles().catch(() => {});
    } catch (err: any) {
      setUploadAutoError(err.message || "Could not finish processing this file.");
    }
  };

  const openUploadModal = () => {
    resetAll();
    setUploadAutoError(null);
    setCompanionSaved(false);
    setTraceBoxesSaved(false);
    setShowUploadSummary(false);
    setIsUploadModalOpen(true);
  };

  const closeUploadModal = () => {
    if (isExtracting || isSummarizing || isSavingCompanion || isSavingTraces) return;
    setIsUploadModalOpen(false);
    fetchAdminFiles().catch(() => {});
  };

  const handleUploadModalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) await runUploadAutoProcess(files[0]);
    e.target.value = "";
  };

  const handleUploadModalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      if (selectedFile.type === "application/pdf" || selectedFile.name.endsWith(".pdf")) {
        await runUploadAutoProcess(selectedFile);
      } else {
        setExtractionError("Please select a valid PDF file.");
      }
    }
  };


  const closeGuestDocument = () => {
    setSelectedGuestFile(null);
    setGuestSummary(null);
    setGuestSummaryError(null);
    setGuestPdfFile(null);
    setGuestDocResult(null);
    setGuestDocError(null);
    setGuestPageIndex(0);
    setGuestFocusedItem(null);
  };

  const openGuestDocument = async (roomFile: RoomFileItem) => {
    setSelectedGuestFile(roomFile);
    setGuestPageIndex(0);
    setGuestSummary(null);
    setGuestSummaryError(null);
    setGuestDocResult(null);
    setGuestPdfFile(null);
    setGuestDocError(null);
    setGuestDocLoading(true);
    try {
      // Saved AI summary (companion file) — no need to call AI again.
      try {
        const summaryRes = await fetch(`/api/companion?path=${encodeURIComponent(roomFile.path)}`);
        const summaryData = await summaryRes.json().catch(() => ({}));
        if (summaryRes.ok && summaryData.summary) setGuestSummary(String(summaryData.summary));
        else setGuestSummaryError(summaryData?.error || "No AI summary saved for this file yet.");
      } catch (_) {
        setGuestSummaryError("No AI summary saved for this file yet.");
      }

      // Saved trace boxes — reuse them so Guests do not need to extract text again just for the boxes.
      let savedTraceResult: PDFParseResult | null = null;
      try {
        const traceRes = await fetch(`/api/traces?path=${encodeURIComponent(roomFile.path)}`);
        const traceData = await traceRes.json().catch(() => ({}));
        if (traceRes.ok) savedTraceResult = buildResultFromSavedTraces(traceData);
      } catch (_) {
        savedTraceResult = null;
      }

      const rawUrl = `https://raw.githubusercontent.com/Ramonskie1215/DweyAISummarization/main/${roomFile.path.split("/").map(encodeURIComponent).join("/")}`;
      const pdfRes = await fetch(rawUrl);
      if (!pdfRes.ok) throw new Error(`Could not load the document file (status ${pdfRes.status}).`);
      const blob = await pdfRes.blob();
      const pdfFile = new File([blob], roomFile.name, { type: "application/pdf" });
      setGuestPdfFile(pdfFile);
      // Older files without saved traces still fall back to extraction once.
      const result = savedTraceResult || (await extractTextFromPDF(pdfFile));
      setGuestDocResult(result);
    } catch (err: any) {
      console.error("Failed to open guest document:", err);
      setGuestDocError(err.message || "Could not open this document.");
    } finally {
      setGuestDocLoading(false);
    }
  };

  const getGuestPdfDocument = async () => {
    if (!guestPdfFile) throw new Error("No document loaded");
    if (guestPdfCacheRef.current && guestPdfCacheRef.current.file === guestPdfFile) {
      return guestPdfCacheRef.current.pdf;
    }
    const pdfjsLib = (window as any).pdfjsLib;
    if (!pdfjsLib) throw new Error("PDF.js library is not yet loaded.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
    const buffer = await guestPdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    if (guestPdfCacheRef.current) {
      try { guestPdfCacheRef.current.pdf.destroy(); } catch (_) {}
    }
    guestPdfCacheRef.current = { file: guestPdfFile, pdf };
    return pdf;
  };

  useEffect(() => {
    if (!selectedGuestFile || !guestPdfFile || !guestDocResult) return;
    let cancelled = false;
    setGuestDocRendering(true);
    setGuestFocusedItem(null);
    (async () => {
      try {
        const pdf = await getGuestPdfDocument();
        const page = await pdf.getPage(guestPageIndex + 1);
        const canvas = guestCanvasRef.current;
        if (!canvas || cancelled) return;
        const wrapWidth = guestDocWrapRef.current?.clientWidth || 720;
        const renderWidth = Math.max(300, wrapWidth - 32);
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
        if (!cancelled) setGuestDocRendering(false);
      } catch (err) {
        console.warn("Could not render guest document page:", err);
        if (!cancelled) setGuestDocRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedGuestFile, guestPdfFile, guestDocResult, guestPageIndex]);

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
            <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100" id="header-title">EcoLegis</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400" id="header-subtitle">Legislative Document Management & AI Summary System</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {profileRole === "Admin" && appView === "upload" && (
            <button
              onClick={() => setAppView("files")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
              id="back-to-files-btn"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Uploaded Files</span>
            </button>
          )}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div id="profile-switcher" className="flex items-center gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-full border border-neutral-200 dark:border-neutral-800">
            <span className="hidden sm:flex items-center gap-1.5 pl-2 pr-1 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              <User className="w-3.5 h-3.5" />
              <span>Profile</span>
            </span>
            <div className="flex items-center bg-white dark:bg-neutral-900 rounded-full border border-neutral-200 dark:border-neutral-700 p-0.5">
              {(["Admin", "Guest"] as const).map((role) => (
                <button
                  key={role}
                  onClick={() => setProfileRole(role)}
                  aria-pressed={profileRole === role}
                  id={role === "Admin" ? "profile-admin-btn" : "profile-guest-btn"}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    profileRole === role
                      ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                      : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      {profileRole === "Guest" ? (
        <>
          {selectedGuestFile ? (
            <main id="guest-document-main" className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <button type="button" onClick={closeGuestDocument} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all" id="back-to-guest-room-btn">
                  <ChevronLeft className="w-4 h-4" />
                  <span>Back to Room Files</span>
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate" title={selectedGuestFile.name}>{selectedGuestFile.name}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Room {guestRoom?.code} · {formatUploadedDateTime(selectedGuestFile.uploadedAt)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start flex-1">
                <section className="lg:col-span-7 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm overflow-hidden" id="guest-actual-document-panel">
                  <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      <span>Actual Document</span>
                    </h2>
                    {guestDocResult && <span className="text-xs text-neutral-500">Page {guestPageIndex + 1} of {guestDocResult.pagesCount}</span>}
                  </div>
                  <div ref={guestDocWrapRef} className="p-4 bg-neutral-100 dark:bg-neutral-950">
                    {guestDocLoading ? (
                      <div className="py-16 flex flex-col items-center justify-center text-neutral-400">
                        <Loader2 className="w-7 h-7 animate-spin mb-3" />
                        <p className="text-xs">Loading document…</p>
                      </div>
                    ) : guestDocError ? (
                      <div className="py-12 flex flex-col items-center justify-center text-center text-red-600 dark:text-red-400">
                        <AlertCircle className="w-7 h-7 mb-2" />
                        <p className="text-sm font-semibold">Could not open this document</p>
                        <p className="text-xs mt-1 max-w-sm">{guestDocError}</p>
                      </div>
                    ) : guestDocResult && guestDocResult.pageLayouts && guestDocResult.pageLayouts[guestPageIndex] ? (
                      (() => {
                        const pageLayout = guestDocResult.pageLayouts[guestPageIndex];
                        const wrapW = guestDocWrapRef.current?.clientWidth || 720;
                        const renderWidth = Math.max(300, wrapW - 32);
                        const renderHeight = renderWidth / (pageLayout.width / pageLayout.height);
                        const scale = renderWidth / pageLayout.width;
                        return (
                          <div className="relative bg-white shadow-md rounded overflow-hidden mx-auto" style={{ width: `${renderWidth}px`, height: `${renderHeight}px` }} id="guest-actual-document-sheet">
                            <canvas ref={guestCanvasRef} style={{ width: `${renderWidth}px`, height: `${renderHeight}px` }} className="block" />
                            {guestDocRendering && (
                              <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-neutral-500" /></div>
                            )}
                            {pageLayout.items.map((item, idx) => (
                              <div key={idx} onMouseEnter={() => setGuestFocusedItem(idx)} onMouseLeave={() => setGuestFocusedItem(null)} title={item.str} className={`absolute cursor-pointer transition-colors ${guestFocusedItem === idx ? "bg-amber-300/50 border border-amber-500 z-10" : "bg-sky-400/10 border border-sky-500/30 hover:bg-sky-300/30"}`} style={{ left: `${item.x * scale}px`, top: `${item.y * scale}px`, width: `${Math.max(item.width * scale, 4)}px`, height: `${Math.max(item.height * scale, 6)}px` }} />
                            ))}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="py-12 text-center text-neutral-400 text-xs">No document preview available.</div>
                    )}
                  </div>
                  {guestFocusedItem !== null && guestDocResult?.pageLayouts?.[guestPageIndex]?.items?.[guestFocusedItem] && (
                    <div className="px-4 py-2 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-400 truncate">
                      <span className="font-semibold">Traced Text:</span> {guestDocResult.pageLayouts[guestPageIndex].items[guestFocusedItem].str}
                    </div>
                  )}
                  {guestDocResult && guestDocResult.pagesCount > 1 && (
                    <div className="flex items-center justify-between p-3 border-t border-neutral-200 dark:border-neutral-800">
                      <button type="button" onClick={() => setGuestPageIndex((prev) => Math.max(0, prev - 1))} disabled={guestPageIndex === 0} className="p-1.5 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 disabled:opacity-40 flex items-center gap-1 text-xs font-semibold" id="guest-doc-prev-btn"><ChevronLeft className="w-4 h-4" /><span>Previous</span></button>
                      <span className="text-xs text-neutral-500">Page <b>{guestPageIndex + 1}</b> of <b>{guestDocResult.pagesCount}</b></span>
                      <button type="button" onClick={() => setGuestPageIndex((prev) => Math.min(guestDocResult.pagesCount - 1, prev + 1))} disabled={guestPageIndex === guestDocResult.pagesCount - 1} className="p-1.5 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 disabled:opacity-40 flex items-center gap-1 text-xs font-semibold" id="guest-doc-next-btn"><span>Next</span><ChevronRight className="w-4 h-4" /></button>
                    </div>
                  )}
                </section>

                <aside className="lg:col-span-5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm overflow-hidden" id="guest-ai-summary-panel">
                  <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-800">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      <span>AI Summary</span>
                    </h2>
                  </div>
                  <div className="p-5 overflow-y-auto max-h-[720px]">
                    {guestDocLoading && !guestSummary ? (
                      <div className="py-10 flex flex-col items-center text-neutral-400"><Loader2 className="w-6 h-6 animate-spin mb-2" /><p className="text-xs">Loading summary…</p></div>
                    ) : guestSummary ? (
                      <SummaryView summary={guestSummary} pagesCount={guestDocResult?.pagesCount || null} currentPage={guestPageIndex + 1} onPageChange={(page) => setGuestPageIndex(page - 1)} contentId="guest-ai-summary-content" compact />
                    ) : (
                      <div className="py-8 text-center text-neutral-400">
                        <Sparkles className="w-8 h-8 mx-auto mb-2" />
                        <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">No AI summary saved yet</p>
                        <p className="text-xs mt-1">{guestSummaryError || "This file was uploaded before saved summaries, so there is nothing to show yet."}</p>
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </main>
          ) : guestRoom ? (
            <main id="guest-room-main" className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8 flex flex-col">
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden" id="guest-room-panel">
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 flex items-center gap-2">
                      <KeyRound className="w-4 h-4" />
                      <span>Room {guestRoom.code}</span>
                    </h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Files shared in this room. Click a file to view it.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => { setRoomCode(""); setJoinRoomError(null); setIsRoomCodeModalOpen(true); }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
                      id="guest-enter-another-code-btn"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Enter Another Code</span>
                    </button>
                    <button
                      type="button"
                      onClick={leaveGuestRoom}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-semibold hover:opacity-90 transition-opacity"
                      id="leave-guest-room-btn"
                    >
                      <span>Leave Room</span>
                    </button>
                  </div>
                </div>
                {guestRoom.files.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-neutral-400 dark:text-neutral-500">
                    <FolderOpen className="w-10 h-10 mb-3" />
                    <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">No files in this room</p>
                  </div>
                ) : (
                  <div className="overflow-auto flex-1" id="guest-room-files-list">
                    {groupFilesByDay(guestRoom.files).map((group) => (
                      <div key={group.key}>
                        <div className="px-5 py-2 bg-neutral-50 dark:bg-neutral-950 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3 sticky top-0 z-[1]">
                          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{group.label}</span>
                          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{group.files.length} file{group.files.length === 1 ? "" : "s"}</span>
                        </div>
                        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                          {group.files.map((f) => (
                            <li key={f.path} onClick={() => openGuestDocument(f)} className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-950 transition-colors" title="Click to view document">
                              <div className="p-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg shrink-0">
                                <FileText className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate" title={f.name}>{f.name}</p>
                                <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate" title={f.uploadedAt || undefined}>{formatUploadedDateTime(f.uploadedAt)}</p>
                              </div>
                              <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">{formatFileSize(f.size)}</span>
                              <ChevronRight className="w-4 h-4 text-neutral-300 dark:text-neutral-600 shrink-0" />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-400 dark:text-neutral-500">
                  {guestRoom.files.length} file{guestRoom.files.length === 1 ? "" : "s"} in Room {guestRoom.code}
                </div>
              </div>
            </main>
          ) : (
            <main id="guest-main" className="flex-1 w-full bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-8">
              <button
                type="button"
                onClick={() => { setJoinRoomError(null); setIsRoomCodeModalOpen(true); }}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity cursor-pointer"
                id="open-room-code-modal-btn"
              >
                <KeyRound className="w-4 h-4" />
                <span>Enter Room Code</span>
              </button>
            </main>
          )}
          {isRoomCodeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" id="guest-room-code-overlay">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="guest-room-code-title"
              className="relative w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-xl p-6"
              id="guest-room-code-modal"
            >
              <button
                type="button"
                onClick={() => setIsRoomCodeModalOpen(false)}
                className="absolute top-3 right-3 p-1.5 rounded-full text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                aria-label="Close"
                title="Close"
                id="close-room-code-modal-btn"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="w-11 h-11 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-700 dark:text-neutral-300 mb-4">
                <KeyRound className="w-5 h-5" />
              </div>
              <h2 id="guest-room-code-title" className="text-base font-bold text-neutral-900 dark:text-neutral-100">Enter Room Code</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Type the 6-digit room code to continue.</p>

              <label htmlFor="room-code-input" className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider mt-5 mb-2">
                Room Code
              </label>
              <input
                id="room-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={roomCode}
                onChange={(e) => { setRoomCode(e.target.value.replace(/\D/g, "").slice(0, 6)); if (joinRoomError) setJoinRoomError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && roomCode.length === 6 && !isJoiningRoom) joinGuestRoom(); }}
                placeholder="000000"
                aria-describedby="room-code-hint"
                className="w-full border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 rounded-lg px-3 py-3 text-center text-lg font-mono font-semibold tracking-[0.5em] text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-300 dark:placeholder:text-neutral-700 focus:outline-none focus:border-neutral-900 dark:focus:border-neutral-300"
              />
              <p id="room-code-hint" className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-2 text-right">{roomCode.length}/6</p>

              {joinRoomError && (
                <div className="mt-3 flex items-start gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 text-xs text-red-700 dark:text-red-300" id="join-room-error">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{joinRoomError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={joinGuestRoom}
                disabled={roomCode.length !== 6 || isJoiningRoom}
                className="mt-4 w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg py-2.5 px-4 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                id="enter-room-code-btn"
              >
                {isJoiningRoom ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>{isJoiningRoom ? "Opening room..." : "Enter"}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsRoomCodeModalOpen(false)}
                className="mt-2 w-full border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-lg py-2.5 px-4 font-semibold text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                id="close-room-code-btn"
              >
                Close
              </button>
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-3 text-center">Switch back to Admin in Profile to return.</p>
            </div>
          </div>
          )}
        </>
      ) : appView === "files" ? (
        <main id="files-main" className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8 flex flex-col">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden" id="uploaded-files-panel">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4" />
                  <span>Uploaded Files</span>
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Backup copies of every uploaded PDF, stored in the repository's /uploaded folder.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={fetchAdminFiles}
                  disabled={adminLoading}
                  className="p-2 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40 transition-all"
                  title="Refresh file list"
                >
                  <RefreshCw className={`w-4 h-4 ${adminLoading ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={startHostingRoom}
                  disabled={adminLoading || adminFiles.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40 transition-all"
                  id="host-room-btn"
                >
                  <Users className="w-4 h-4" />
                  <span>Host Room</span>
                </button>
                <button
                  onClick={openRoomHistory}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
                  id="room-history-btn"
                >
                  <History className="w-4 h-4" />
                  <span>History</span>
                </button>
                <button
                  onClick={openUploadModal}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-semibold hover:opacity-90 transition-opacity"
                  id="open-upload-ui-btn"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>Upload File</span>
                </button>
              </div>
            </div>

            {isSelectingRoomFiles && (
              <div id="host-room-selection-bar" className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Select files for this room</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{selectedRoomFilePaths.length} selected — guests with the room code will see only these files.</p>
                  {hostRoomError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{hostRoomError}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={cancelHostingRoom}
                    disabled={isHostingRoom}
                    className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-white dark:hover:bg-neutral-900 disabled:opacity-40 transition-all"
                    id="cancel-host-room-btn"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createHostedRoom}
                    disabled={selectedRoomFilePaths.length === 0 || isHostingRoom}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
                    id="create-room-btn"
                  >
                    {isHostingRoom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                    <span>{isHostingRoom ? "Creating..." : "Create Room"}</span>
                  </button>
                </div>
              </div>
            )}

            {hostedRoom && (
              <div id="hosted-room-panel" className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-emerald-50 dark:bg-emerald-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg shrink-0">
                    <CheckCircle className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Room is ready — share this code with guests</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-2xl font-mono font-bold tracking-[0.3em] text-neutral-900 dark:text-neutral-100" id="hosted-room-code">{hostedRoom.code}</span>
                      <button
                        type="button"
                        onClick={copyHostedRoomCode}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-white dark:bg-neutral-900 border border-emerald-200 dark:border-emerald-900 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                        id="copy-room-code-btn"
                      >
                        {copiedRoomCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedRoomCode ? "Copied!" : "Copy"}</span>
                      </button>
                    </div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">{hostedRoom.files.length} file{hostedRoom.files.length === 1 ? "" : "s"} in this room · Started {formatUploadedDateTime(hostedRoom.startedAt || hostedRoom.createdAt)}{hostedRoom.endedAt ? ` · Ended ${formatUploadedDateTime(hostedRoom.endedAt)}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!hostedRoom.endedAt && (
                    <button
                      type="button"
                      onClick={() => endHostedRoom(hostedRoom.code)}
                      disabled={endingRoomCode === hostedRoom.code}
                      className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 disabled:opacity-40 transition-colors"
                      id="end-hosted-room-btn"
                    >
                      {endingRoomCode === hostedRoom.code ? "Ending..." : "End Room"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setHostedRoom(null)}
                    className="px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-900 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                    id="close-hosted-room-panel-btn"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

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
              <div className="overflow-auto flex-1" id="uploaded-files-grouped-list">
                {groupFilesByDay(adminFiles).map((group) => (
                  <div key={group.key}>
                    <div className="px-5 py-2 bg-neutral-50 dark:bg-neutral-950 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3 sticky top-0 z-[1]">
                      <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{group.label}</span>
                      <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{group.files.length} file{group.files.length === 1 ? "" : "s"}</span>
                    </div>
                    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {group.files.map((f) => (
                        <li key={f.path} className={`flex items-center gap-3 px-5 py-3 ${isSelectingRoomFiles && selectedRoomFilePaths.includes(f.path) ? "bg-neutral-50 dark:bg-neutral-950" : ""}`}>
                          {isSelectingRoomFiles && (
                            <input
                              type="checkbox"
                              checked={selectedRoomFilePaths.includes(f.path)}
                              onChange={() => toggleRoomFileSelection(f.path)}
                              className="w-4 h-4 shrink-0 accent-neutral-900 dark:accent-neutral-100 cursor-pointer"
                              aria-label={`Select ${f.name} for room`}
                              id={`room-file-checkbox-${f.path.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                            />
                          )}
                          <div className="p-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg shrink-0">
                            <FileText className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate" title={f.name}>{f.name}</p>
                            <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate" title={f.uploadedAt || undefined}>{formatUploadedDateTime(f.uploadedAt)}</p>
                          </div>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">{formatFileSize(f.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-400 dark:text-neutral-500">
              {adminFiles.length} file{adminFiles.length === 1 ? "" : "s"} in /uploaded
            </div>
          </div>
        </main>
      ) : (
      <main id="app-main-content" className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: UPLOAD & CONTROLS (12 columns on mobile, 5 on lg) */}
        <div id="left-column" className="lg:col-span-5 flex flex-col gap-6 w-full">
          
          {/* FILE UPLOAD CARD */}
          <div id="upload-card" className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-4 flex items-center gap-2">
              <FileUp className="w-4 h-4" />
              <span>Document Upload</span>
            </h2>

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
                    <SummaryView summary={summaryResult} pagesCount={extractionResult?.pagesCount || null} currentPage={currentPageIndex + 1} onPageChange={(page) => setCurrentPageIndex(page - 1)} contentId="markdown-container" />
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
        </div>
      </main>
      )}

      {/* FOOTER */}
      {profileRole !== "Guest" && (
      <footer id="app-footer" className="bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 py-6 px-6 md:px-12 mt-12 shrink-0 text-center sm:text-left">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-neutral-400 dark:text-neutral-500">
          <p>© 2026 EcoLegis. Powered by DeepSeek API via APMix.</p>
          <div className="flex gap-4">
            <span className="hover:text-neutral-600 cursor-help" title="Converts pages locally using HTML5 Canvas text rendering contexts">Client-Side Parser</span>
            <span>•</span>
            <span className="hover:text-neutral-600 cursor-help" title="Safely proxies requests through server.ts to secure the API key">Server-Side AI Proxy</span>
          </div>
        </div>
      </footer>
      )}


      {isUploadModalOpen && (
        <div id="upload-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="upload-modal-title" className="relative w-full max-w-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto" id="upload-modal">
            <button
              type="button"
              onClick={closeUploadModal}
              disabled={isExtracting || isSummarizing || isSavingCompanion || isSavingTraces}
              className="absolute top-3 right-3 p-1.5 rounded-full text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer"
              aria-label="Close upload"
              title="Close"
              id="close-upload-modal-btn"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-11 h-11 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-700 dark:text-neutral-300 mb-4">
              <UploadCloud className="w-5 h-5" />
            </div>
            <h2 id="upload-modal-title" className="text-base font-bold text-neutral-900 dark:text-neutral-100">Upload Document</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">We will extract the text, create the AI summary, and save the summary and trace boxes with the file. AI settings are fixed.</p>

            <input type="file" ref={uploadModalInputRef} onChange={handleUploadModalFileChange} accept=".pdf" className="hidden" id="upload-modal-file-input" />

            {!file ? (
              <div
                id="upload-modal-drop-zone"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleUploadModalDrop}
                onClick={() => uploadModalInputRef.current?.click()}
                className={`mt-5 border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${isDragActive ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-950" : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 hover:bg-neutral-50/50"}`}
              >
                <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4 text-neutral-600 dark:text-neutral-400">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <h3 className="font-medium text-neutral-900 dark:text-neutral-100 mb-1">Click to upload or drag & drop</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-[260px]">Supports any PDF file up to 50MB</p>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 bg-neutral-50 dark:bg-neutral-950 flex items-start gap-3">
                  <div className="p-2.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate" title={file.name}>{file.name}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{(file.size / (1024 * 1024)).toFixed(2)} MB{extractionResult ? ` · ${extractionResult.pagesCount} pages` : ""}</p>
                  </div>
                </div>

                <ol className="space-y-2 text-sm" id="upload-auto-steps">
                  <li className="flex items-center gap-2">
                    {isExtracting ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : extractionResult ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> : <span className="w-4 h-4 rounded-full border border-neutral-300 shrink-0" />}
                    <span>Extracting text{isOcrScanning ? " (scanning pages…)" : ""}</span>
                    {isExtracting && extractionProgress ? <span className="text-xs text-neutral-400 ml-auto">{Math.floor(extractionProgress.current)} / {extractionProgress.total}</span> : null}
                  </li>
                  <li className="flex items-center gap-2">
                    {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : summaryResult ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> : <span className="w-4 h-4 rounded-full border border-neutral-300 shrink-0" />}
                    <span>Generating AI summary</span>
                  </li>
                  <li className="flex items-center gap-2">
                    {isSavingCompanion || isSavingTraces ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : companionSaved && traceBoxesSaved ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> : <span className="w-4 h-4 rounded-full border border-neutral-300 shrink-0" />}
                    <span>Saving summary & trace boxes with the file</span>
                  </li>
                </ol>

                {isExtracting && extractionProgress && (
                  <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-2 overflow-hidden">
                    <div className="bg-neutral-900 dark:bg-neutral-100 h-full transition-all duration-200 rounded-full" style={{ width: `${(extractionProgress.current / extractionProgress.total) * 100}%` }} />
                  </div>
                )}

                {(extractionError || summarizationError || uploadAutoError) && (
                  <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-3 text-xs text-red-700 dark:text-red-300">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{uploadAutoError || extractionError || summarizationError}</span>
                  </div>
                )}

                {summaryResult && companionSaved && traceBoxesSaved ? (
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle className="w-4 h-4" />
                      <span>Done — summary & trace boxes saved with this file</span>
                    </div>
                    {showUploadSummary ? (
                      <div className="mt-3 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 max-h-64 overflow-y-auto" id="upload-modal-summary-preview">
                        <SummaryView summary={summaryResult} pagesCount={extractionResult?.pagesCount || null} contentId="upload-modal-summary-content" compact />
                      </div>
                    ) : null}
                    <button type="button" onClick={() => setShowUploadSummary((prev) => !prev)} className="mt-4 w-full border border-neutral-200 dark:border-neutral-700 rounded-lg py-2.5 px-4 font-semibold text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors" id="toggle-upload-summary-btn">{showUploadSummary ? "Hide AI Summarize" : "Show AI Summarize"}</button>
                    <button type="button" onClick={closeUploadModal} className="mt-3 w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg py-2.5 px-4 font-semibold text-sm hover:opacity-90 transition-opacity" id="upload-modal-done-btn">Done</button>
                  </div>
                ) : extractionResult && !isSummarizing && !isSavingCompanion && !isSavingTraces ? (
                  <button type="button" onClick={retryUploadAutoSummary} className="w-full border border-neutral-200 dark:border-neutral-700 rounded-lg py-2.5 px-4 font-semibold text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors" id="upload-modal-retry-btn">Retry processing</button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {isRoomHistoryOpen && (
        <div id="room-history-overlay" className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close room history"
            onClick={() => setIsRoomHistoryOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px] cursor-pointer"
            id="close-room-history-overlay-btn"
          />
          <aside id="room-history-drawer" className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col" aria-label="Hosted room history">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 flex items-center gap-2">
                  <History className="w-4 h-4" />
                  <span>Room History</span>
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Hosted rooms with their start and end times.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={fetchRoomHistory}
                  disabled={roomHistoryLoading}
                  className="p-2 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40 transition-all"
                  title="Refresh room history"
                  id="refresh-room-history-btn"
                >
                  <RefreshCw className={`w-4 h-4 ${roomHistoryLoading ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsRoomHistoryOpen(false)}
                  className="p-2 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
                  aria-label="Close"
                  title="Close"
                  id="close-room-history-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {roomHistoryLoading ? (
                <div className="h-full flex items-center justify-center text-neutral-400 dark:text-neutral-500">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : roomHistoryError ? (
                <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>{roomHistoryError}</span>
                </div>
              ) : roomHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-400 dark:text-neutral-500">
                  <History className="w-10 h-10 mb-3" />
                  <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">No rooms hosted yet</p>
                  <p className="text-xs mt-1">Host a room and it will appear here.</p>
                </div>
              ) : (
                <ul className="space-y-3" id="room-history-list">
                  {roomHistory.map((room) => (
                    <li key={room.code} className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 bg-white dark:bg-neutral-900">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-xl font-mono font-bold tracking-[0.25em] text-neutral-900 dark:text-neutral-100">{room.code}</span>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{room.files.length} file{room.files.length === 1 ? "" : "s"} in this room</p>
                        </div>
                        <span className={`shrink-0 px-2 py-1 rounded-full text-[11px] font-bold ${room.endedAt ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400" : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"}`}>
                          {room.endedAt ? "Ended" : "Active"}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1 text-xs">
                        <p className="flex justify-between gap-3"><span className="text-neutral-400 dark:text-neutral-500 font-semibold">Started</span><span className="text-neutral-700 dark:text-neutral-300 text-right">{formatUploadedDateTime(room.startedAt || room.createdAt)}</span></p>
                        <p className="flex justify-between gap-3"><span className="text-neutral-400 dark:text-neutral-500 font-semibold">Ended</span><span className="text-neutral-700 dark:text-neutral-300 text-right">{room.endedAt ? formatUploadedDateTime(room.endedAt) : "—"}</span></p>
                      </div>
                      {room.files.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">Files</p>
                          <ul className="space-y-1">
                            {room.files.map((f) => (
                              <li key={f.path} className="text-xs text-neutral-600 dark:text-neutral-400 truncate" title={f.name}>{f.name}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!room.endedAt && (
                        <button
                          type="button"
                          onClick={() => endHostedRoom(room.code)}
                          disabled={endingRoomCode === room.code}
                          className="mt-3 w-full px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 disabled:opacity-40 transition-colors"
                          id={`end-room-${room.code}-btn`}
                        >
                          {endingRoomCode === room.code ? "Ending..." : "End Room"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
