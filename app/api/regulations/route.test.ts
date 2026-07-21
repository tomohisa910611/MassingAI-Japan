import { beforeAll, describe, expect, it, vi } from "vitest";

const { openAiConstructor } = vi.hoisted(() => ({ openAiConstructor: vi.fn(() => {
  throw new Error("OpenAI must not be constructed for a verified demo address");
}) }));

vi.mock("openai", () => ({ default: openAiConstructor }));
vi.mock("@/lib/regulations", async () => import("../../../lib/regulations"));

describe("verified regulation API route", () => {
  let POST: typeof import("./route").POST;

  beforeAll(async () => {
    ({ POST } = await import("./route"));
  });

  it.each([
    "〒120-0011 東京都足立区中央本町2-26-12",
    "2-26-12, Chuohoncho, Adachi Ku, Tokyo, 120-0011, Japan",
  ])("returns the Adachi reference without constructing OpenAI: %s", async (address) => {
    const response = await POST(new Request("http://localhost/api/regulations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, intendedUse: "08440｜百貨店・マーケット・物品販売店舗", language: "ja" }),
    }));
    const result = await response.json() as { source?: string; regulations?: { zoning?: string } };
    expect(response.status).toBe(200);
    expect(result.source).toBe("official-reference");
    expect(result.regulations?.zoning).toBe("近隣商業地域");
    expect(openAiConstructor).not.toHaveBeenCalled();
  });
});
