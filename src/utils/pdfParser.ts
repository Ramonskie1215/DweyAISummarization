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
 * Extracts raw text and metadata from a PDF file using PDF.js
 * @param file The PDF File object
 * @param onProgress Optional progress callback tracking page processing
 */
export async function extractTextFromPDF(
  file: File,
  onProgress?: (current: number, total: number) => void
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
          
          pages.push(pageText);
          fullText += `--- Page ${i} ---\n${pageText}\n\n`;

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
            items: layoutItems
          });

          if (onProgress) {
            onProgress(i, pagesCount);
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
      }
    };

    fileReader.onerror = () => {
      reject(new Error("Failed to read PDF file as ArrayBuffer."));
    };

    fileReader.readAsArrayBuffer(file);
  });
}
