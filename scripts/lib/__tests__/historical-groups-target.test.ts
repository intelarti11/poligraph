// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TargetRefusedError } from "../historical-groups-db";
import {
  resolveSharedTarget,
  targetFingerprint,
  verifyConnectedTarget,
  type QueryClient,
  type SharedTarget,
} from "../historical-groups-target";

const CA_DIR = mkdtempSync(path.join(tmpdir(), "hg-ca-"));
const CA_FILE = path.join(CA_DIR, "ca.pem");
writeFileSync(CA_FILE, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
const URL_OK =
  "postgresql://hg_importer:x@db.project.example.test:5432/postgres?sslmode=verify-full";
const FP = targetFingerprint(URL_OK);
const SYSTEM_ID = "7000000000000000001";
const ENV = {
  HG_TARGET: "shared",
  HG_EXPECTED_TARGET_FINGERPRINT: FP,
  HG_EXPECTED_SYSTEM_IDENTIFIER: SYSTEM_ID,
  HG_TARGET_CA_FILE: CA_FILE,
};
const WRITE = { ...ENV, HG_ALLOW_SHARED_WRITE: FP.slice(0, 16) };

const refusal = (run: () => unknown): string | null => {
  try {
    run();
  } catch (error) {
    if (error instanceof TargetRefusedError) return error.message;
    throw error;
  }
  return null;
};

describe("the shared target, before any connection", () => {
  it("is accepted only when every condition holds", () => {
    expect(refusal(() => resolveSharedTarget(URL_OK, "importer", "plan", ENV))).toBeNull();
    expect(refusal(() => resolveSharedTarget(URL_OK, "importer", "apply", WRITE))).toBeNull();
  });

  it("refuses a target that is not named, whatever the URL", () => {
    expect(
      refusal(() =>
        resolveSharedTarget(URL_OK, "importer", "plan", { ...ENV, HG_TARGET: undefined })
      )
    ).toContain("not named");
    expect(
      refusal(() => resolveSharedTarget(URL_OK, "importer", "plan", { ...ENV, HG_TARGET: "local" }))
    ).toContain("not named");
  });

  it("refuses when the expected identity is not configured, or malformed", () => {
    for (const patch of [
      { HG_EXPECTED_TARGET_FINGERPRINT: undefined },
      { HG_EXPECTED_TARGET_FINGERPRINT: "abc" },
      { HG_EXPECTED_SYSTEM_IDENTIFIER: undefined },
      { HG_EXPECTED_SYSTEM_IDENTIFIER: "not-a-number" },
    ]) {
      expect(
        refusal(() => resolveSharedTarget(URL_OK, "importer", "plan", { ...ENV, ...patch }))
      ).toContain("not configured");
    }
  });

  it("refuses another host than the expected one, even with the right database name", () => {
    const other =
      "postgresql://hg_importer:x@db.other.example.test:5432/postgres?sslmode=verify-full";
    expect(refusal(() => resolveSharedTarget(other, "importer", "plan", ENV))).toContain(
      "fingerprint"
    );
  });

  it.each([
    [
      "the pooler port",
      "postgresql://hg_importer:x@db.project.example.test:6543/postgres?sslmode=verify-full",
    ],
    [
      "a pooler host",
      "postgresql://hg_importer:x@aws-0-eu.pooler.example.test:5432/postgres?sslmode=verify-full",
    ],
    [
      "a pooled user name",
      "postgresql://hg_importer.projectref:x@db.project.example.test:5432/postgres?sslmode=verify-full",
    ],
  ])("refuses a transactional pooler: %s", (_label, url) => {
    expect(
      refusal(() =>
        resolveSharedTarget(url, "importer", "plan", {
          ...ENV,
          HG_EXPECTED_TARGET_FINGERPRINT: targetFingerprint(url),
        })
      )
    ).toMatch(/direct (or session-mode )?connection/);
  });

  it("refuses a connection that does not authenticate the server: any mode but verify-full", () => {
    const base = "postgresql://hg_importer:x@db.project.example.test:5432/postgres";
    for (const query of [
      "",
      "?sslmode=disable",
      "?sslmode=prefer",
      "?sslmode=require",
      "?sslmode=verify-ca",
    ]) {
      expect(
        refusal(() => resolveSharedTarget(base + query, "importer", "plan", ENV)),
        query
      ).toContain("verify-full");
    }
  });

  it("refuses without the CA certificate of the server, unreadable, or not a certificate", () => {
    expect(
      refusal(() =>
        resolveSharedTarget(URL_OK, "importer", "plan", { ...ENV, HG_TARGET_CA_FILE: undefined })
      )
    ).toContain("not configured");
    expect(
      refusal(() =>
        resolveSharedTarget(URL_OK, "importer", "plan", {
          ...ENV,
          HG_TARGET_CA_FILE: path.join(CA_DIR, "absent.pem"),
        })
      )
    ).toContain("cannot be read");
    const notPem = path.join(CA_DIR, "not.pem");
    writeFileSync(notPem, "hello");
    expect(
      refusal(() =>
        resolveSharedTarget(URL_OK, "importer", "plan", { ...ENV, HG_TARGET_CA_FILE: notPem })
      )
    ).toContain("no certificate");
  });

  it("refuses the application's own pooled URL", () => {
    expect(
      refusal(() =>
        resolveSharedTarget(URL_OK, "importer", "plan", { ...ENV, DATABASE_URL: URL_OK })
      )
    ).toContain("DATABASE_URL");
  });

  it("refuses the wrong role for the tool", () => {
    expect(refusal(() => resolveSharedTarget(URL_OK, "runner", "plan", ENV))).toContain(
      "hg_runner"
    );
    expect(
      refusal(() =>
        resolveSharedTarget(URL_OK.replace("hg_importer", "postgres"), "importer", "plan", ENV)
      )
    ).toContain("hg_importer");
  });

  it("lets the owner gesture through only with a configured owner role that is not a lot role", () => {
    const owner = URL_OK.replace("hg_importer", "operator");
    expect(refusal(() => resolveSharedTarget(owner, "owner", "apply", WRITE))).toContain(
      "owner role"
    );
    expect(
      refusal(() =>
        resolveSharedTarget(owner, "owner", "apply", {
          ...WRITE,
          HG_SHARED_OWNER_ROLE: "hg_importer",
        })
      )
    ).toContain("owner role");
    expect(
      refusal(() =>
        resolveSharedTarget(owner, "owner", "apply", { ...WRITE, HG_SHARED_OWNER_ROLE: "operator" })
      )
    ).toBeNull();
    expect(
      refusal(() =>
        resolveSharedTarget(URL_OK, "owner", "apply", {
          ...WRITE,
          HG_SHARED_OWNER_ROLE: "operator",
        })
      )
    ).toContain("configured owner role");
  });

  it("refuses a write without the written acknowledgement of this very target", () => {
    expect(refusal(() => resolveSharedTarget(URL_OK, "importer", "apply", ENV))).toContain(
      "HG_ALLOW_SHARED_WRITE"
    );
    expect(
      refusal(() =>
        resolveSharedTarget(URL_OK, "importer", "apply", {
          ...ENV,
          HG_ALLOW_SHARED_WRITE: "0".repeat(16),
        })
      )
    ).toContain("does not acknowledge");
    // A plan needs no acknowledgement: it writes nothing.
    expect(refusal(() => resolveSharedTarget(URL_OK, "importer", "plan", ENV))).toBeNull();
  });

  it("never puts a value of the environment or of the URL in a refusal", () => {
    const messages = [
      refusal(() =>
        resolveSharedTarget(URL_OK, "importer", "apply", {
          ...ENV,
          HG_ALLOW_SHARED_WRITE: "secret-ack",
        })
      ),
      refusal(() =>
        resolveSharedTarget(URL_OK, "importer", "plan", {
          ...ENV,
          HG_EXPECTED_SYSTEM_IDENTIFIER: "7000000000000000009",
          HG_EXPECTED_TARGET_FINGERPRINT: "f".repeat(64),
        })
      ),
    ].join(" ");
    for (const secret of [
      "secret-ack",
      "db.project.example.test",
      "hg_importer:x",
      SYSTEM_ID,
      "7000000000000000009",
    ]) {
      expect(messages).not.toContain(secret);
    }
  });
});

describe("the session mode of a pooler, only when asked for", () => {
  const POOLED =
    "postgresql://hg_importer.projref:x@aws-0-eu.pooler.example.test:5432/postgres?sslmode=verify-full";
  const SESSION = {
    ...ENV,
    HG_EXPECTED_TARGET_FINGERPRINT: targetFingerprint(POOLED),
    HG_CONNECTION_MODE: "session-pooler",
  };
  const resolve = (
    url: string,
    env: Record<string, string | undefined> = SESSION,
    role: "importer" | "runner" = "importer"
  ) => refusal(() => resolveSharedTarget(url, role, "plan", env));

  it("accepts the session port of a pooler with a role.project user, once requested", () => {
    expect(resolve(POOLED)).toBeNull();
    expect(
      refusal(() =>
        resolveSharedTarget(POOLED, "importer", "apply", {
          ...SESSION,
          HG_ALLOW_SHARED_WRITE: targetFingerprint(POOLED).slice(0, 16),
        })
      )
    ).toBeNull();
  });

  it("stays refused by default, and for an unknown mode", () => {
    expect(resolve(POOLED, { ...SESSION, HG_CONNECTION_MODE: undefined })).toContain(
      "pooler is refused in direct mode"
    );
    expect(resolve(POOLED, { ...SESSION, HG_CONNECTION_MODE: "direct" })).toContain(
      "pooler is refused in direct mode"
    );
    expect(resolve(POOLED, { ...SESSION, HG_CONNECTION_MODE: "transaction" })).toContain(
      "direct or session-pooler"
    );
  });

  it("refuses the transactional port in every mode", () => {
    const transactional = POOLED.replace(":5432", ":6543");
    const env = { ...SESSION, HG_EXPECTED_TARGET_FINGERPRINT: targetFingerprint(transactional) };
    expect(resolve(transactional, env)).toContain("transactional pooler is refused");
  });

  it("refuses what is not a session pooler: a direct host, another port, a bare user name", () => {
    const direct =
      "postgresql://hg_importer.projref:x@db.project.example.test:5432/postgres?sslmode=verify-full";
    expect(
      resolve(direct, { ...SESSION, HG_EXPECTED_TARGET_FINGERPRINT: targetFingerprint(direct) })
    ).toContain("expects a pooler host");
    const otherPort = POOLED.replace(":5432", ":5433");
    expect(
      resolve(otherPort, {
        ...SESSION,
        HG_EXPECTED_TARGET_FINGERPRINT: targetFingerprint(otherPort),
      })
    ).toContain("session port 5432");
    const bare = POOLED.replace("hg_importer.projref", "hg_importer");
    expect(resolve(bare)).toContain("role.project");
    const many = POOLED.replace("hg_importer.projref", "hg_importer.a.b");
    expect(resolve(many)).toContain("role.project");
  });

  it("still requires the role of the tool before the dot, the expected host and verify-full", () => {
    expect(resolve(POOLED, SESSION, "runner")).toContain("hg_runner");
    expect(resolve(POOLED.replace("hg_importer.", "postgres."))).toContain("hg_importer");
    expect(resolve(POOLED, { ...SESSION, HG_EXPECTED_TARGET_FINGERPRINT: FP })).toContain(
      "fingerprint"
    );
    expect(resolve(POOLED.replace("verify-full", "require"))).toContain("verify-full");
  });
});

// ---------------------------------------------------------------------------
// Once connected
// ---------------------------------------------------------------------------

const TARGET: SharedTarget = {
  url: URL_OK,
  role: "importer",
  expectedFingerprint: FP,
  expectedSystemIdentifier: SYSTEM_ID,
  execution: "plan",
  ownerRole: null,
  caFile: CA_FILE,
};

interface Behaviour {
  user?: string;
  privileged?: boolean | null;
  ssl?: boolean | null;
  recovery?: boolean;
  systemId?: string | null | "throws";
  /** Backend pid returned by successive probes. */
  pids?: number[];
  held?: number;
}

/** A client answering like PostgreSQL would, with each behaviour changeable. */
function stub(b: Behaviour = {}): QueryClient & { calls: string[] } {
  const calls: string[] = [];
  let probe = 0;
  return {
    calls,
    async query(text: string) {
      calls.push(text);
      if (text.includes("current_user AS usr")) {
        return {
          rows: [
            {
              usr: b.user ?? "hg_importer",
              pid: 100,
              recovery: b.recovery ?? false,
              ssl: b.ssl === undefined ? true : b.ssl,
              privileged: b.privileged === undefined ? false : b.privileged,
            },
          ],
        };
      }
      if (text.includes("pg_control_system")) {
        if (b.systemId === "throws")
          throw new Error("permission denied for function pg_control_system");
        return { rows: b.systemId === null ? [] : [{ id: b.systemId ?? SYSTEM_ID }] };
      }
      if (text.includes("pg_advisory_lock")) return { rows: [] };
      if (text.includes("pg_advisory_unlock")) return { rows: [] };
      if (text.includes("FROM pg_locks")) {
        const pids = b.pids ?? [100, 100, 100];
        return { rows: [{ pid: pids[probe++] ?? 100, held: b.held ?? 1 }] };
      }
      return { rows: [] };
    },
  };
}

const connectedRefusal = async (b: Behaviour, target: SharedTarget = TARGET) => {
  try {
    await verifyConnectedTarget(stub(b), target);
  } catch (error) {
    if (error instanceof TargetRefusedError) return error.message;
    throw error;
  }
  return null;
};

describe("the shared target, once connected", () => {
  it("accepts the expected project, role, TLS and a real session", async () => {
    expect(await connectedRefusal({})).toBeNull();
  });

  it("refuses an unexpected project, whatever its host says", async () => {
    expect(await connectedRefusal({ systemId: "7000000000000000999" })).toContain(
      "not the expected project"
    );
  });

  it("refuses a project whose identity cannot be read", async () => {
    expect(await connectedRefusal({ systemId: "throws" })).toContain("cannot be read");
    expect(await connectedRefusal({ systemId: null })).toContain("cannot be read");
  });

  it("refuses the wrong role, and a role with a special attribute", async () => {
    expect(await connectedRefusal({ user: "postgres" })).toContain("another role");
    expect(await connectedRefusal({ privileged: true })).toContain("special attribute");
    expect(await connectedRefusal({ privileged: null })).toContain("special attribute");
  });

  it("refuses a session that is not over TLS, and a server in recovery", async () => {
    expect(await connectedRefusal({ ssl: false })).toContain("TLS");
    expect(await connectedRefusal({ ssl: null })).toContain("TLS");
    expect(await connectedRefusal({ recovery: true })).toContain("recovery");
  });

  it("detects a transactional pooler: the backend changes, or the session lock is not seen", async () => {
    expect(await connectedRefusal({ pids: [100, 217, 100] })).toContain("pooled");
    expect(await connectedRefusal({ held: 0 })).toContain("pooled");
  });

  it("releases its session lock even when it refuses", async () => {
    const client = stub({ pids: [100, 217, 100] });
    await expect(verifyConnectedTarget(client, TARGET)).rejects.toThrow(TargetRefusedError);
    expect(client.calls.some((c) => c.includes("pg_advisory_unlock"))).toBe(true);
  });
});
