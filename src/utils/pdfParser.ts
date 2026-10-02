// Pages with less extractable text than this are treated as image-only (scanned)
// and fall back to OCR.
const OCR_TEXT_THRESHOLD = 30;

/**
 * Renders a PDF.js page to a canvas so Tesseract can OCR it.
 */
async function renderPageToCanvas(page: any): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(4, (1400 / baseViewport.width) * 2);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas 2D context is not available");
  }
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, scale };
}

export interface PDFTextItem {
  str: string;
  x: number;      // X coordinate from left
  y: number;      // Y coordinate from top
  width: number;  // Width of text block
  height: number; // Height of text block
}

export interface PDFPageLayout {
  width: number;  // Page width in pt
  height: number; // Page height in pt
  items: PDFTextItem[];
}

export interface PDFParseResult {
  text: string;
  pagesCount: number;
  pages: string[];
  metadata?: {
    title?: string;
    author?: string;
    creator?: string;
    producer?: string;
  };
  pageLayouts?: PDFPageLayout[];
}

/**
 * Converts Tesseract word bounding boxes (image pixels, top-left origin)
 * into the page-layout items used by the app (PDF points, top-left origin).
 */
function ocrWordsToLayoutItems(data: any, scale: number): PDFTextItem[] {
  const words: any[] = [];
  for (const block of (data && data.blocks) || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          words.push(word);
        }
      }
    }
  }
  const source = words.length ? words : ((data && data.words) || []);
  return source
    .filter((w: any) => w && w.text && w.text.trim() !== "" && w.bbox)
    .map((w: any) => ({
      str: w.text,
      x: Math.max(0, w.bbox.x0 / scale),
      y: Math.max(0, w.bbox.y0 / scale),
      width: Math.max(0, (w.bbox.x1 - w.bbox.x0) / scale),
      height: Math.max(0, (w.bbox.y1 - w.bbox.y0) / scale),
    }));
}

/**
 * Extracts raw text and metadata from a PDF file using PDF.js
 * @param file The PDF File object
 * @param onProgress Optional progress callback tracking page processing
 */
export async function extractTextFromPDF(
  file: File,
  onProgress?: (current: number, total: number) => void,
  onOcrStatus?: (scanning: boolean) => void,
  onOcrProgress?: (page: number, total: number, progress: number) => void
): Promise<PDFParseResult> {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("PDF.js library is not yet loaded. Please wait a moment and try again.");
  }

  // Set the worker URL to match the library version loaded
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

  const fileReader = new FileReader();

  return new Promise((resolve, reject) => {
    fileReader.onload = async () => {
      // Lazily-created Tesseract worker, reused across pages that need OCR.
      // Declared before the try so the finally block can always clean it up.
      let ocrWorker: any = null;
      let ocrWasUsed = false;
      try {
        const typedarray = new Uint8Array(fileReader.result as ArrayBuffer);
        const loadingTask = pdfjsLib.getDocument({ data: typedarray });

        // Add loading progress logging if needed
        const pdf = await loadingTask.promise;
        const pagesCount = pdf.numPages;
        const pages: string[] = [];
        const pageLayouts: PDFPageLayout[] = [];
        let fullText = "";

        // Extract PDF metadata (Author, Title, etc.) safely
        let metadataResult = {};
        try {
          const meta = await pdf.getMetadata();
          if (meta && meta.info) {
            metadataResult = {
              title: meta.info.Title || "",
              author: meta.info.Author || "",
              creator: meta.info.Creator || "",
              producer: meta.info.Producer || "",
            };
          }
        } catch (metaError) {
          console.warn("Could not load PDF document metadata:", metaError);
        }

        // All OCR items across every page, so their heights can be normalized
        // to one fixed font size for the whole document
        const ocrItemRefs: PDFTextItem[] = [];

        // Loop through and extract text page by page
        for (let i = 1; i <= pagesCount; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.0 });
          const pageHeight = viewport.height;
          const pageWidth = viewport.width;

          const textContent = await page.getTextContent();
          
          // Reconstruct the text line-by-line / word-by-word
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(" ")
            .replace(/\s+/g, " ") // Clean up excess spacing
            .trim();
          
          let finalPageText = pageText;
          let ocrLayoutItems: PDFTextItem[] | null = null;

          // Image-only (scanned) page: little or no extractable text -> fall back to OCR
          if (pageText.length < OCR_TEXT_THRESHOLD) {
            try {
              if (!ocrWorker) {
                const Tesseract = (window as any).Tesseract;
                if (!Tesseract || !Tesseract.createWorker) {
                  throw new Error("Tesseract.js failed to load from CDN");
                }
                ocrWorker = await Tesseract.createWorker(["eng", "tgl"], 1, {
                  // tgl has no "_best_int" traineddata on the CDN (404); use the
                  // standard 4.0.0 files instead so Tagalog loads correctly.
                  legacyLang: true,
                  logger: (m: any) => {
                    if (m.status === "recognizing text" && onOcrProgress) {
                      onOcrProgress(i, pagesCount, m.progress || 0);
                    }
                  },
                });
                ocrWasUsed = true;
                if (onOcrStatus) onOcrStatus(true);
              }
              const { canvas, scale } = await renderPageToCanvas(page);
              const { data } = await ocrWorker.recognize(canvas, {}, { blocks: true });
              const cleanOcrText = (data.text || "").replace(/\s+/g, " ").trim();
              if (cleanOcrText.length >= finalPageText.length) {
                finalPageText = cleanOcrText;
                // Keep coordinates too, so the layout view works for scanned pages
                ocrLayoutItems = ocrWordsToLayoutItems(data, scale);
                ocrItemRefs.push(...ocrLayoutItems);
              }
            } catch (ocrError) {
              console.warn(`OCR fallback failed for page ${i}:`, ocrError);
            }
          }

          pages.push(finalPageText);
          fullText += `--- Page ${i} ---\n${finalPageText}\n\n`;

          // Process coordinate layout items
          const layoutItems: PDFTextItem[] = textContent.items
            .filter((item: any) => item.str && item.str.trim() !== "")
            .map((item: any) => {
              const tx = item.transform || [12, 0, 0, 12, 0, 0];
              // Math.abs(tx[3]) handles text size, item.height is vertical span
              const height = item.height || Math.abs(tx[3]) || 10;
              const width = item.width || 50;
              // Convert Y coordinate from PDF space (bottom-up) to Viewport space (top-down)
              const y = pageHeight - tx[5] - height;
              const x = tx[4];

              return {
                str: item.str,
                x: x >= 0 ? x : 0,
                y: y >= 0 ? y : 0,
                width: width >= 0 ? width : 50,
                height: height >= 0 ? height : 10
              };
            });

          pageLayouts.push({
            width: pageWidth,
            height: pageHeight,
            items: ocrLayoutItems && ocrLayoutItems.length ? ocrLayoutItems : layoutItems
          });

          if (onProgress) {
            onProgress(i, pagesCount);
          }
        }

        // OCR word heights vary per word (ascenders, box noise), which made
        // the layout view render mismatched font sizes across pages. Pin
        // every OCR item to one fixed height — the document-wide median —
        // so all pages share the same font size.
        if (ocrItemRefs.length) {
          const sortedHeights = ocrItemRefs.map((it) => it.height).sort((a, b) => a - b);
          const fixedHeight = sortedHeights[Math.floor(sortedHeights.length / 2)];
          for (const item of ocrItemRefs) {
            item.height = fixedHeight;
          }
        }

        resolve({
          text: fullText,
          pagesCount,
          pages,
          metadata: metadataResult,
          pageLayouts
        });
      } catch (error: any) {
        reject(new Error(`PDF extraction failed: ${error.message || error}`));
      } finally {
        if (ocrWorker) {
          const workerToStop = ocrWorker;
          ocrWorker = null;
          workerToStop.terminate().catch(() => {});
        }
        if (ocrWasUsed && onOcrStatus) {
          onOcrStatus(false);
        }
      }
    };

    fileReader.onerror = () => {
      reject(new Error("Failed to read PDF file as ArrayBuffer."));
    };

    fileReader.readAsArrayBuffer(file);
  });
}
