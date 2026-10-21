// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  StorageIntegrityError,
  StorageUnavailableError,
  checkOfflineCopy,
  createBlobStore,
  depositArtifact,
  sha256Of,
  storageRefOf,
  verifyStoredArtifact,
  type ArtifactStore,
  type BlobSdk,
} from "../historical-groups-storage";

const BYTES = Buffer.from("an archive, as bytes");
const SHA = sha256Of(BYTES);

/** An in-memory store that behaves like the contract says: no overwrite, null when absent. */
function memoryStore(
  over: Partial<ArtifactStore> = {}
): ArtifactStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    kind: "BLOB_PRIVATE",
    async put(ref, bytes) {
      if (objects.has(ref)) throw new Error("exists");
      objects.set(ref, Buffer.from(bytes));
    },
    async read(ref) {
      return objects.get(ref) ?? null;
    },
    ...over,
  };
}

describe("the private deposit of an archive", () => {
  it("stores the archive under its hash, reads it back and returns its reference", async () => {
    const store = memoryStore();
    const deposit = await depositArtifact(store, BYTES, SHA);
    expect(deposit).toEqual({
      storageKind: "BLOB_PRIVATE",
      storageRef: `historical-groups/${SHA}.zip`,
    });
    expect(store.objects.get(deposit.storageRef)).toEqual(BYTES);
  });

  it("is idempotent: the same archive already there is accepted and not written again", async () => {
    const store = memoryStore();
    await depositArtifact(store, BYTES, SHA);
    await expect(depositArtifact(store, BYTES, SHA)).resolves.toMatchObject({
      storageRef: storageRefOf(SHA),
    });
  });

  it("never overwrites an object of the same name that is not this archive", async () => {
    const store = memoryStore();
    store.objects.set(storageRefOf(SHA), Buffer.from("something else"));
    await expect(depositArtifact(store, BYTES, SHA)).rejects.toThrow(StorageIntegrityError);
    expect(store.objects.get(storageRefOf(SHA))?.toString()).toBe("something else");
  });

  it("refuses bytes that are not the archive they claim to be", async () => {
    await expect(depositArtifact(memoryStore(), Buffer.from("tampered"), SHA)).rejects.toThrow(
      /do not hash/
    );
  });

  it("refuses an upload that cannot be read back", async () => {
    const store = memoryStore({ async put() {} });
    await expect(depositArtifact(store, BYTES, SHA)).rejects.toThrow(/cannot be read back/);
  });

  it("refuses an upload that comes back corrupted", async () => {
    const objects = new Map<string, Buffer>();
    const store: ArtifactStore = {
      kind: "BLOB_PRIVATE",
      async put(ref, bytes) {
        objects.set(ref, Buffer.concat([bytes, Buffer.from("x")]));
      },
      async read(ref) {
        return objects.get(ref) ?? null;
      },
    };
    await expect(depositArtifact(store, BYTES, SHA)).rejects.toThrow(
      /read back after the upload is not the one uploaded/
    );
  });

  it("surfaces an unavailable store, on the write and on the read", async () => {
    const down = async () => {
      throw new StorageUnavailableError("503");
    };
    await expect(depositArtifact(memoryStore({ put: down }), BYTES, SHA)).rejects.toThrow(
      StorageUnavailableError
    );
    await expect(depositArtifact(memoryStore({ read: down }), BYTES, SHA)).rejects.toThrow(
      StorageUnavailableError
    );
  });

  it("re-verifies a stored archive, and sees one that changed", async () => {
    const store = memoryStore();
    const { storageRef } = await depositArtifact(store, BYTES, SHA);
    await expect(verifyStoredArtifact(store, storageRef, SHA)).resolves.toBeUndefined();
    store.objects.set(storageRef, Buffer.from("altered"));
    await expect(verifyStoredArtifact(store, storageRef, SHA)).rejects.toThrow(/no longer hashes/);
    store.objects.delete(storageRef);
    await expect(verifyStoredArtifact(store, storageRef, SHA)).rejects.toThrow(/not in the store/);
    await expect(verifyStoredArtifact(store, "historical-groups/other.zip", SHA)).rejects.toThrow(
      /content addressed/
    );
  });
});

describe("the independent offline copy", () => {
  const dirs = () => {
    const root = mkdtempSync(path.join(tmpdir(), "hg-storage-"));
    const archives = path.join(root, "archives");
    const offline = path.join(root, "offline");
    mkdirSync(archives);
    mkdirSync(offline);
    return { archives, offline };
  };

  it("accepts the same bytes in another folder", () => {
    const { archives, offline } = dirs();
    writeFileSync(path.join(offline, `${SHA}.zip`), BYTES);
    expect(() => checkOfflineCopy(archives, offline, SHA)).not.toThrow();
  });

  it("refuses a missing copy, a different copy, and the same folder", () => {
    const { archives, offline } = dirs();
    expect(() => checkOfflineCopy(archives, offline, SHA)).toThrow(/missing/);
    writeFileSync(path.join(offline, `${SHA}.zip`), Buffer.from("different"));
    expect(() => checkOfflineCopy(archives, offline, SHA)).toThrow(/does not hash/);
    writeFileSync(path.join(archives, `${SHA}.zip`), BYTES);
    expect(() => checkOfflineCopy(archives, archives, SHA)).toThrow(/not independent/);
    expect(() => checkOfflineCopy(archives, path.join(archives, "absent"), SHA)).toThrow(
      /does not exist/
    );
  });
});

describe("the Vercel Blob adapter", () => {
  const sdk = (calls: unknown[], objects = new Map<string, Buffer>()): BlobSdk => ({
    async put(pathname, body, options) {
      calls.push({ pathname, options });
      objects.set(pathname, Buffer.from(body));
      return {};
    },
    async get(pathname) {
      const bytes = objects.get(pathname);
      if (!bytes) return null;
      return { statusCode: 200, stream: new Blob([new Uint8Array(bytes)]).stream() };
    },
  });

  it("writes with private access, no random suffix and no overwrite, and reads back", async () => {
    const calls: { options: Record<string, unknown> }[] = [];
    const store = createBlobStore(sdk(calls), "token");
    await expect(depositArtifact(store, BYTES, SHA)).resolves.toMatchObject({
      storageKind: "BLOB_PRIVATE",
    });
    expect(calls[0]?.options).toMatchObject({
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  });

  it("is unavailable without a token, and when the service fails", async () => {
    expect(() => createBlobStore(sdk([]), undefined)).toThrow(StorageUnavailableError);
    const failing: BlobSdk = {
      async put() {
        throw new Error("503");
      },
      async get() {
        throw new Error("503");
      },
    };
    await expect(depositArtifact(createBlobStore(failing, "t"), BYTES, SHA)).rejects.toThrow(
      StorageUnavailableError
    );
  });
});
