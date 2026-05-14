import { createClient } from "@supabase/supabase-js";
import { clog } from "./console-shim";
import { randomUUID } from "crypto";

const SUPABASE_URL = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"] || "";
const SUPABASE_SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["VITE_SUPABASE_ANON_KEY"] || "";

const supabaseStorage = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const BUCKET_NAME = "app-storage";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

interface StorageFile {
  bucket: string;
  path: string;
  metadata?: Record<string, string>;
}

export class ObjectStorageService {
  constructor() {}

  private async ensureBucket(): Promise<void> {
    const { data } = await supabaseStorage.storage.getBucket(BUCKET_NAME);
    if (!data) {
      await supabaseStorage.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: 52428800, // 50MB
      });
    }
  }

  async searchPublicObject(filePath: string): Promise<StorageFile | null> {
    const { data } = await supabaseStorage.storage
      .from(BUCKET_NAME)
      .list(filePath.split("/").slice(0, -1).join("/"), {
        search: filePath.split("/").pop() || "",
      });

    if (data && data.length > 0) {
      return { bucket: BUCKET_NAME, path: filePath };
    }
    return null;
  }

  async downloadObject(file: StorageFile, _cacheTtlSec: number = 3600): Promise<Response> {
    const { data, error } = await supabaseStorage.storage
      .from(file.bucket)
      .download(file.path);

    if (error || !data) {
      throw new ObjectNotFoundError();
    }

    const headers: Record<string, string> = {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": `public, max-age=${_cacheTtlSec}`,
      "Content-Length": String(data.size),
    };

    return new Response(data, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    await this.ensureBucket();
    const objectId = randomUUID();
    const path = `uploads/${objectId}`;

    const { data, error } = await supabaseStorage.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(path);

    if (error || !data) {
      throw new Error(`Failed to create upload URL: ${error?.message}`);
    }

    return data.signedUrl;
  }

  async getObjectEntityFile(objectPath: string): Promise<StorageFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const entityId = objectPath.slice("/objects/".length);
    const path = entityId;

    const { data } = await supabaseStorage.storage
      .from(BUCKET_NAME)
      .list(path.split("/").slice(0, -1).join("/"), {
        search: path.split("/").pop() || "",
      });

    if (!data || data.length === 0) {
      throw new ObjectNotFoundError();
    }

    return { bucket: BUCKET_NAME, path };
  }

  async deleteObjectByUrl(rawUrl: string): Promise<boolean> {
    if (!rawUrl) return false;
    try {
      const normalized = this.normalizeObjectEntityPath(rawUrl);
      let path: string;
      if (normalized.startsWith("/objects/")) {
        path = normalized.slice("/objects/".length);
      } else {
        path = normalized.replace(/^\//, "");
      }

      const { error } = await supabaseStorage.storage
        .from(BUCKET_NAME)
        .remove([path]);

      return !error;
    } catch (err) {
      clog.warn("[objectStorage] deleteObjectByUrl failed:", (err as any)?.message);
    }
    return false;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("/objects/") || rawPath.startsWith("/public-objects/")) {
      return rawPath;
    }

    if (rawPath.includes(SUPABASE_URL) || rawPath.includes("supabase.co/storage")) {
      try {
        const url = new URL(rawPath);
        const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)/);
        if (match) {
          return `/objects/${match[1]}`;
        }
      } catch {}
    }

    return rawPath;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    _aclPolicy: { owner: string; visibility: "public" | "private" },
  ): Promise<string> {
    return this.normalizeObjectEntityPath(rawPath);
  }

  async canAccessObjectEntity({
    userId: _userId,
    objectFile: _objectFile,
    requestedPermission: _requestedPermission,
  }: {
    userId?: string;
    objectFile: StorageFile;
    requestedPermission?: string;
  }): Promise<boolean> {
    return true;
  }

  async getObjectEntityURLPair(): Promise<{
    uploadURL: string;
    downloadURL: string;
    objectPath: string;
  }> {
    await this.ensureBucket();
    const objectId = randomUUID();
    const path = `uploads/${objectId}`;

    const { data: uploadData, error: uploadError } = await supabaseStorage.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(path);

    if (uploadError || !uploadData) {
      throw new Error(`Failed to create upload URL: ${uploadError?.message}`);
    }

    const { data: downloadData } = supabaseStorage.storage
      .from(BUCKET_NAME)
      .getPublicUrl(path);

    const uploadURL = uploadData.signedUrl;
    const downloadURL = downloadData.publicUrl;
    const objectPath = `/objects/${path}`;

    return { uploadURL, downloadURL, objectPath };
  }
}

// Legacy export for backup/restore scripts compatibility
export const objectStorageClient = {
  bucket(name: string) {
    const bucketId = name || BUCKET_NAME;
    return {
      async getFiles(opts?: { prefix?: string }) {
        const { data } = await supabaseStorage.storage
          .from(bucketId)
          .list(opts?.prefix || "");
        const files = (data || []).map((f: any) => ({
          name: opts?.prefix ? `${opts.prefix}/${f.name}` : f.name,
          metadata: {
            timeCreated: f.created_at,
            updated: f.updated_at || f.created_at,
            size: f.metadata?.size ?? 0,
          },
          delete: async () => {
            const path = opts?.prefix ? `${opts.prefix}/${f.name}` : f.name;
            await supabaseStorage.storage.from(bucketId).remove([path]);
          },
          download: async ({ destination }: { destination: string }) => {
            const path = opts?.prefix ? `${opts.prefix}/${f.name}` : f.name;
            const { data: blob } = await supabaseStorage.storage
              .from(bucketId)
              .download(path);
            if (blob) {
              const { writeFileSync } = await import("node:fs");
              const buffer = Buffer.from(await blob.arrayBuffer());
              writeFileSync(destination, buffer);
            }
          },
        }));
        return [files];
      },
      async upload(localPath: string, opts?: { destination?: string; contentType?: string; metadata?: any }) {
        const { readFileSync } = await import("node:fs");
        const buffer = readFileSync(localPath);
        const dest = opts?.destination || localPath;
        await supabaseStorage.storage
          .from(bucketId)
          .upload(dest, buffer, {
            contentType: opts?.contentType || "application/gzip",
            upsert: true,
          });
      },
      file(objectName: string) {
        return {
          name: objectName,
          async save(data: Buffer, opts?: { contentType?: string }) {
            await supabaseStorage.storage
              .from(bucketId)
              .upload(objectName, data, {
                contentType: opts?.contentType || "application/octet-stream",
                upsert: true,
              });
          },
          async download({ destination }: { destination: string }) {
            const { data: blob } = await supabaseStorage.storage
              .from(bucketId)
              .download(objectName);
            if (blob) {
              const { writeFileSync } = await import("node:fs");
              const buffer = Buffer.from(await blob.arrayBuffer());
              writeFileSync(destination, buffer);
            }
          },
          async delete() {
            await supabaseStorage.storage.from(bucketId).remove([objectName]);
          },
        };
      },
    };
  },
};
