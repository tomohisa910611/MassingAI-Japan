import { describe, expect, it } from "vitest";
import {
  getDemoProject,
  getDemoProjects,
  getVerifiedDemoPlan,
  isDemoProjectId,
  mergeProjectSummariesWithDemoSeeds,
  VERIFIED_A014_IMAGE_HASH,
} from "./demo-data";
import { buildMassingEnvelope } from "./massing-envelope";
import { calculateRegulationLimits, knownAdachiChuoHonchoRegulations } from "./regulations";

describe("bundled verified demo data", () => {
  it("resolves the A-014 image hash without a cache file", () => {
    const plan = getVerifiedDemoPlan(VERIFIED_A014_IMAGE_HASH);
    expect(plan).not.toBeNull();
    expect(plan?.vertices).toHaveLength(35);
    expect(plan?.edges).toHaveLength(35);
    expect(plan?.siteAreaSquareMeters).toBe(6625.93);
    expect(plan?.edges.find((edge) => `${edge.startVertexId}-${edge.endVertexId}` === "B-C")?.lengthMeters).toBe(13.49);
    expect(plan?.roads.map((road) => road.widthMeters)).toEqual([6.2, 5.06, 9.09]);
  });

  it("returns exactly two immutable demo projects when storage is empty", () => {
    const projects = getDemoProjects();
    expect(projects).toHaveLength(2);
    expect(projects.every((project) => project.isDemo)).toBe(true);
    expect(mergeProjectSummariesWithDemoSeeds([])).toHaveLength(2);
    for (const project of projects) {
      expect(isDemoProjectId(project.id)).toBe(true);
      expect(getDemoProject(project.id)?.isDemo).toBe(true);
    }
  });

  it("does not expose the embedded object to caller mutation", () => {
    const first = getDemoProjects()[0];
    first.caseName = "changed";
    expect(getDemoProject(first.id)?.caseName).not.toBe("changed");
  });

  it.each([
    "〒120-0011 東京都足立区中央本町2-26-12",
    "2-26-12, Chuohoncho, Adachi Ku, Tokyo, 120-0011, Japan",
  ])("combines bundled 2D, verified regulations, and 3D without OpenAI: %s", (address) => {
    const plan = getVerifiedDemoPlan(VERIFIED_A014_IMAGE_HASH)!;
    const imageSize = getDemoProjects().find((item) => item.plan.vertices.length === 35)!.imageSize;
    const regulations = knownAdachiChuoHonchoRegulations(address, "08440｜百貨店・マーケット・物品販売店舗");
    expect(regulations).not.toBeNull();
    if (!regulations) throw new Error("Verified Adachi regulations were not resolved");
    const roadWidth = Math.min(...plan.roads.flatMap((road) => road.widthMeters == null ? [] : [road.widthMeters]));
    const limits = calculateRegulationLimits(regulations, plan.siteAreaSquareMeters, roadWidth);
    const envelope = buildMassingEnvelope(plan, imageSize, {
      setbackMeters: Math.max(0.5, regulations.conservativeSetbackMeters),
      maximumHeightMeters: regulations.conservativeMaximumHeightMeters ?? 45,
      roadSlope: regulations.roadSlantSlope ?? 1.5,
      adjacentSlant: { startHeightMeters: 31, slope: 2.5 },
      shadow: regulations.shadowRegulationApplies ? {
        latitudeDegrees: regulations.shadowCalculationLatitudeDegrees!,
        trueNorthAngleDegrees: plan.trueNorthAngleDegrees!,
        measurementHeightMeters: regulations.shadowMeasurementHeightMeters!,
        nearLimitHours: regulations.shadowTimeLimitNearHours!,
        farLimitHours: regulations.shadowTimeLimitFarHours!,
      } : null,
      maximumFootprintAreaSquareMeters: limits.permittedBuildingArea,
    });
    expect(envelope).not.toBeNull();
    expect(envelope!.footprint.length).toBeGreaterThanOrEqual(3);
    expect(envelope!.maximumHeightMeters).toBeGreaterThan(0);
    expect(envelope!.roof).toHaveLength(envelope!.footprint.length);
  }, 15_000);
});
