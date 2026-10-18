// @vitest-environment node
/**
 * `connectShared` really authenticates the server: the certificate chain against the CA file, and the
 * host name against the certificate. A local server answers the PostgreSQL TLS request (`S`), then
 * performs a TLS handshake with a certificate made here by `openssl`. It speaks no more PostgreSQL:
 * what is observed is whether the handshake was accepted by the client, which is where the
 * verification happens.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectShared, targetFingerprint } from "../historical-groups-target";

const dir = mkdtempSync(path.join(tmpdir(), "hg-tls-"));
const file = (name: string) => path.join(dir, name);
const openssl = (...args: string[]) => {
  const r = spawnSync("openssl", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`openssl ${args[0]} failed: ${r.stderr}`);
};

function makeCa(name: string) {
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.pem`,
    "-days",
    "2",
    "-subj",
    `/CN=${name}`
  );
}
function makeServerCert(name: string, ca: string, san: string) {
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.csr`,
    "-subj",
    `/CN=${san}`
  );
  writeFileSync(file(`${name}.ext`), `subjectAltName=DNS:${san}\n`);
  openssl(
    "x509",
    "-req",
    "-in",
    `${name}.csr`,
    "-CA",
    `${ca}.pem`,
    "-CAkey",
    `${ca}.key`,
    "-CAcreateserial",
    "-out",
    `${name}.pem`,
    "-days",
    "2",
    "-extfile",
    `${name}.ext`
  );
}

let port = 0;
let server: net.Server;
let handshakes = 0;
let name = "good";

beforeAll(async () => {
  makeCa("ca");
  makeCa("otherca");
  makeServerCert("good", "ca", "localhost");
  makeServerCert("wrongname", "ca", "other.example.test");
  server = net.createServer((socket) => {
    socket.once("data", () => {
      socket.write("S");
      const secure = new tls.TLSSocket(socket, {
        isServer: true,
        key: readFileSync(file(`${name}.key`)),
        cert: readFileSync(file(`${name}.pem`)),
      });
      secure.on("secure", () => {
        handshakes += 1;
        secure.destroy();
      });
      secure.on("error", () => undefined);
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as net.AddressInfo).port;
});
afterAll(() => server?.close());

const urlFor = () => `postgresql://hg_importer:x@localhost:${port}/postgres?sslmode=verify-full`;
const envFor = (ca: string) => ({
  HG_TARGET: "shared",
  HG_EXPECTED_TARGET_FINGERPRINT: targetFingerprint(urlFor()),
  HG_EXPECTED_SYSTEM_IDENTIFIER: "7000000000000000001",
  HG_TARGET_CA_FILE: file(`${ca}.pem`),
});

async function attempt(cert: string, ca: string): Promise<{ error: string; handshakes: number }> {
  name = cert;
  handshakes = 0;
  try {
    const client = await connectShared(urlFor(), "importer", "plan", envFor(ca));
    await client.end();
    return { error: "", handshakes };
  } catch (error) {
    // The server closes right after the handshake, so a connection that got past TLS fails later.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      error: `${(error as { code?: string }).code ?? ""} ${(error as Error).message}`,
      handshakes,
    };
  }
}

describe("verify-full on the connection to the shared target", () => {
  it("accepts a server whose certificate chains to the CA file and carries the host name", async () => {
    const r = await attempt("good", "ca");
    expect(r.handshakes).toBe(1);
    expect(r.error).not.toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|certificate/i);
  });

  it("refuses a server whose certificate does not chain to the CA file", async () => {
    const r = await attempt("good", "otherca");
    expect(r.handshakes).toBe(0);
    expect(r.error).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|certificate/i);
  });

  it("refuses a server whose certificate does not carry the host name, even with the right CA", async () => {
    const r = await attempt("wrongname", "ca");
    expect(r.handshakes).toBe(0);
    expect(r.error).toMatch(/ALTNAME|does not match|Hostname/i);
  });
});
