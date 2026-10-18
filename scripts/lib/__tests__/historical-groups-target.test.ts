// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TargetRefusedError } from "../historical-groups-db";
import {
  resolveSharedTarget,
  targetFingerprint,
  verifyConnectedTarget,
  type QueryClient,
  type SharedTarget,
} from "../historical-groups-target";

const URL_OK = "postgresql://hg_importer:x@db.project.example.test:5432/postgres?sslmode=require";
const FP = targetFingerprint(URL_OK);
const SYSTEM_ID = "7000000000000000001";
const ENV = {
  HG_TARGET: "shared",
  HG_EXPECTED_TARGET_FINGERPRINT: FP,
  HG_EXPECTED_SYSTEM_IDENTIFIER: SYSTEM_ID,
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
    const other = "postgresql://hg_importer:x@db.other.example.test:5432/postgres?sslmode=require";
    expect(refusal(() => resolveSharedTarget(other, "importer", "plan", ENV))).toContain(
      "fingerprint"
    );
  });

  it.each([
    [
      "the pooler port",
      "postgresql://hg_importer:x@db.project.example.test:6543/postgres?sslmode=require",
    ],
    [
      "a pooler host",
      "postgresql://hg_importer:x@aws-0-eu.pooler.example.test:5432/postgres?sslmode=require",
    ],
    [
      "a pooled user name",
      "postgresql://hg_importer.projectref:x@db.project.example.test:5432/postgres?sslmode=require",
    ],
  ])("refuses a transactional pooler: %s", (_label, url) => {
    expect(
      refusal(() =>
        resolveSharedTarget(url, "importer", "plan", {
          ...ENV,
          HG_EXPECTED_TARGET_FINGERPRINT: targetFingerprint(url),
        })
      )
    ).toContain("direct connection");
  });

  it("refuses a connection without TLS", () => {
    const plain = "postgresql://hg_importer:x@db.project.example.test:5432/postgres";
    expect(refusal(() => resolveSharedTarget(plain, "importer", "plan", ENV))).toContain("TLS");
    expect(
      refusal(() => resolveSharedTarget(`${plain}?sslmode=disable`, "importer", "plan", ENV))
    ).toContain("TLS");
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
