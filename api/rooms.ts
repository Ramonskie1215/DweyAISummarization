const ROOMS_PATH = "rooms.json";

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

async function readRooms(ghOwner: string, ghRepo: string, ghHeaders: Record<string, string>) {
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
  const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
  return { rooms, sha: data.sha as string | undefined };
}

async function writeRooms(ghOwner: string, ghRepo: string, ghHeaders: Record<string, string>, rooms: any[], sha: string | undefined, message: string) {
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
}

function normalizeFiles(input: any) {
  if (!Array.isArray(input)) return [] as any[];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of input) {
    const path = typeof item === "string" ? item : item?.path;
    if (!path || typeof path !== "string") continue;
    const cleanPath = path.trim();
    if (!cleanPath.startsWith("uploaded/")) continue;
    if (cleanPath.endsWith(".summary.json") || cleanPath.endsWith(".summary.md")) continue;
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
}

function makeCode(existing: Set<string>) {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!existing.has(code)) return code;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function publicRoom(room: any) {
  const startedAt = room?.startedAt || room?.createdAt || null;
  return {
    code: String(room?.code || ""),
    createdAt: startedAt,
    startedAt,
    endedAt: room?.endedAt || null,
    files: Array.isArray(room?.files) ? room.files : [],
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
      const code = String(req.query?.code || "").trim();
      const { rooms } = await readRooms(ghOwner, ghRepo, ghHeaders);
      if (!code) {
        const history = [...rooms].sort((a: any, b: any) => String(b?.startedAt || b?.createdAt || "").localeCompare(String(a?.startedAt || a?.createdAt || ""))).map(publicRoom);
        return res.status(200).json({ rooms: history });
      }
      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Enter a valid 6-digit room code." });
      }
      const room = rooms.find((r: any) => String(r?.code) === code);
      if (!room) return res.status(404).json({ error: "Room not found. Check the code and try again." });
      if (room.endedAt) return res.status(410).json({ error: "This room has ended." });
      return res.status(200).json(publicRoom(room));
    }

    if (req.method === 'POST') {
      if (!token) return res.status(500).json({ error: "GITHUB_TOKEN is not configured on the server." });
      if (String(req.body?.action || "") === "end") {
        const code = String(req.body?.code || "").trim();
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter a valid 6-digit room code." });
        const { rooms, sha } = await readRooms(ghOwner, ghRepo, ghHeaders);
        const idx = rooms.findIndex((r: any) => String(r?.code) === code);
        if (idx === -1) return res.status(404).json({ error: "Room not found. Check the code and try again." });
        if (!rooms[idx].endedAt) {
          rooms[idx] = { ...rooms[idx], endedAt: new Date().toISOString() };
          await writeRooms(ghOwner, ghRepo, ghHeaders, rooms, sha, `End room ${code}`);
        }
        return res.status(200).json(publicRoom(rooms[idx]));
      }
      const files = normalizeFiles(req.body?.files);
      if (files.length === 0) return res.status(400).json({ error: "Select at least one uploaded file for the room." });
      const { rooms, sha } = await readRooms(ghOwner, ghRepo, ghHeaders);
      const existing = new Set<string>(rooms.map((r: any) => String(r?.code)));
      const code = makeCode(existing);
      const now = new Date().toISOString();
      const room = { code, files, createdAt: now, startedAt: now, endedAt: null };
      const nextRooms = [...rooms, room];
      await writeRooms(ghOwner, ghRepo, ghHeaders, nextRooms, sha, `Create room ${code}`);
      return res.status(200).json(publicRoom(room));
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("[Rooms Exception]", error);
    return res.status(500).json({ error: error.message || "An error occurred while working with rooms." });
  }
}
