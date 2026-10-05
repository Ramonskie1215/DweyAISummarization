import {
  handleUpload,
  handleUploadPresigned,
  type HandleUploadBody,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";

// Issues short-lived upload permissions so the browser can upload large PDFs
// directly to Vercel Blob storage (uploads straight to storage bypass the
// 4.5 MB request-body limit of Vercel functions). The blob is only staging:
// /api/upload copies the file into the GitHub repo, then deletes the blob.
//
// Supports both Vercel Blob connection styles:
// - newer store connections (BLOB_STORE_ID + OIDC) via presigned URLs
// - classic read-write-token connections (BLOB_READ_WRITE_TOKEN)
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
    if (req.body?.type === "blob.generate-presigned-url") {
      const jsonResponse = await handleUploadPresigned({
        body: req.body as HandleUploadPresignedBody,
        request: req,
        getSignedToken: async (pathname) => {
          const token = await issueSignedToken({
            pathname,
            operations: ["put"],
            allowedContentTypes: ["application/pdf"],
            maximumSizeInBytes: 100 * 1024 * 1024,
            validUntil: Date.now() + 10 * 60 * 1000,
          });
          return { token, urlOptions: { addRandomSuffix: true } };
        },
      });
      return res.status(200).json(jsonResponse);
    }

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
