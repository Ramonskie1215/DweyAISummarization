const SUMMARY_SUFFIX = ".summary.json";

function ghConfig() {
  const token = process.env.GITHUB_TOKEN;
  const ghOwner = process.env.GITHUB_OWNER || "Ramonskie1215";
  const ghRepo = process.env.GITHUB_REPO || "DweyAISummarization";
  const ghHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "dwey-ai-summarization",
  };
  if (token) ghHeaders["Authorization"] = `Bearer ${token}`;
  return { token, ghOwner, ghRepo, ghHeaders };
}

function companionPathFor(filePath: string) {
  const clean = String(filePath || "").trim();
  if (!clean.startsWith("uploaded/") || clean.includes("..")) return null;
  if (clean.endsWith(SUMMARY_SUFFIX)) return clean;
  return `${clean}${SUMMARY_SUFFIX}`;
}

async function readFile(ghOwner: string, ghRepo: string, ghHeaders: Record<string, string>, path: string) {
  const res = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: ghHeaders });
  if (res.status === 404) return null;
  if (!res.ok) {
    const details = await res.text();
    throw new Error(`GitHub read failed (${res.status}): ${details}`);
  }
  return res.json();
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, ghOwner, ghRepo, ghHeaders } = ghConfig();

  try {
    if (req.method === 'GET') {
      const filePath = String(req.query?.path || "").trim();
      const companionPath = companionPathFor(filePath);
      if (!companionPath) return res.status(400).json({ error: "A valid uploaded file path is required." });
      const data: any = await readFile(ghOwner, ghRepo, ghHeaders, companionPath);
      if (!data) return res.status(404).json({ error: "No AI summary saved for this file yet." });
      const raw = Buffer.from(String(data.content || "").replace(/\n/g, ""), "base64").toString("utf-8");
      let parsed: any = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = { summary: raw }; }
      return res.status(200).json({
        file: parsed.file || { name: filePath.split("/").pop() || filePath, path: filePath },
        summary: parsed.summary || "",
        pagesCount: parsed.pagesCount || null,
        createdAt: parsed.createdAt || null,
        settings: parsed.settings || null,
        companionPath,
      });
    }

    if (req.method === 'POST') {
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
      const existing: any = await readFile(ghOwner, ghRepo, ghHeaders, companionPath);
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
      return res.status(200).json({ ok: true, companionPath, createdAt: payload.createdAt });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[Companion Summary Exception]", error);
    return res.status(500).json({ error: error.message || "An error occurred while working with the AI summary." });
  }
}
