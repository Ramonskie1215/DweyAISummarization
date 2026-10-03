import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

// Issues short-lived client tokens so the browser can upload large PDFs
// directly to Vercel Blob storage (uploads straight to storage bypass the
// 4.5 MB request-body limit of Vercel functions). The blob is only staging:
// /api/upload copies the file into the GitHub repo, then deletes the blob.
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 100 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // Nothing to do: the browser calls /api/upload with the blob URL next.
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (error: any) {
    console.error("[Blob Upload] Exception occurred:", error);
    return res.status(400).json({ error: error.message || "Could not start the large-file upload." });
  }
}
