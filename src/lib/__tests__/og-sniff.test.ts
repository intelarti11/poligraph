import { describe, expect, it } from "vitest";
import { sniffImageType } from "@/lib/og-utils";

describe("sniffImageType", () => {
  it("reads the real type from the bytes, whatever the declared one", () => {
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
  });

  it("rejects a type the OG renderer cannot decode (WebP)", () => {
    expect(
      sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45]))
    ).toBeNull();
  });
});
