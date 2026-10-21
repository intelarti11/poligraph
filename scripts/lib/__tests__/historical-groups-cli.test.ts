// @vitest-environment node
/**
 * The command line refuses before it connects. Each case runs the real CLI with an environment that
 * could not reach any database (the URLs point at a port nothing listens on), so a refusal that came
 * from a failed connection instead of a check would not look like these messages.
 */
import AdmZip from "adm-zip";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DEAD = "postgresql://hg_importer:x@127.0.0.1:1/postgres?sslmode=require";

function cli(args: string[], env: Record<string, string>): { code: number | null; out: string } {
  const result = spawnSync("npx", ["tsx", "scripts/historical-groups.ts", ...args], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...env,
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function archiveFolder(content: Buffer, declared: Buffer = content) {
  const dir = mkdtempSync(path.join(tmpdir(), "hg-cli-"));
  mkdirSync(path.join(dir, "archives"));
  const sha = createHash("sha256").update(declared).digest("hex");
  writeFileSync(path.join(dir, "archives", `${sha}.zip`), content);
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      archives: [
        {
          stream: "AN_AMO30",
          sha256: sha,
          sizeBytes: declared.length,
          file: `archives/${sha}.zip`,
          url: "https://example.test/a.zip",
          serverLastModified: null,
          sourceAsOf: null,
        },
      ],
    })
  );
  return dir;
}

describe("the command line refuses before it connects", () => {
  it("an apply without the hash of the plan", () => {
    const r = cli(["import", "--stream", "AN_AMO30", "--apply"], { HG_URL_IMPORTER: DEAD });
    expect(r.code).toBe(1);
    expect(r.out).toContain("--apply needs --confirm");
  });

  it("an apply on the shared target without private storage", () => {
    const r = cli(["import", "--stream", "AN_AMO30", "--apply", "--confirm", "a".repeat(64)], {
      HG_URL_IMPORTER: DEAD,
      HG_TARGET: "shared",
    });
    expect(r.out).toContain("needs --store blob");
    expect(r.code).toBe(1);
  });

  it("a stored apply without the independent offline copy folder", () => {
    const r = cli(
      ["import", "--stream", "AN_AMO30", "--apply", "--confirm", "a".repeat(64), "--store", "blob"],
      {
        HG_URL_IMPORTER: DEAD,
        HG_TARGET: "shared",
      }
    );
    expect(r.out).toContain("HG_OFFLINE_COPY_DIR");
  });

  it("a stored apply without a token for the private store", () => {
    const r = cli(
      ["import", "--stream", "AN_AMO30", "--apply", "--confirm", "a".repeat(64), "--store", "blob"],
      {
        HG_URL_IMPORTER: DEAD,
        HG_TARGET: "shared",
        HG_OFFLINE_COPY_DIR: tmpdir(),
      }
    );
    expect(r.out).toContain("Private storage unavailable");
  });

  it("an archive whose bytes are not the ones the manifest declares", () => {
    const dir = archiveFolder(Buffer.from("corrupted bytes"), Buffer.from("the declared bytes"));
    const r = cli(["import", "--stream", "AN_AMO30"], {
      HG_URL_IMPORTER: DEAD,
      HG_ARCHIVE_DIR: dir,
    });
    expect(r.out).toContain("not the one the manifest declares");
    expect(r.code).toBe(1);
  });

  it("the shared target when its identity is not configured, and a pooled URL", () => {
    const zip = new AdmZip();
    zip.addFile("json/organe/PO1.json", Buffer.from("{}"));
    const dir = archiveFolder(zip.toBuffer());
    const named = { HG_ARCHIVE_DIR: dir, HG_TARGET: "shared" };
    const unconfigured = cli(["import", "--stream", "AN_AMO30"], {
      ...named,
      HG_URL_IMPORTER: DEAD,
    });
    expect(unconfigured.code).toBe(1);
    expect(unconfigured.out).toContain("expected fingerprint of the target is not configured");
    expect(unconfigured.out).not.toContain("ECONNREFUSED");
    const pooled =
      "postgresql://hg_importer:x@aws-0-eu.pooler.example.test:6543/postgres?sslmode=require";
    const fingerprint = createHash("sha256")
      .update("aws-0-eu.pooler.example.test:6543/postgres")
      .digest("hex");
    const refused = cli(["import", "--stream", "AN_AMO30"], {
      ...named,
      HG_URL_IMPORTER: pooled,
      HG_EXPECTED_TARGET_FINGERPRINT: fingerprint,
      HG_EXPECTED_SYSTEM_IDENTIFIER: "7000000000000000001",
    });
    expect(refused.out).toContain("transactional pooler is refused");
  });

  it("prints the fingerprint of a configured URL without connecting", () => {
    const r = cli(["fingerprint"], { HG_URL_IMPORTER: DEAD });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(
      r.out
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .join("")
    ) as {
      fingerprint: string;
      acknowledgement: string;
    };
    expect(parsed.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.acknowledgement).toBe(parsed.fingerprint.slice(0, 16));
  });
});
