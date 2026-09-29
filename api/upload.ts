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
    const { filename, content } = req.body || {};
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
    return res.status(200).json({ ok: true, path: repoPath, commit: putData.commit?.sha });
  } catch (error: any) {
    console.error("[Upload Backup] Exception occurred:", error);
    return res.status(500).json({ error: error.message || "Upload backup failed." });
  }
}
