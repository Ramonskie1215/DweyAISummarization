import { gunzipSync, gzipSync } from "node:zlib";

const TRACE_SUFFIX = ".traces.json";

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

function tracePathFor(filePath: string) {
  const clean = String(filePath || "").trim();
  if (!clean.startsWith("uploaded/") || clean.includes("..")) return null;
  if (clean.endsWith(TRACE_SUFFIX)) return clean;
  return `${clean}${TRACE_SUFFIX}`;
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

function roundTrace(value: any) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

function compactTracePages(input: any) {
  if (!Array.isArray(input)) return [] as any[];
  return input
    .map((page: any) => {
      const items = Array.isArray(page?.items) ? page.items : [];
      return {
        width: roundTrace(page?.width),
        height: roundTrace(page?.height),
        items: items
          .map((item: any) => {
            if (Array.isArray(item)) {
              return [String(item[0] || ""), roundTrace(item[1]), roundTrace(item[2]), roundTrace(item[3]), roundTrace(item[4])];
            }
            return [String(item?.str || ""), roundTrace(item?.x), roundTrace(item?.y), roundTrace(item?.width), roundTrace(item?.height)];
          })
          .filter((item: any[]) => String(item[0] || "").trim() !== ""),
      };
    })
    .filter((page: any) => page.width > 0 && page.height > 0);
}

function expandTracePages(input: any) {
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
}

function parseStoredTrace(raw: string, filePath: string, tracePath: string) {
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
      const tracePath = tracePathFor(filePath);
      if (!tracePath) return res.status(400).json({ error: "A valid uploaded file path is required." });
      const data: any = await readFile(ghOwner, ghRepo, ghHeaders, tracePath);
      if (!data) return res.status(404).json({ error: "No saved trace boxes for this file yet." });
      const raw = Buffer.from(String(data.content || "").replace(/\n/g, ""), "base64").toString("utf-8");
      return res.status(200).json(parseStoredTrace(raw, filePath, tracePath));
    }

    if (req.method === 'POST') {
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
        const existing: any = await readFile(ghOwner, ghRepo, ghHeaders, tracePath);
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
      return res.status(200).json({ ok: true, tracePath, createdAt: payload.createdAt, pagesCount, itemsCount });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[Trace Boxes Exception]", error);
    return res.status(500).json({ error: error.message || "An error occurred while working with the trace boxes." });
  }
}
