
import { del } from "@vercel/blob";

// Large staged uploads can take a while to copy into GitHub; give the
// function room beyond the default timeout.
export const config = { maxDuration: 60 };

function getDateFolder(input?: string) {
  const candidate = String(input || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function listUploadedFiles(ghOwner: string, ghRepo: string, ghHeaders: Record<string, string>) {
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
}

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

  // Admin Mode: list the backup copies stored in /uploaded
  if (req.method === 'GET') {
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

      const files = await listUploadedFiles(ghOwner, ghRepo, ghHeaders);
      const filesWithDates = await Promise.all(
        files.map(async (file: any) => {
          try {
            const commitRes = await fetch(
              `https://api.github.com/repos/${ghOwner}/${ghRepo}/commits?path=${encodeURIComponent(file.path)}&per_page=1`,
              { headers: ghHeaders }
            );
            if (!commitRes.ok) return { ...file, uploadedAt: null };
            const commits = await commitRes.json();
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
      console.error("[Vercel Uploaded Files Exception]", error);
      return res.status(500).json({ error: error.message || "An error occurred while listing the uploaded files." });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filename, content, blobUrl, dateFolder } = req.body || {};
    let base64Content = typeof content === "string" ? content : "";
    if (blobUrl) {
      // Large-file path: the browser staged the PDF in Vercel Blob (uploads go
      // straight to storage, bypassing the 4.5 MB function body limit); fetch
      // it here server-to-server, then fall through to the same GitHub commit.
      let blobHost = "";
      try { blobHost = new URL(String(blobUrl)).hostname; } catch (_) { blobHost = ""; }
      if (!blobHost.endsWith(".blob.vercel-storage.com")) {
        return res.status(400).json({ error: "Invalid blobUrl." });
      }
      const blobRes = await fetch(String(blobUrl));
      if (!blobRes.ok) {
        return res.status(502).json({ error: "Could not read the staged upload." });
      }
      base64Content = Buffer.from(await blobRes.arrayBuffer()).toString("base64");
    }
    if (!filename || !base64Content) {
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
    const folder = getDateFolder(dateFolder);
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
        content: base64Content,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      console.error(`[Upload Backup] GitHub responded with status ${putRes.status}: ${errText}`);
      return res.status(putRes.status).json({ error: "GitHub upload failed.", details: errText });
    }

    const putData = await putRes.json();
    if (blobUrl) {
      try { await del(String(blobUrl)); } catch (_) { /* staging cleanup is best-effort */ }
    }
    return res.status(200).json({ ok: true, path: repoPath, commit: putData.commit?.sha });
  } catch (error: any) {
    console.error("[Upload Backup] Exception occurred:", error);
    return res.status(500).json({ error: error.message || "Upload backup failed." });
  }
}
