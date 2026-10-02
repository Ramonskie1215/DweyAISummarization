import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

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

  // Secure API Proxy endpoint to process text with deepseek/deepseek-v4-flash-free on api.apmix.ai
  app.post("/api/summarize", async (req, res) => {
    try {
      const { text, model, prompt, length, style, language } = req.body;
      if (!text || typeof text !== "string" || text.trim() === "") {
        return res.status(400).json({ error: "Text content is required for summarization." });
      }

      // Default or custom selected model
      const selectedModel = model || "deepseek/deepseek-v4-flash-free";

      // Build structured guidelines based on length and style requested
      const summaryLengthText = length || "Medium";
      const summaryStyleText = style || "Professional";

      const systemPrompt = "You are an expert document assistant. You analyze extracted PDF text and produce beautifully formatted, highly informative summaries using clear Markdown hierarchy. Focus on accuracy and structure.";
      
      const basePrompt = prompt || `You are given a text extracted from a PDF. Please read it thoroughly and produce a highly professional, beautifully structured markdown summary.

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

      const apiKey = process.env.APMIX_API_KEY || "apx_live_XuemnuQhPPjDoWqkq19wVTgM1Z2AvUIqWxALwjQM";

      console.log(`[Proxy Request] Forwarding to api.apmix.ai with model: ${selectedModel}`);

      const response = await fetch("https://api.apmix.ai/v1/chat/completions", {
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

      const listRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/uploaded`, { headers: ghHeaders });
      if (listRes.status === 404) {
        return res.status(200).json({ files: [] });
      }
      if (!listRes.ok) {
        const details = await listRes.text();
        return res.status(listRes.status).json({ error: "Could not list the uploaded files.", details });
      }
      const items: any = await listRes.json();
      const files = (Array.isArray(items) ? items : [])
        .filter((it: any) => it && it.type === "file")
        .map((it: any) => ({
          name: it.name,
          size: it.size,
          path: it.path,
          downloadUrl: it.download_url || null,
          htmlUrl: it.html_url || null,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
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

  // Backup endpoint: commits a copy of an uploaded PDF to the repo's /uploaded folder via the GitHub API
  app.post("/api/upload", async (req, res) => {
    try {
      const { filename, content } = req.body;
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
      const repoPath = `uploaded/${safeName}`;

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
      return res.json({ ok: true, path: repoPath, commit: putData.commit?.sha });
    } catch (error: any) {
      console.error("[Upload Backup] Exception occurred:", error);
      return res.status(500).json({ error: error.message || "Upload backup failed." });
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
