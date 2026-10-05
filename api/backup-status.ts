// Backup readiness check for the Admin Uploaded Files view. It never returns
// secret values — only whether the required server settings are present and
// reachable — so the user can confirm large-PDF backups are ready before
// uploading instead of finding out from a silent fire-and-forget failure.
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  return res.status(200).json({
    ready: github.ok && blob.ok,
    checkedAt,
    github,
    blob,
  });
}
