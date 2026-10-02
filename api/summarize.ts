export default async function handler(req: any, res: any) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, model, prompt, length, style, language, format } = req.body || {};
    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({ error: "Text content is required for summarization." });
    }

    // Default or custom selected model
    const selectedModel = model || "deepseek/deepseek-v4-flash-free";

    // Build structured guidelines based on length and style requested
    const summaryLengthText = length || "Medium";
    const summaryStyleText = style || "Professional";

    const systemPrompt = "You are an expert document assistant. You analyze extracted PDF text and produce beautifully formatted, highly informative summaries using clear Markdown hierarchy. Focus on accuracy and structure.";
    
    const fixedPageRangePrompt = format === "page-ranges" ? `You are given text extracted from a PDF, split into pages with [Page N] markers. Produce a summary in this exact Markdown format:

## General Summary
Give a clear general summary of the whole file: what it is about, its main purpose, and the most important points.

## Page Range Breakdown
Look at the context of each page. If the file has different contexts/topics in different parts, group consecutive pages that share the same context into page ranges (for example, Pages 1-3, Pages 4-6) and describe what is on that specific range of pages. If the whole file shares one context, write a single entry for Pages 1 to the last page.
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

    const apiKey = process.env.APMIX_API_KEY || "apx_live_XuemnuQhPPjDoWqkq19wVTgM1Z2AvUIqWxALwjQM";

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
      return res.status(response.status).json({
        error: `The AI service responded with error status ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ error: "No content was returned in the AI response." });
    }

    return res.status(200).json({ summary: content });
  } catch (error: any) {
    console.error("[Vercel Proxy Exception] Exception occurred:", error);
    return res.status(500).json({ error: error.message || "An error occurred while communicating with the AI service." });
  }
}
