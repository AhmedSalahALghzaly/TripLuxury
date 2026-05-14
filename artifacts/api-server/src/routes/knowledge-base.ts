import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { query } from "../server-db";
import { getCurrentUser, getUserRole, requireAuth } from "../server-auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { setObjectAclPolicy, ObjectPermission } from "../lib/objectAcl";

function genId() {
  return randomUUID();
}

/**
 * Validates a URL against SSRF: only https/http, host must resolve to a public IP.
 * Blocks loopback, link-local, private, and reserved ranges (IPv4 + IPv6).
 */
async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }
  const hostname = parsed.hostname;
  // Block numeric IPv4/IPv6 literals without DNS lookup
  if (ipaddr.isValid(hostname)) {
    const addr = ipaddr.parse(hostname);
    const range = addr.range();
    if (range !== "unicast" && range !== "broadcast") {
      throw new Error("Access to private/reserved IP addresses is not allowed");
    }
    return;
  }
  // Resolve hostname and check all returned addresses
  let lookupResults: { address: string; family: number }[];
  try {
    lookupResults = await dns.lookup(hostname, { all: true }) as { address: string; family: number }[];
  } catch {
    throw new Error("Could not resolve hostname");
  }
  for (const { address } of lookupResults) {
    if (!ipaddr.isValid(address)) continue;
    const addr = ipaddr.parse(address);
    const range = addr.range();
    if (range !== "unicast" && range !== "broadcast") {
      throw new Error("Access to private/reserved IP addresses is not allowed");
    }
  }
}

async function requireOwner(req: Request, res: Response): Promise<boolean> {
  const user = (req as any).user;
  const role = await getUserRole(user.email);
  if (role !== "owner") {
    res.status(403).json({ detail: "Owner only" });
    return false;
  }
  return true;
}

export function createKnowledgeBaseRouter(
  broadcastToUsers?: (userIds: Iterable<string>, msg: object) => void,
) {
  const router = Router();
  const broadcastToAdmins = broadcastToUsers ?? (() => {});

  /**
   * KB content is owner/admin-only. Never use a global broadcast for KB
   * payloads — fan out only to admin/owner user IDs so logged-out and
   * customer sockets never receive private knowledge-base content.
   */
  async function broadcast(msg: object) {
    try {
      const admins = await query(
        "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
      );
      const ids = admins.rows.map((r: any) => r.id).filter(Boolean);
      if (ids.length > 0) broadcastToAdmins(ids, msg);
    } catch {
      // Best-effort broadcast — never fail the request if WS fanout fails.
    }
  }

  router.get(
    "/knowledge-base",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        if (!(await requireOwner(req, res))) return;
        const { type, search } = req.query;

        // Flatten metadata fields and join latest training status so the client
        // receives all relevant fields at the top level without needing to parse
        // the metadata JSON object separately.
        let sql = `
          SELECT
            kb.id,
            kb.type,
            kb.title,
            kb.content,
            kb.file_url,
            kb.metadata,
            kb.created_by,
            kb.created_at,
            kb.updated_at,
            -- flattened metadata fields
            kb.metadata->>'url'         AS url,
            kb.metadata->>'hostname'    AS hostname,
            kb.metadata->>'question'    AS question,
            kb.metadata->>'answer'      AS answer,
            kb.metadata->>'category'    AS category,
            kb.metadata->>'file_name'   AS file_name,
            kb.metadata->>'file_type'   AS file_type,
            (CASE WHEN kb.metadata->>'file_size' IS NOT NULL AND kb.metadata->>'file_size' ~ '^[0-9]+$'
                  THEN (kb.metadata->>'file_size')::bigint
                  ELSE NULL END)        AS file_size,
            kb.metadata->>'videoId'     AS video_id,
            kb.metadata->>'thumbnail'   AS thumbnail,
            kb.metadata->>'channelName' AS channel_name,
            kb.metadata->>'duration'    AS duration,
            kb.metadata->'tags'         AS tags,
            -- latest training status from ai_training_logs
            atl.status
          FROM knowledge_base kb
          LEFT JOIN LATERAL (
            SELECT status
            FROM ai_training_logs
            WHERE knowledge_id = kb.id
            ORDER BY created_at DESC
            LIMIT 1
          ) atl ON true
          WHERE 1=1`;
        const params: unknown[] = [];

        if (type) {
          params.push(type);
          sql += ` AND kb.type = $${params.length}`;
        }
        if (search) {
          params.push(`%${search}%`);
          sql += ` AND (kb.title ILIKE $${params.length} OR kb.content ILIKE $${params.length})`;
        }
        sql += ` ORDER BY kb.created_at DESC`;

        const result = await query(sql, params);
        return res.json({ items: result.rows });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.post(
    "/knowledge-base/text",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        if (!(await requireOwner(req, res))) return;
        const user = (req as any).user;
        const { title, content } = req.body;

        if (!content || !content.trim()) {
          return res.status(400).json({ detail: "Content is required" });
        }
        if (content.length > 10000) {
          return res.status(400).json({ detail: "Content must be under 10,000 characters" });
        }

        const id = genId();
        const result = await query(
          `INSERT INTO knowledge_base (id, type, title, content, created_by)
           VALUES ($1, 'text', $2, $3, $4) RETURNING *`,
          [id, title || null, content, user.id],
        );

        await query(
          `INSERT INTO ai_training_logs (id, knowledge_id, status) VALUES ($1, $2, 'pending')`,
          [genId(), id],
        );

        broadcast({ type: "knowledge_base_created", data: result.rows[0] });
        return res.status(201).json({ item: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Step 1: Request a presigned upload URL for a knowledge base file
  router.post(
    "/knowledge-base/file/upload-url",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        if (!(await requireOwner(req, res))) return;
        const { file_name, file_type, file_size } = req.body;
        if (!file_name || !file_type) {
          return res.status(400).json({ detail: "file_name and file_type are required" });
        }
        const storage = new ObjectStorageService();
        const uploadURL = await storage.getObjectEntityUploadURL();
        const objectPath = storage.normalizeObjectEntityPath(uploadURL);
        return res.json({ uploadURL, objectPath });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Step 2: Register the uploaded file in the knowledge base
  router.post(
    "/knowledge-base/file",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        if (!(await requireOwner(req, res))) return;
        const user = (req as any).user;
        const { title, object_path, file_name, file_type, file_size, content } = req.body;

        if (!object_path && !file_name) {
          return res.status(400).json({ detail: "object_path or file_name is required" });
        }

        // Build the serving URL from the object path (objectPath = '/objects/<uuid>')
        const fileUrl = object_path
          ? `/api/storage${object_path.startsWith("/") ? "" : "/"}${object_path}`
          : null;

        const id = genId();
        const result = await query(
          `INSERT INTO knowledge_base (id, type, title, content, file_url, metadata, created_by)
           VALUES ($1, 'file', $2, $3, $4, $5, $6) RETURNING *`,
          [
            id,
            title || file_name || "Uploaded File",
            content || null,
            fileUrl,
            JSON.stringify({ file_name, file_type, file_size, object_path }),
            user.id,
          ],
        );

        await query(
          `INSERT INTO ai_training_logs (id, knowledge_id, status) VALUES ($1, $2, 'pending')`,
          [genId(), id],
        );

        // Set ACL policy on the uploaded object: private, owned by the uploader
        if (object_path) {
          try {
            const storage = new ObjectStorageService();
            const objectFile = await storage.getObjectEntityFile(object_path);
            await setObjectAclPolicy(objectFile, {
              owner: user.id,
              visibility: "private",
            });
          } catch {
            // ACL set is best-effort; KB record was already saved
          }
        }

        broadcast({ type: "knowledge_base_created", data: result.rows[0] });
        return res.status(201).json({ item: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.post(
    "/knowledge-base/link",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        if (!(await requireOwner(req, res))) return;
        const user = (req as any).user;
        const { url } = req.body;

        if (!url) {
          return res.status(400).json({ detail: "Valid URL is required" });
        }
        try {
          await assertSafeUrl(url);
        } catch (ssrfErr: any) {
          return res.status(400).json({ detail: ssrfErr.message });
        }

        let title = url;
        let description = "";
        let metadata: any = { url };

        try {
          const resp = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 AlGhazalyBot/1.0" },
            signal: AbortSignal.timeout(8000),
            redirect: "follow",
          });
          const html = await resp.text();
          const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
          const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i);
          title = titleMatch?.[1]?.trim() || url;
          description = descMatch?.[1]?.trim() || "";
          const { hostname } = new URL(url);
          metadata = { url, hostname, description };
        } catch {
          metadata = { url };
        }

        const id = genId();
        const result = await query(
          `INSERT INTO knowledge_base (id, type, title, content, metadata, created_by)
           VALUES ($1, 'link', $2, $3, $4, $5) RETURNING *`,
          [id, title, description, JSON.stringify(metadata), user.id],
        );

        await query(
          `INSERT INTO ai_training_logs (id, knowledge_id, status) VALUES ($1, $2, 'pending')`,
          [genId(), id],
        );

        broadcast({ type: "knowledge_base_created", data: result.rows[0] });
        return res.status(201).json({ item: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.post(
    "/knowledge-base/qa",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        if (!(await requireOwner(req, res))) return;
        const user = (req as any).user;
        const { question, answer, category, tags } = req.body;

        if (!question || !answer) {
          return res.status(400).json({ detail: "Question and answer are required" });
        }

        const id = genId();
        const content = `Q: ${question}\nA: ${answer}`;
        const result = await query(
          `INSERT INTO knowledge_base (id, type, title, content, metadata, created_by)
           VALUES ($1, 'qa', $2, $3, $4, $5) RETURNING *`,
          [
            id,
            question,
            content,
            JSON.stringify({ question, answer, category: category || null, tags: tags || [] }),
            user.id,
          ],
        );

        await query(
          `INSERT INTO ai_training_logs (id, knowledge_id, status) VALUES ($1, $2, 'pending')`,
          [genId(), id],
        );

        broadcast({ type: "knowledge_base_created", data: result.rows[0] });
        return res.status(201).json({ item: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.post(
    "/knowledge-base/youtube",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        if (!(await requireOwner(req, res))) return;
        const user = (req as any).user;
        const { url, duration } = req.body;

        if (!url || !(url.includes("youtube.com") || url.includes("youtu.be"))) {
          return res.status(400).json({ detail: "Valid YouTube URL is required" });
        }
        // YouTube URLs must resolve to youtube.com/youtu.be (public IPs only)
        try {
          await assertSafeUrl(url);
        } catch (ssrfErr: any) {
          return res.status(400).json({ detail: ssrfErr.message });
        }

        let videoId = "";
        try {
          const parsed = new URL(url);
          videoId =
            parsed.searchParams.get("v") ||
            parsed.pathname.split("/").pop() ||
            "";
        } catch {}

        let title = url;
        let description = "";
        let thumbnail = "";
        let channelName = "";

        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
          const data: any = await resp.json();
          title = data.title || url;
          channelName = data.author_name || "";
          thumbnail = videoId
            ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
            : "";
          description = `Video by ${channelName}`;
        } catch {
          thumbnail = videoId
            ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
            : "";
        }

        const id = genId();
        const result = await query(
          `INSERT INTO knowledge_base (id, type, title, content, metadata, created_by)
           VALUES ($1, 'youtube', $2, $3, $4, $5) RETURNING *`,
          [
            id,
            title,
            description || title,
            JSON.stringify({ url, videoId, thumbnail, channelName, duration: duration || null }),
            user.id,
          ],
        );

        await query(
          `INSERT INTO ai_training_logs (id, knowledge_id, status) VALUES ($1, $2, 'pending')`,
          [genId(), id],
        );

        broadcast({ type: "knowledge_base_created", data: result.rows[0] });
        return res.status(201).json({ item: result.rows[0] });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  router.delete(
    "/knowledge-base/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        if (!(await requireOwner(req, res))) return;
        const { id } = req.params;
        await query(`DELETE FROM knowledge_base WHERE id = $1`, [id]);
        broadcast({ type: "knowledge_base_deleted", data: { id } });
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  return router;
}
