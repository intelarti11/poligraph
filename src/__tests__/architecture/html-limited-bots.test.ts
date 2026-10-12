import { describe, expect, it } from "vitest";
import { HTML_LIMITED_BOTS } from "../../../next.config";

describe("htmlLimitedBots", () => {
  it("serves blocking metadata (in <head>) to Google's crawlers", () => {
    expect(
      HTML_LIMITED_BOTS.test(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
      )
    ).toBe(true);
    expect(HTML_LIMITED_BOTS.test("Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)")).toBe(
      true
    );
    expect(HTML_LIMITED_BOTS.test("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true);
  });

  it("keeps streamed metadata for a regular browser", () => {
    expect(
      HTML_LIMITED_BOTS.test(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      )
    ).toBe(false);
  });
});
