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
