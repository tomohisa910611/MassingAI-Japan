import { describe, expect, it } from "vitest";
import { calculateRegulationLimits, knownAdachiChuoHonchoRegulations, knownSotokandaRegulations, normalizeJapaneseAddress, normalizeJapaneseAddressForMatching } from "./regulations";

describe("regulation calculations", () => {
  it("matches full-width digits and Unicode minus signs in Japanese addresses", () => {
    expect(normalizeJapaneseAddress("〒120-0011 東京都足立区中央本町２丁目２６−１2"))
      .toBe("1200011東京都足立区中央本町2丁目2612");
    expect(knownAdachiChuoHonchoRegulations("〒120-0011 東京都足立区中央本町２丁目２６−１2", "08440｜百貨店")).not.toBeNull();
  });
  it("uses the stricter road-width FAR and calculates permitted areas", () => {
    const analysis = knownSotokandaRegulations("東京都千代田区外神田3丁目12-2", "08030｜共同住宅");
    expect(analysis).not.toBeNull();
    const result = calculateRegulationLimits(analysis!, 92.34, 7.97);
    expect(result.roadLimitedFar).toBeCloseTo(478.2, 8);
    expect(result.appliedFar).toBeCloseTo(478.2, 8);
    expect(result.permittedBuildingArea).toBeCloseTo(73.872, 8);
    expect(result.permittedGrossFloorArea).toBeCloseTo(441.56988, 8);
  });

  it("does not apply the conditional fire-area or district-plan bonuses", () => {
    const analysis = knownSotokandaRegulations("〒101-0021 東京都千代田区外神田三丁目12-2", "08470｜事務所");
    expect(analysis?.designatedBuildingCoveragePercent).toBe(80);
    expect(analysis?.designatedFloorAreaRatioPercent).toBe(600);
  });

  it("recognizes the same address when 丁目, postal code, and spaces are omitted", () => {
    expect(normalizeJapaneseAddressForMatching("〒101-0021 東京都千代田区外神田三丁目12番2号"))
      .toContain("東京都千代田区外神田3-12-2");
    expect(knownSotokandaRegulations("〒101-0021 東京都千代田区外神田3-12-2", "08450｜飲食店")?.zoning)
      .toBe("商業地域");
    expect(knownSotokandaRegulations("東京都千代田区外神田3-12-2", "08450｜飲食店")?.zoning)
      .toBe("商業地域");
  });

  it("uses web search for addresses outside the verified reference", () => {
    expect(knownSotokandaRegulations("東京都新宿区西新宿2丁目8-1", "08470｜事務所")).toBeNull();
  });

  it("recognizes the verified A-014 demo address ending in 2-26-13", () => {
    const analysis = knownAdachiChuoHonchoRegulations(
      "〒120-0011 東京都足立区中央本町2-26-13",
      "08030｜共同住宅",
    );
    expect(analysis?.zoning).toBe("近隣商業地域");
    expect(analysis?.shadowRegulationApplies).toBe(true);
  });

  it("reuses the verified Adachi demo profile without an API call", () => {
    const analysis = knownAdachiChuoHonchoRegulations("〒120-0011 東京都足立区中央本町2-26-12", "08440｜百貨店・マーケット・物品販売店舗");
    expect(analysis?.zoning).toBe("近隣商業地域");
    expect(analysis?.designatedFloorAreaRatioPercent).toBe(300);
    expect(analysis?.shadowMeasurementHeightMeters).toBe(4);
  });

  it("recognizes the verified Adachi demo address written in Roman characters", () => {
    const address = "2-26-12, Chuohoncho, Adachi Ku, Tokyo, 120-0011, Japan";
    const normalized = normalizeJapaneseAddress(address);
    expect(normalized).toBe("22612,Chuohoncho,AdachiKu,Tokyo,1200011,Japan");
    expect(normalized.toLowerCase()).toContain("22612,chuohoncho,adachiku,tokyo");
    expect(normalized.toLowerCase()).toContain("1200011");
    expect(knownAdachiChuoHonchoRegulations(address, "08440｜百貨店・マーケット・物品販売店舗")?.zoning)
      .toBe("近隣商業地域");
  });

  it.each([
    ["東京都千代田区外神田3丁目12", "東京都千代田区外神田3-12"],
    ["東京都千代田区外神田三丁目12", "東京都千代田区外神田3-12"],
    ["東京都千代田区外神田3122", "東京都千代田区外神田3122"],
    ["3-12-2, Sotokanda, Chiyoda Ku, Tokyo, 101-0021, Japan", "3-12-2,Sotokanda,ChiyodaKu,Tokyo,101-0021,Japan"],
  ])("recognizes the verified Sotokanda demo alias: %s", (address, expectedNormalized) => {
    const normalized = normalizeJapaneseAddressForMatching(address);
    expect(normalized).toBe(expectedNormalized);
    expect(knownSotokandaRegulations(address, "08450｜飲食店")?.zoning).toBe("商業地域");
  });
});
