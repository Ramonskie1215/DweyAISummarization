import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { gunzipSync, gzipSync } from "node:zlib";
import { del, get, issueSignedToken } from "@vercel/blob";
import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from "@vercel/blob/client";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON payloads with high limit for large extracted PDF text
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Health check API endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Secure API Proxy endpoint to process text with the AI provider (OpenRouter)
  app.post("/api/summarize", async (req, res) => {
    try {
      const { text, model, prompt, length, style, language, format } = req.body;
      if (!text || typeof text !== "string" || text.trim() === "") {
        return res.status(400).json({ error: "Text content is required for summarization." });
      }

      // Default or custom selected model
      const selectedModel = model || process.env.AI_MODEL || "openrouter/free";

      // Build structured guidelines based on length and style requested
      const summaryLengthText = length || "Medium";
      const summaryStyleText = style || "Professional";

      const systemPrompt = "You are an expert document assistant. You analyze extracted PDF text and produce beautifully formatted, highly informative summaries using clear Markdown hierarchy. Focus on accuracy and structure.";
      
      const fixedPageRangePrompt = format === "page-ranges" ? `You are given text extracted from a PDF, split into pages with [Page N] markers. Produce a summary in this exact Markdown format:

## General Summary
Give a clear general summary of the whole file: what it is about, its main purpose, and the most important points.

## Page Range Breakdown
Look at the context of each page. If the file has different contexts/topics in different parts, group consecutive pages that share the same context into page ranges (for example, Pages 1-3, Pages 4-6) and describe what is on that specific range of pages. If the whole file shares one context, write a single entry for Pages 1 to the last page.
Write each page range as its own Markdown heading in this exact form: ### Pages 1-2 for a range, or ### Page 5 for a single page. Put the description for that range in the paragraph(s) under its heading, and do not combine multiple ranges in one heading.
Use only page numbers that appear in the [Page N] markers. Do not invent pages or content.

Text to analyze, by page:
--------------------------------------
${text}
--------------------------------------` : null;
      const basePrompt = fixedPageRangePrompt || prompt || `You are given a text extracted from a PDF. Please read it thoroughly and produce a highly professional, beautifully structured markdown summary.

Please follow these exact requirements:
- **Summary Length**: ${summaryLengthText} (Please adapt details accordingly)
- **Tone & Style**: ${summaryStyleText} (Use bullet points, clear bold headings, and elegant structure)
- **Content Outline**: Extrapolate the core message, identify key take-aways/findings, and compile action items or secondary details if available.

Text to analyze and summarize:
--------------------------------------
${text}
--------------------------------------`;

      const summaryLanguageText = language === "tl" ? "Tagalog" : "English";
      const userPrompt = `${basePrompt}\n\nIMPORTANT: Write the entire summary in ${summaryLanguageText}.`;

      const apiKey = process.env.AI_API_KEY || "";
      if (!apiKey) {
        return res.status(500).json({ error: "AI API key is not configured on the server. Set the AI_API_KEY environment variable." });
      }
      const aiBaseUrl = (process.env.AI_API_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");

      console.log(`[Proxy Request] Forwarding to ${aiBaseUrl} with model: ${selectedModel}`);

      const response = await fetch(`${aiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Proxy Error] API responded with status ${response.status}: ${errorText}`);
        return res.status(response.status).json({
          error: `The AI service responded with error status ${response.status}`,
          details: errorText
        });
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        console.error("[Proxy Error] No content found in choices response:", JSON.stringify(data));
        return res.status(500).json({ error: "No content was returned in the AI response." });
      }

      return res.json({ summary: content });
    } catch (error: any) {
      console.error("[Proxy Exception] Exception occurred:", error);
      return res.status(500).json({ error: error.message || "An error occurred while communicating with the AI service." });
    }
  });


  const getUploadDateFolder = (input?: string) => {
    const candidate = String(input || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = (t: string) => parts.find((x) => x.type === t)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  const listUploadedFilesStore = async (ghOwner: string, ghRepo: string, ghHeaders: Record<string, string>) => {
    const listRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/uploaded`, { headers: ghHeaders });
    if (listRes.status === 404) return [] as any[];
    if (!listRes.ok) {
      const details = await listRes.text();
      throw new Error(`Could not list uploaded files (${listRes.status}): ${details}`);
    }
    const items: any = await listRes.json();
    const topLevel = Array.isArray(items) ? items : [];
    const dirFiles = await Promise.all(
      topLevel.filter((it: any) => it && it.type === "dir").map(async (dir: any) => {
        try {
          const dirRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${String(dir.path).split("/").map(encodeURIComponent).join("/")}`, { headers: ghHeaders });
          if (!dirRes.ok) return [] as any[];
          const inner: any = await dirRes.json();
          return Array.isArray(inner) ? inner : [];
        } catch (_) { return [] as any[]; }
      })
    );
    const all = [...topLevel, ...dirFiles.flat()];
    return all
      .filter((it: any) => it && it.type === "file" && !String(it.name || "").endsWith(".summary.json") && !String(it.name || "").endsWith(".summary.md") && !String(it.name || "").endsWith(".traces.json"))
      .map((it: any) => ({
        name: it.name,
        size: it.size,
        path: it.path,
        downloadUrl: it.download_url || null,
        htmlUrl: it.html_url || null,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  };

  // Admin Mode: list the backup copies stored in the repo's /uploaded folder
  app.get("/api/upload", async (req, res) => {
    try {
      const token = process.env.GITHUB_TOKEN;
      const ghOwner = process.env.GITHUB_OWNER || "Ramonskie1215";
      const ghRepo = process.env.GITHUB_REPO || "DweyAISummarization";
      const ghHeaders: Record<string, string> = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dwey-ai-summarization",
      };
      if (token) ghHeaders["Authorization"] = `Bearer ${token}`;

      const files = await listUploadedFilesStore(ghOwner, ghRepo, ghHeaders);
      const filesWithDates = await Promise.all(
        files.map(async (file: any) => {
          try {
            const commitRes = await fetch(
              `https://api.github.com/repos/${ghOwner}/${ghRepo}/commits?path=${encodeURIComponent(file.path)}&per_page=1`,
              { headers: ghHeaders }
            );
            if (!commitRes.ok) return { ...file, uploadedAt: null };
            const commits: any = await commitRes.json();
            const latest = Array.isArray(commits) ? commits[0] : null;
            const uploadedAt = latest?.commit?.committer?.date || latest?.commit?.author?.date || null;
            return { ...file, uploadedAt };
          } catch (_) {
            return { ...file, uploadedAt: null };
          }
        })
      );
      return res.status(200).json({ files: filesWithDates });
    } catch (error: any) {
      console.error("[Uploaded Files Exception]", error);
      return res.status(500).json({ error: error.message || "An error occurred while listing the uploaded files." });
    }
  });

  const readStagedBlob = async (pathname: string): Promise<Buffer | null> => {
    for (const access of ["private", "public"] as const) {
      try {
        const result = await get(pathname, { access });
        if (result && result.stream) {
          return Buffer.from(await new Response(result.stream as any).arrayBuffer());
        }
      } catch (_) {
        // Try the next access mode.
      }
    }
    return null;
  };

  // Backup readiness check for the Admin Uploaded Files view. It never returns
  // secret values — only whether the required server settings are present and
  // reachable — so large-PDF backup readiness can be confirmed before upload.
  app.get("/api/backup-status", async (req, res) => {
    const checkedAt = new Date().toISOString();
    const ghOwner = process.env.GITHUB_OWNER || "Ramonskie1215";
    const ghRepo = process.env.GITHUB_REPO || "DweyAISummarization";
    const ghToken = process.env.GITHUB_TOKEN || "";
    const github = {
      configured: Boolean(ghToken),
      ok: false,
      message: ghToken ? "" : "GITHUB_TOKEN is not set.",
    };
    if (ghToken) {
      try {
        const ghRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}`, {
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${ghToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ecolegis-backup-status",
          },
        });
        if (ghRes.ok) {
          github.ok = true;
          github.message = "Repo access OK.";
        } else if (ghRes.status === 401 || ghRes.status === 403) {
          github.message = "Repo access denied. Check GITHUB_TOKEN permissions.";
        } else if (ghRes.status === 404) {
          github.message = "Repo not found, or the token cannot see it.";
        } else {
          github.message = `Repo check failed (HTTP ${ghRes.status}).`;
        }
      } catch (_) {
        github.message = "Repo check failed. Check GITHUB_TOKEN.";
      }
    }

    const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
    const blob = {
      configured: blobConfigured,
      ok: false,
      message: blobConfigured ? "" : "No Blob connection found. Connect a Vercel Blob store, then redeploy.",
    };
    if (blobConfigured) {
      try {
        const blobModule: any = await import("@vercel/blob");
        if (typeof blobModule.list === "function") {
          await blobModule.list({ limit: 1 });
          blob.ok = true;
          blob.message = "Blob storage reachable.";
        } else {
          blob.ok = true;
          blob.message = "Blob connection is set.";
        }
      } catch (error: any) {
        blob.message = `Blob check failed: ${error?.message || "reconnect the Blob store, then redeploy."}`;
      }
    }

    return res.json({
      ready: github.ok && blob.ok,
      checkedAt,
      github,
      blob,
    });
  });

  // Issues short-lived upload permissions so the browser can upload large PDFs
  // directly to Vercel Blob storage (staging only; /api/upload copies the file
  // into GitHub). Supports both newer store-ID/OIDC connections via presigned
  // URLs and classic read-write-token connections.
  app.post("/api/blob-upload", async (req, res) => {
    try {
      if ((req.body as any)?.type === "blob.generate-presigned-url") {
        const jsonResponse = await handleUploadPresigned({
          body: req.body as HandleUploadPresignedBody,
          request: req as any,
          getSignedToken: async (pathname) => {
            const token = await issueSignedToken({
              pathname,
              operations: ["put"],
              allowedContentTypes: ["application/pdf"],
              maximumSizeInBytes: 100 * 1024 * 1024,
              validUntil: Date.now() + 10 * 60 * 1000,
            });
            return { token, urlOptions: { addRandomSuffix: true } };
          },
        });
        return res.json(jsonResponse);
      }

      const jsonResponse = await handleUpload({
        body: req.body as HandleUploadBody,
        request: req as any,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: true,
        }),
        onUploadCompleted: async () => {
          // Nothing to do: the browser calls /api/upload with the blob URL next.
        },
      });
      return res.json(jsonResponse);
    } catch (error: any) {
      console.error("[Blob Upload] Exception occurred:", error);
      return res.status(400).json({ error: error.message || "Could not start the large-file upload." });
    }
  });

  // Backup endpoint: commits a copy of an uploaded PDF to the repo's /uploaded folder via the GitHub API
  app.post("/api/upload", async (req, res) => {
    try {
      const { filename, blobUrl, blobPathname, dateFolder } = req.body || {};
      let { content } = req.body || {};
      const stagedBlobRef = blobPathname || blobUrl || "";
      if (blobPathname) {
        // Large-file path (new Blob connection): the browser staged the PDF in
        // Vercel Blob; read it with the Blob SDK, then fall through to the
        // same GitHub commit.
        const stagedBuffer = await readStagedBlob(String(blobPathname));
        if (stagedBuffer) {
          content = stagedBuffer.toString("base64");
        } else if (!blobUrl) {
          return res.status(502).json({ error: "Could not read the staged upload." });
        }
      }
      if (!content && blobUrl) {
        // Large-file path (classic public Blob URL): fetch it here
        // server-to-server, then fall through to the same GitHub commit.
        let blobHost = "";
        try { blobHost = new URL(String(blobUrl)).hostname; } catch (_) { blobHost = ""; }
        if (!blobHost.endsWith(".blob.vercel-storage.com")) {
          return res.status(400).json({ error: "Invalid blobUrl." });
        }
        const blobRes = await fetch(String(blobUrl));
        if (!blobRes.ok) {
          return res.status(502).json({ error: "Could not read the staged upload." });
        }
        content = Buffer.from(await blobRes.arrayBuffer()).toString("base64");
      }
      if (!filename || !content || typeof content !== "string") {
        return res.status(400).json({ error: "filename and base64 content are required." });
      }
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return res.status(500).json({ error: "GITHUB_TOKEN is not configured on the server." });
      }

      const ghOwner = process.env.GITHUB_OWNER || "Ramonskie1215";
      const ghRepo = process.env.GITHUB_REPO || "DweyAISummarization";
      const baseName = String(filename).split(/[\\/]/).pop() || "upload.pdf";
      const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.pdf";
      const folder = getUploadDateFolder(dateFolder);
      const repoPath = `uploaded/${folder}/${safeName}`;

      const ghHeaders: Record<string, string> = {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dwey-ai-summarization",
      };

      // If the file already exists, fetch its sha so we update it instead of failing
      let sha: string | undefined;
      const existing = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${repoPath}`, { headers: ghHeaders });
      if (existing.ok) {
        const existingData = await existing.json();
        sha = existingData.sha;
      }

      const putRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${repoPath}`, {
        method: "PUT",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Add uploaded document: ${safeName}`,
          content,
          ...(sha ? { sha } : {}),
        }),
      });

      if (!putRes.ok) {
        const errText = await putRes.text();
        console.error(`[Upload Backup] GitHub responded with status ${putRes.status}: ${errText}`);
        return res.status(putRes.status).json({ error: "GitHub upload failed.", details: errText });
      }

      const putData = await putRes.json();
      if (stagedBlobRef) {
        try { await del(String(stagedBlobRef)); } catch (_) { /* staging cleanup is best-effort */ }
      }
      return res.json({ ok: true, path: repoPath, commit: putData.commit?.sha });
    } catch (error: any) {
      console.error("[Upload Backup] Exception occurred:", error);
      return res.status(500).json({ error: error.message || "Upload backup failed." });
    }
  });


  // Companion AI summary for an uploaded document (saved once, read by Guests)
  const COMPANION_SUFFIX = ".summary.json";
  const companionPathFor = (filePath: string) => {
    const clean = String(filePath || "").trim();
    if (!clean.startsWith("uploaded/") || clean.includes("..")) return null;
    return clean.endsWith(COMPANION_SUFFIX) ? clean : `${clean}${COMPANION_SUFFIX}`;
  };
  const readCompanionFile = async (path: string) => {
    const { ghOwner, ghRepo, ghHeaders } = roomGhConfigLike();
    const res = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: ghHeaders });
    if (res.status === 404) return null;
    if (!res.ok) {
      const details = await res.text();
      throw new Error(`GitHub read failed (${res.status}): ${details}`);
    }
    return res.json();
  };
  // roomGhConfigLike is defined by the Rooms section below; this tiny local copy keeps companion routes independent.
  function roomGhConfigLike() {
    const token = process.env.GITHUB_TOKEN;
    const ghOwner = process.env.GITHUB_OWNER || "Ramonskie1215";
    const ghRepo = process.env.GITHUB_REPO || "DweyAISummarization";
    const ghHeaders: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dwey-ai-summarization",
    };
    if (token) ghHeaders["Authorization"] = `Bearer ${token}`;
    return { token, ghOwner, ghRepo, ghHeaders };
  }

  app.get("/api/companion", async (req, res) => {
    try {
      const filePath = String(req.query?.path || "").trim();
      const companionPath = companionPathFor(filePath);
      if (!companionPath) return res.status(400).json({ error: "A valid uploaded file path is required." });
      const { ghOwner, ghRepo, ghHeaders } = roomGhConfigLike();
      const resGh = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${companionPath.split("/").map(encodeURIComponent).join("/")}`, { headers: ghHeaders });
      if (resGh.status === 404) return res.status(404).json({ error: "No AI summary saved for this file yet." });
      if (!resGh.ok) {
        const details = await resGh.text();
        return res.status(resGh.status).json({ error: "Could not read the AI summary.", details });
      }
      const data: any = await resGh.json();
      const raw = Buffer.from(String(data.content || "").replace(/\n/g, ""), "base64").toString("utf-8");
      let parsed: any = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = { summary: raw }; }
      return res.json({
        file: parsed.file || { name: filePath.split("/").pop() || filePath, path: filePath },
        summary: parsed.summary || "",
        pagesCount: parsed.pagesCount || null,
        createdAt: parsed.createdAt || null,
        settings: parsed.settings || null,
        companionPath,
      });
    } catch (error: any) {
      console.error("[Companion Summary Exception]", error);
      return res.status(500).json({ error: error.message || "An error occurred while working with the AI summary." });
    }
  });

  app.post("/api/companion", async (req, res) => {
    try {
      const { token, ghOwner, ghRepo, ghHeaders } = roomGhConfigLike();
      if (!token) return res.status(500).json({ error: "GITHUB_TOKEN is not configured on the server." });
      const filePath = String(req.body?.filePath || "").trim();
      const companionPath = companionPathFor(filePath);
      const summary = String(req.body?.summary || "");
      if (!companionPath) return res.status(400).json({ error: "A valid uploaded file path is required." });
      if (!summary.trim()) return res.status(400).json({ error: "Summary is required." });
      const fileName = String(req.body?.fileName || filePath.split("/").pop() || "document.pdf");
      const payload = {
        version: 1,
        file: { name: fileName, path: filePath, size: typeof req.body?.fileSize === "number" ? req.body.fileSize : 0 },
        summary,
        pagesCount: typeof req.body?.pagesCount === "number" ? req.body.pagesCount : null,
        createdAt: new Date().toISOString(),
        settings: req.body?.settings || null,
      };
      const existing: any = await readCompanionFile(companionPath);
      const content = Buffer.from(JSON.stringify(payload, null, 2) + "\n", "utf-8").toString("base64");
      const putRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${companionPath.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Save AI summary for ${fileName}`, content, ...(existing?.sha ? { sha: existing.sha } : {}) }),
      });
      if (!putRes.ok) {
        const details = await putRes.text();
        return res.status(putRes.status).json({ error: "Could not save the AI summary.", details });
      }
      return res.json({ ok: true, companionPath, createdAt: payload.createdAt });
    } catch (error: any) {
      console.error("[Companion Summary Exception]", error);
      return res.status(500).json({ error: error.message || "An error occurred while working with the AI summary." });
    }
  });


  // Saved trace boxes for an uploaded document (saved once, read by Guests so text is not extracted again)
  const TRACE_SUFFIX = ".traces.json";
  const tracePathFor = (filePath: string) => {
    const clean = String(filePath || "").trim();
    if (!clean.startsWith("uploaded/") || clean.includes("..")) return null;
    return clean.endsWith(TRACE_SUFFIX) ? clean : `${clean}${TRACE_SUFFIX}`;
  };
  const roundTraceNumber = (value: any) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
  };
  const compactTracePages = (input: any) => {
    if (!Array.isArray(input)) return [] as any[];
    return input
      .map((page: any) => {
        const items = Array.isArray(page?.items) ? page.items : [];
        return {
          width: roundTraceNumber(page?.width),
          height: roundTraceNumber(page?.height),
          items: items
            .map((item: any) => {
              if (Array.isArray(item)) {
                return [String(item[0] || ""), roundTraceNumber(item[1]), roundTraceNumber(item[2]), roundTraceNumber(item[3]), roundTraceNumber(item[4])];
              }
              return [String(item?.str || ""), roundTraceNumber(item?.x), roundTraceNumber(item?.y), roundTraceNumber(item?.width), roundTraceNumber(item?.height)];
            })
            .filter((item: any[]) => String(item[0] || "").trim() !== ""),
        };
      })
      .filter((page: any) => page.width > 0 && page.height > 0);
  };
  const expandTracePages = (input: any) => {
    return compactTracePages(input).map((page: any) => ({
      width: page.width,
      height: page.height,
      items: page.items.map((item: any[]) => ({
        str: String(item[0] || ""),
        x: Number(item[1]) || 0,
        y: Number(item[2]) || 0,
        width: Number(item[3]) || 0,
        height: Number(item[4]) || 0,
      })),
    }));
  };
  const parseStoredTrace = (raw: string, filePath: string, tracePath: string) => {
    let parsed: any = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
    if (parsed?.encoding === "gzip-base64" && parsed?.data) {
      const decoded = gunzipSync(Buffer.from(String(parsed.data), "base64") as any).toString("utf-8");
      const traceData = JSON.parse(decoded);
      const pageLayouts = expandTracePages(traceData?.pages || traceData?.pageLayouts || []);
      return {
        file: parsed.file || traceData?.file || { name: filePath.split("/").pop() || filePath, path: filePath },
        pagesCount: typeof traceData?.pagesCount === "number" ? traceData.pagesCount : pageLayouts.length,
        pageLayouts,
        createdAt: parsed.createdAt || traceData?.createdAt || null,
        tracePath,
      };
    }
    const pageLayouts = expandTracePages(parsed?.pages || parsed?.pageLayouts || []);
    return {
      file: parsed?.file || { name: filePath.split("/").pop() || filePath, path: filePath },
      pagesCount: typeof parsed?.pagesCount === "number" ? parsed.pagesCount : pageLayouts.length,
      pageLayouts,
      createdAt: parsed?.createdAt || null,
      tracePath,
    };
  };

  app.get("/api/traces", async (req, res) => {
    try {
      const filePath = String(req.query?.path || "").trim();
      const tracePath = tracePathFor(filePath);
      if (!tracePath) return res.status(400).json({ error: "A valid uploaded file path is required." });
      const data: any = await readCompanionFile(tracePath);
      if (!data) return res.status(404).json({ error: "No saved trace boxes for this file yet." });
      const raw = Buffer.from(String(data.content || "").replace(/\n/g, ""), "base64").toString("utf-8");
      return res.json(parseStoredTrace(raw, filePath, tracePath));
    } catch (error: any) {
      console.error("[Trace Boxes Exception]", error);
      return res.status(500).json({ error: error.message || "An error occurred while working with the trace boxes." });
    }
  });

  app.post("/api/traces", async (req, res) => {
    try {
      const { token, ghOwner, ghRepo, ghHeaders } = roomGhConfigLike();
      if (!token) return res.status(500).json({ error: "GITHUB_TOKEN is not configured on the server." });
      const filePath = String(req.body?.filePath || "").trim();
      const tracePath = tracePathFor(filePath);
      if (!tracePath) return res.status(400).json({ error: "A valid uploaded file path is required." });
      const pagesInput = req.body?.pageLayouts || req.body?.pages;
      if (!Array.isArray(pagesInput)) return res.status(400).json({ error: "Trace box layouts are required." });
      const pages = compactTracePages(pagesInput);
      const pagesCount = typeof req.body?.pagesCount === "number" ? req.body.pagesCount : pages.length;
      const fileName = String(req.body?.fileName || filePath.split("/").pop() || "document.pdf");
      const traceData = { version: 1, pagesCount, pages };
      const compressed = gzipSync(Buffer.from(JSON.stringify(traceData), "utf-8") as any).toString("base64");
      const payload = {
        version: 2,
        kind: "trace-boxes",
        encoding: "gzip-base64",
        file: { name: fileName, path: filePath, size: typeof req.body?.fileSize === "number" ? req.body.fileSize : 0 },
        pagesCount,
        createdAt: new Date().toISOString(),
        data: compressed,
      };
      const payloadText = JSON.stringify(payload);
      if (Buffer.byteLength(payloadText, "utf-8") > 900000) {
        return res.status(413).json({ error: "The saved trace boxes are too large for one companion file." });
      }
      const content = Buffer.from(payloadText, "utf-8").toString("base64");
      // GitHub can return 409 when another commit lands on the branch while
      // this one is being created (or the file sha went stale). Re-read and retry.
      let putOk = false;
      let lastStatus = 0;
      let lastDetails = "";
      for (let attempt = 0; attempt < 3 && !putOk; attempt++) {
        const existing: any = await readCompanionFile(tracePath);
        const putRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${tracePath.split("/").map(encodeURIComponent).join("/")}`, {
          method: "PUT",
          headers: { ...ghHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ message: `Save trace boxes for ${fileName}`, content, ...(existing?.sha ? { sha: existing.sha } : {}) }),
        });
        if (putRes.ok) {
          putOk = true;
          break;
        }
        lastStatus = putRes.status;
        lastDetails = await putRes.text();
        if ((putRes.status !== 409 && putRes.status !== 422) || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
      if (!putOk) {
        return res.status(lastStatus || 500).json({ error: "Could not save the trace boxes.", details: lastDetails });
      }
      const itemsCount = pages.reduce((sum: number, page: any) => sum + (Array.isArray(page.items) ? page.items.length : 0), 0);
      return res.json({ ok: true, tracePath, createdAt: payload.createdAt, pagesCount, itemsCount });
    } catch (error: any) {
      console.error("[Trace Boxes Exception]", error);
      return res.status(500).json({ error: error.message || "An error occurred while working with the trace boxes." });
    }
  });

  // Rooms: Admin hosts a room from selected uploaded files; Guest joins with a 6-digit code
  const ROOMS_PATH = "rooms.json";
  const roomGhConfig = () => {
    const token = process.env.GITHUB_TOKEN;
    const ghOwner = process.env.GITHUB_OWNER || "Ramonskie1215";
    const ghRepo = process.env.GITHUB_REPO || "DweyAISummarization";
    const ghHeaders: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dwey-ai-summarization",
    };
    if (token) ghHeaders["Authorization"] = `Bearer ${token}`;
    return { token, ghOwner, ghRepo, ghHeaders };
  };
  const readRoomsStore = async () => {
    const { ghOwner, ghRepo, ghHeaders } = roomGhConfig();
    const res = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${ROOMS_PATH}`, { headers: ghHeaders });
    if (res.status === 404) return { rooms: [] as any[], sha: undefined as string | undefined };
    if (!res.ok) {
      const details = await res.text();
      throw new Error(`Could not read rooms (${res.status}): ${details}`);
    }
    const data: any = await res.json();
    const raw = Buffer.from(String(data.content || "").replace(/\n/g, ""), "base64").toString("utf-8");
    let parsed: any = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
    return { rooms: Array.isArray(parsed?.rooms) ? parsed.rooms : [], sha: data.sha as string | undefined };
  };
  const writeRoomsStore = async (rooms: any[], sha: string | undefined, message: string) => {
    const { ghOwner, ghRepo, ghHeaders } = roomGhConfig();
    const content = Buffer.from(JSON.stringify({ rooms }, null, 2) + "\n", "utf-8").toString("base64");
    const putRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${ROOMS_PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }),
    });
    if (!putRes.ok) {
      const details = await putRes.text();
      throw new Error(`Could not save room (${putRes.status}): ${details}`);
    }
    return putRes.json();
  };
  const normalizeRoomFiles = (input: any) => {
    if (!Array.isArray(input)) return [] as any[];
    const seen = new Set<string>();
    const out: any[] = [];
    for (const item of input) {
      const filePath = typeof item === "string" ? item : item?.path;
      if (!filePath || typeof filePath !== "string") continue;
      const cleanPath = filePath.trim();
      if (!cleanPath.startsWith("uploaded/")) continue;
      if (cleanPath.endsWith(".summary.json") || cleanPath.endsWith(".summary.md") || cleanPath.endsWith(".traces.json")) continue;
      if (seen.has(cleanPath)) continue;
      seen.add(cleanPath);
      const name = (typeof item === "object" && item?.name) || cleanPath.split("/").pop() || cleanPath;
      out.push({
        name: String(name),
        path: cleanPath,
        size: typeof item === "object" && typeof item?.size === "number" ? item.size : 0,
        uploadedAt: typeof item === "object" && item?.uploadedAt ? String(item.uploadedAt) : null,
      });
    }
    return out;
  };


  const publicLead = (lead: any) => {
    if (!lead || !lead.id) return null;
    const page = Number(lead.page);
    return {
      id: String(lead.id),
      name: lead.name ? String(lead.name) : null,
      view: lead.view === "document" ? "document" : "files",
      filePath: lead.filePath ? String(lead.filePath) : null,
      fileName: lead.fileName ? String(lead.fileName) : null,
      page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
      updatedAt: lead.updatedAt || null,
      live: lead.live !== false,
    };
  };

  const publicRoom = (room: any) => {
    const startedAt = room?.startedAt || room?.createdAt || null;
    return {
      code: String(room?.code || ""),
      createdAt: startedAt,
      startedAt,
      endedAt: room?.endedAt || null,
      files: Array.isArray(room?.files) ? room.files : [],
      lead: publicLead(room?.lead),
    };
  };

  app.get("/api/rooms", async (req, res) => {
    try {
      const code = String(req.query?.code || "").trim();
      const { rooms } = await readRoomsStore();
      if (!code) {
        const history = [...rooms].sort((a: any, b: any) => String(b?.startedAt || b?.createdAt || "").localeCompare(String(a?.startedAt || a?.createdAt || ""))).map(publicRoom);
        return res.json({ rooms: history });
      }
      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Enter a valid 6-digit room code." });
      }
      const room = rooms.find((r: any) => String(r?.code) === code);
      if (!room) return res.status(404).json({ error: "Room not found. Check the code and try again." });
      if (room.endedAt) return res.status(410).json({ error: "This room has ended." });
      return res.json(publicRoom(room));
    } catch (error: any) {
      console.error("[Rooms Exception]", error);
      return res.status(500).json({ error: error.message || "An error occurred while working with rooms." });
    }
  });

  app.post("/api/rooms", async (req, res) => {
    try {
      const { token } = roomGhConfig();
      if (!token) return res.status(500).json({ error: "GITHUB_TOKEN is not configured on the server." });
      if (String(req.body?.action || "") === "end") {
        const code = String(req.body?.code || "").trim();
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter a valid 6-digit room code." });
        const { rooms, sha } = await readRoomsStore();
        const idx = rooms.findIndex((r: any) => String(r?.code) === code);
        if (idx === -1) return res.status(404).json({ error: "Room not found. Check the code and try again." });
        if (!rooms[idx].endedAt) {
          rooms[idx] = { ...rooms[idx], endedAt: new Date().toISOString() };
          await writeRoomsStore(rooms, sha, `End room ${code}`);
        }
        return res.json(publicRoom(rooms[idx]));
      }
      const action = String(req.body?.action || "");
      if (action === "lead-claim" || action === "lead-nav" || action === "lead-stop") {
        const code = String(req.body?.code || "").trim();
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter a valid 6-digit room code." });
        const leadId = String(req.body?.leadId || "").trim();
        if (!leadId) return res.status(400).json({ error: "A guest id is required to lead." });
        const { rooms, sha } = await readRoomsStore();
        const idx = rooms.findIndex((r: any) => String(r?.code) === code);
        if (idx === -1) return res.status(404).json({ error: "Room not found. Check the code and try again." });
        if (rooms[idx].endedAt) return res.status(410).json({ error: "This room has ended." });
        const now = new Date().toISOString();
        const roomFiles = Array.isArray(rooms[idx].files) ? rooms[idx].files : [];

        if (action === "lead-claim") {
          rooms[idx] = {
            ...rooms[idx],
            lead: {
              id: leadId,
              name: req.body?.leadName ? String(req.body.leadName) : null,
              view: "files",
              filePath: null,
              fileName: null,
              page: 1,
              updatedAt: now,
              live: true,
            },
          };
          await writeRoomsStore(rooms, sha, `Room ${code} lead started`);
          return res.json(publicRoom(rooms[idx]));
        }

        const currentLead = rooms[idx].lead;
        if (!currentLead || String(currentLead.id) !== leadId) {
          return res.status(403).json({ error: "You are not the current Lead of this room." });
        }

        if (action === "lead-stop") {
          rooms[idx] = { ...rooms[idx], lead: null };
          await writeRoomsStore(rooms, sha, `Room ${code} lead stopped`);
          return res.json(publicRoom(rooms[idx]));
        }

        const view = String(req.body?.view || "files") === "document" ? "document" : "files";
        let filePath: string | null = null;
        let fileName: string | null = null;
        if (view === "document") {
          filePath = String(req.body?.filePath || "").trim();
          const match = roomFiles.find((f: any) => String(f?.path) === filePath);
          if (!match) return res.status(400).json({ error: "The Lead can only open files shared in this room." });
          fileName = String(req.body?.fileName || match.name || filePath.split("/").pop() || "document.pdf");
        }
        const rawPage = Number(req.body?.page);
        const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
        rooms[idx] = {
          ...rooms[idx],
          lead: { ...currentLead, view, filePath, fileName, page, updatedAt: now, live: true },
        };
        await writeRoomsStore(rooms, sha, `Room ${code} lead navigated`);
        return res.json(publicRoom(rooms[idx]));
      }

      const files = normalizeRoomFiles(req.body?.files);
      if (files.length === 0) return res.status(400).json({ error: "Select at least one uploaded file for the room." });
      const { rooms, sha } = await readRoomsStore();
      const existing = new Set<string>(rooms.map((r: any) => String(r?.code)));
      let code = String(Math.floor(100000 + Math.random() * 900000));
      for (let i = 0; i < 20 && existing.has(code); i++) {
        code = String(Math.floor(100000 + Math.random() * 900000));
      }
      const now = new Date().toISOString();
      const room = { code, files, createdAt: now, startedAt: now, endedAt: null, lead: null };
      await writeRoomsStore([...rooms, room], sha, `Create room ${code}`);
      return res.json(publicRoom(room));
    } catch (error: any) {
      console.error("[Rooms Exception]", error);
      return res.status(500).json({ error: error.message || "An error occurred while working with rooms." });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite server in development mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Setting up Express in production mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server successfully started on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical server startup failure:", err);
});
