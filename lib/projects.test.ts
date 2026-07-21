import { describe, expect, it } from "vitest";
import { buildingUseName, isSavedProjectAddressUnchanged, projectDisplayName } from "./projects";

describe("project naming", () => {
  it("uses only the building-use label in the saved name", () => {
    expect(buildingUseName("08450｜飲食店")).toBe("飲食店");
  });

  it("keeps the first-save date and adds the massing-check suffix", () => {
    expect(projectDisplayName("2026-07-20T01:23:45.000Z", "神田三丁目計画", "08450｜飲食店"))
      .toBe("2026-07-20_神田三丁目計画ボリュームチェック_飲食店");
  });

  it("removes filename-invalid characters from a case name", () => {
    expect(projectDisplayName("2026-07-20T00:00:00.000Z", "A/B計画", "08470｜事務所"))
      .toBe("2026-07-20_A-B計画ボリュームチェック_事務所");
  });
});

describe("saved project address locking", () => {
  it("requires the exact saved address text inside an opened project", () => {
    const saved = "〒101-0021 東京都千代田区外神田3丁目12-2";
    expect(isSavedProjectAddressUnchanged(saved, saved)).toBe(true);
    expect(isSavedProjectAddressUnchanged(saved, "東京都千代田区外神田3-12-2")).toBe(false);
  });
});
