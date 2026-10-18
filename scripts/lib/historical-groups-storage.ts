/**
 * Private storage of the official archives (lot 5D).
 *
 * A snapshot is only as good as the original it can be rebuilt from, and a row must never reference a
 * file nobody can restore (architecture 8.1, rule 10). So an archive is deposited BEFORE any row is
 * written, addressed by its SHA-256 (the name is the content: nothing is ever overwritten), read back
 * and hashed again after the upload, and an INDEPENDENT offline copy must exist in another folder.
 * Any doubt stops the import.
 *
 * The storage is a small interface. The Vercel Blob adapter uses private access only (`access:
 * 'private'`, no random suffix, no overwrite); the tests use an in-memory store.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type StorageKind = "BLOB_PRIVATE" | "LOCAL_OFFLINE";

export interface ArtifactStore {
  kind: StorageKind;
  /** Writes under `storageRef`. Never overwrites: a second write of an existing ref must throw. */
  put(storageRef: string, bytes: Buffer): Promise<void>;
  /** The bytes under `storageRef`, or `null` when there is nothing there. */
  read(storageRef: string): Promise<Buffer | null>;
}

export class StorageUnavailableError extends Error {
  constructor(detail: string) {
    super(`Private storage unavailable: ${detail}`);
    this.name = "StorageUnavailableError";
  }
}

export class StorageIntegrityError extends Error {
  constructor(detail: string) {
    super(`Private storage integrity: ${detail}`);
    this.name = "StorageIntegrityError";
  }
}

export const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** The reference of an archive in the store: its hash is its name. */
export const storageRefOf = (sha256: string): string => {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("not a SHA-256");
  return `historical-groups/${sha256}.zip`;
};

// ---------------------------------------------------------------------------
// Vercel Blob (private)
// ---------------------------------------------------------------------------

export interface BlobSdk {
  put(
    pathname: string,
    body: Buffer,
    options: {
      access: "private";
      addRandomSuffix: false;
      allowOverwrite: false;
      contentType: string;
      token: string;
    }
  ): Promise<unknown>;
  get(
    pathname: string,
    options: { access: "private"; useCache: false; token: string }
  ): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export function createBlobStore(sdk: BlobSdk, token: string | undefined): ArtifactStore {
  if (!token) throw new StorageUnavailableError("no token for the private store");
  return {
    kind: "BLOB_PRIVATE",
    async put(storageRef, bytes) {
      try {
        await sdk.put(storageRef, bytes, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: "application/zip",
          token,
        });
      } catch (error) {
        throw new StorageUnavailableError(error instanceof Error ? error.message : "write failed");
      }
    },
    async read(storageRef) {
      let result;
      try {
        result = await sdk.get(storageRef, { access: "private", useCache: false, token });
      } catch (error) {
        throw new StorageUnavailableError(error instanceof Error ? error.message : "read failed");
      }
      if (result === null || result.statusCode !== 200 || result.stream === null) return null;
      try {
        return await drain(result.stream);
      } catch (error) {
        throw new StorageUnavailableError(error instanceof Error ? error.message : "read failed");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Deposit and verification
// ---------------------------------------------------------------------------

/** The independent offline copy: another folder, same bytes. Throws when it is not there or differs. */
export function checkOfflineCopy(archiveDir: string, offlineDir: string, sha256: string): void {
  const a = fs.realpathSync(archiveDir);
  let b: string;
  try {
    b = fs.realpathSync(offlineDir);
  } catch {
    throw new StorageIntegrityError("the offline copy folder does not exist");
  }
  if (a === b)
    throw new StorageIntegrityError(
      "the offline copy is not independent: same folder as the archives"
    );
  const file = path.join(b, `${sha256}.zip`);
  if (!fs.existsSync(file))
    throw new StorageIntegrityError("the offline copy of the archive is missing");
  if (sha256Of(fs.readFileSync(file)) !== sha256) {
    throw new StorageIntegrityError("the offline copy does not hash to the archive");
  }
}

export interface Deposit {
  storageKind: StorageKind;
  storageRef: string;
}

/**
 * Puts the archive in the private store (once, by hash), reads it back and hashes it again. An object
 * already there must be the same bytes; it is never replaced.
 */
export async function depositArtifact(
  store: ArtifactStore,
  bytes: Buffer,
  sha256: string
): Promise<Deposit> {
  if (sha256Of(bytes) !== sha256)
    throw new StorageIntegrityError("the bytes to deposit do not hash to the archive");
  const storageRef = storageRefOf(sha256);
  const existing = await store.read(storageRef);
  if (existing !== null) {
    if (sha256Of(existing) !== sha256) {
      throw new StorageIntegrityError(
        "an object with this name exists and is not this archive: not overwritten"
      );
    }
    return { storageKind: store.kind, storageRef };
  }
  await store.put(storageRef, bytes);
  const back = await store.read(storageRef);
  if (back === null)
    throw new StorageIntegrityError("the archive cannot be read back after the upload");
  if (back.length !== bytes.length || sha256Of(back) !== sha256) {
    throw new StorageIntegrityError(
      "the archive read back after the upload is not the one uploaded"
    );
  }
  return { storageKind: store.kind, storageRef };
}

/** Re-reads a stored archive and checks it still hashes to its name. */
export async function verifyStoredArtifact(
  store: ArtifactStore,
  storageRef: string,
  sha256: string
): Promise<void> {
  if (storageRef !== storageRefOf(sha256))
    throw new StorageIntegrityError("the reference is not content addressed");
  const bytes = await store.read(storageRef);
  if (bytes === null) throw new StorageIntegrityError("the archive is not in the store");
  if (sha256Of(bytes) !== sha256)
    throw new StorageIntegrityError("the stored archive no longer hashes to its name");
}
