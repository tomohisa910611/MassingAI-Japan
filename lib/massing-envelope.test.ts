import { describe, expect, it } from "vitest";
import { buildMassingEnvelope, floorPlateAreaAtHeight, floorPlateTrianglesAtHeight, grossFloorAreaForLevels, insetConvexPolygon, minimumDistanceToBoundary, pointInPolygon, polygonArea, triangulatePolygon, winterSolsticeSunVector } from "./massing-envelope";
import { SitePlan } from "./site-plan";

describe("massing envelope", () => {
  it("insets every side of a rectangle by 0.5m", () => {
    const inset = insetConvexPolygon([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 0, z: 5 }], 0.5);
    expect(polygonArea(inset)).toBeCloseTo(36, 8);
    expect(inset).toEqual([{ x: 0.5, z: 0.5 }, { x: 9.5, z: 0.5 }, { x: 9.5, z: 4.5 }, { x: 0.5, z: 4.5 }]);
  });

  it("never places a setback polygon outside a concave site", () => {
    const site = [
      { x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 2 },
      { x: 3, z: 2 }, { x: 3, z: 7 }, { x: 0, z: 7 },
    ];
    const inset = insetConvexPolygon(site, 0.5);
    expect(inset.length).toBeGreaterThanOrEqual(3);
    inset.forEach((point) => {
      expect(pointInPolygon(point, site)).toBe(true);
      expect(minimumDistanceToBoundary(point, site)).toBeGreaterThanOrEqual(0.499999);
    });
  });

  it("triangulates a concave footprint without bridging across the missing corner", () => {
    const site = [
      { x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 2 },
      { x: 3, z: 2 }, { x: 3, z: 7 }, { x: 0, z: 7 },
    ];
    const triangles = triangulatePolygon(site);
    expect(triangles).toHaveLength(site.length - 2);
    const triangleArea = triangles.reduce((sum, triangle) =>
      sum + polygonArea(triangle.map((index) => site[index])), 0);
    expect(triangleArea).toBeCloseTo(polygonArea(site), 8);
    triangles.flatMap((triangle) => triangle.map((index) => site[index]))
      .forEach((point) => expect(pointInPolygon(point, site)).toBe(true));
  });

  it("calculates the winter-solstice sun south of a Japanese site at noon", () => {
    const sun = winterSolsticeSunVector(36, 12);
    expect(sun.up).toBeGreaterThan(0);
    expect(sun.north).toBeLessThan(0);
    expect(Math.abs(sun.east)).toBeLessThan(1e-8);
  });

  it("reduces the final 3D height until the 5/3-hour shadow limits are met", () => {
    const shadowPlan: SitePlan = {
      vertices: [
        { id: "A", x: 0, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "B", x: 1000, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "C", x: 1000, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "D", x: 0, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
      ],
      edges: [
        { startVertexId: "A", endVertexId: "B", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "B", endVertexId: "C", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "C", endVertexId: "D", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "D", endVertexId: "A", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
      ],
      geometrySource: "drawing_geometry", shapeEvidence: [], siteAreaSquareMeters: 100, overallConfidence: 1,
      orientation: "", roads: [], trueNorthAngleDegrees: 0, trueNorthSource: "printed_angle", trueNorthConfidence: 1, notes: [],
    };
    const envelope = buildMassingEnvelope(shadowPlan, { width: 1000, height: 1000 }, {
      setbackMeters: .5, maximumHeightMeters: 45, roadSlope: 1.5,
      shadow: { latitudeDegrees: 36, trueNorthAngleDegrees: 0, measurementHeightMeters: 4, nearLimitHours: 5, farLimitHours: 3 },
    });
    expect(envelope?.shadowAnalysis).not.toBeNull();
    expect(envelope!.shadowAnalysis!.heightScale).toBeLessThan(1);
    expect(envelope!.shadowAnalysis!.nearMaximumHours).toBeLessThanOrEqual(5);
    expect(envelope!.shadowAnalysis!.farMaximumHours).toBeLessThanOrEqual(3);
    expect(envelope!.maximumHeightMeters).toBeLessThan(45);
  });

  it("applies the ordinary road slant from the opposite road boundary", () => {
    const plan: SitePlan = {
      vertices: [
        { id: "A", x: 0, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "B", x: 1000, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "C", x: 1000, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "D", x: 0, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
      ],
      edges: [
        { startVertexId: "A", endVertexId: "B", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "B", endVertexId: "C", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "C", endVertexId: "D", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "D", endVertexId: "A", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
      ],
      geometrySource: "drawing_geometry", shapeEvidence: [], siteAreaSquareMeters: 100, overallConfidence: 1,
      orientation: "", roads: [{ legalClassification: "法42条1項1号", roadName: null, widthMeters: 8, positionDescription: null, adjacentEdgeStartVertexId: "D", adjacentEdgeEndVertexId: "A", confidence: 1 }],
      trueNorthAngleDegrees: 0, trueNorthSource: "north_arrow_estimate", trueNorthConfidence: 1, notes: [],
    };
    const envelope = buildMassingEnvelope(plan, { width: 1000, height: 1000 }, { setbackMeters: 0.5, maximumHeightMeters: 45, roadSlope: 1.5 });
    expect(envelope).not.toBeNull();
    expect(envelope!.minimumHeightMeters).toBeCloseTo(12.75, 8);
    expect(envelope!.maximumHeightMeters).toBeCloseTo(26.25, 8);
    expect(floorPlateAreaAtHeight(envelope!, 0)).toBeCloseTo(81, 8);
    expect(floorPlateAreaAtHeight(envelope!, 20)).toBeGreaterThan(0);
    expect(floorPlateAreaAtHeight(envelope!, 27)).toBe(0);
    expect(grossFloorAreaForLevels(envelope!, [0, 4, 8])).toBeCloseTo(243, 8);
    const solidPlates = floorPlateTrianglesAtHeight(envelope!, 20);
    expect(solidPlates.reduce((sum, plate) => sum + polygonArea(plate), 0)).toBeCloseTo(floorPlateAreaAtHeight(envelope!, 20), 8);
    solidPlates.flat().forEach((point) => {
      expect(pointInPolygon(point, envelope!.footprint)).toBe(true);
      const distanceFromFiniteRoad = Math.abs(point.x - envelope!.site[0].x);
      expect(1.5 * (8 + distanceFromFiniteRoad)).toBeGreaterThanOrEqual(20 - 1e-8);
    });
    expect(envelope!.site[0].z).toBeLessThan(envelope!.site[2].z);
    expect(envelope!.roadSurfaces).toHaveLength(1);

    const areaLimited = buildMassingEnvelope(plan, { width: 1000, height: 1000 }, {
      setbackMeters: 0.5, maximumHeightMeters: 45, roadSlope: 1.5,
      maximumFootprintAreaSquareMeters: 50,
    });
    expect(areaLimited!.footprintAreaSquareMeters).toBeCloseTo(50, 6);
  });

  it("measures a road slant from the finite road segment instead of its infinite extension", () => {
    const plan: SitePlan = {
      vertices: [
        { id: "A", x: 0, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "B", x: 200, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "C", x: 200, y: 200, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "D", x: 1000, y: 200, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "E", x: 1000, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "F", x: 0, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
      ],
      edges: [
        { startVertexId: "A", endVertexId: "B", lengthMeters: 2, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "B", endVertexId: "C", lengthMeters: 2, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "C", endVertexId: "D", lengthMeters: 8, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "D", endVertexId: "E", lengthMeters: 8, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "E", endVertexId: "F", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "F", endVertexId: "A", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
      ],
      geometrySource: "drawing_geometry", shapeEvidence: [], siteAreaSquareMeters: 84, overallConfidence: 1,
      orientation: "", roads: [{ legalClassification: null, roadName: null, widthMeters: 4, positionDescription: null, adjacentEdgeStartVertexId: "A", adjacentEdgeEndVertexId: "B", confidence: 1 }],
      trueNorthAngleDegrees: 0, trueNorthSource: "north_arrow_estimate", trueNorthConfidence: 1, notes: [],
    };
    const envelope = buildMassingEnvelope(plan, { width: 1000, height: 1000 }, {
      setbackMeters: .5, maximumHeightMeters: 45, roadSlope: 1.5,
    });
    const highest = envelope!.roof.reduce((best, point) => point.height > best.height ? point : best);
    const start = envelope!.site[0]; const end = envelope!.site[1];
    const dx = end.x - start.x; const dz = end.z - start.z;
    const segmentRatio = Math.max(0, Math.min(1,
      ((highest.x - start.x) * dx + (highest.z - start.z) * dz) / (dx * dx + dz * dz),
    ));
    const segmentDistance = Math.hypot(highest.x - (start.x + dx * segmentRatio), highest.z - (start.z + dz * segmentRatio));
    const infiniteLineDistance = Math.abs(dx * (start.z - highest.z) - (start.x - highest.x) * dz) / Math.hypot(dx, dz);
    expect(highest.height).toBeCloseTo(1.5 * (4 + segmentDistance), 8);
    expect(highest.height).toBeGreaterThan(1.5 * (4 + infiniteLineDistance) + 1);
  });

  it("uses the strict intersection of slants from multiple adjoining roads", () => {
    const base: SitePlan = {
      vertices: [
        { id: "A", x: 0, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "B", x: 1000, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "C", x: 1000, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "D", x: 0, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
      ],
      edges: [
        { startVertexId: "A", endVertexId: "B", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "B", endVertexId: "C", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "C", endVertexId: "D", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "D", endVertexId: "A", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
      ],
      geometrySource: "drawing_geometry", shapeEvidence: [], siteAreaSquareMeters: 100, overallConfidence: 1, orientation: "",
      roads: [
        { legalClassification: null, roadName: null, widthMeters: 8, positionDescription: "接道辺: D-A", adjacentEdgeStartVertexId: "D", adjacentEdgeEndVertexId: "A", confidence: 1 },
        { legalClassification: null, roadName: null, widthMeters: 4, positionDescription: "接道辺: A-B", adjacentEdgeStartVertexId: "A", adjacentEdgeEndVertexId: "B", confidence: 1 },
      ],
      trueNorthAngleDegrees: 0, trueNorthSource: "north_arrow_estimate", trueNorthConfidence: 1, notes: [],
    };
    const oneRoad = buildMassingEnvelope({ ...base, roads: [base.roads[0]] }, { width: 1000, height: 1000 }, { setbackMeters: .5, maximumHeightMeters: 45, roadSlope: 1.5 });
    const twoRoads = buildMassingEnvelope(base, { width: 1000, height: 1000 }, { setbackMeters: .5, maximumHeightMeters: 45, roadSlope: 1.5 });
    expect(twoRoads!.maximumHeightMeters).toBeLessThan(oneRoad!.maximumHeightMeters);
    expect(twoRoads!.minimumHeightMeters).toBeCloseTo(6.75, 8);
    expect(twoRoads!.roadSurfaces.length).toBeGreaterThanOrEqual(3);
  });

  it("applies a 31m plus 2.5 adjacent slant to non-road boundaries", () => {
    const basePlan: SitePlan = {
      vertices: [
        { id: "A", x: 0, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "B", x: 1000, y: 0, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "C", x: 1000, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
        { id: "D", x: 0, y: 1000, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
      ],
      edges: [
        { startVertexId: "A", endVertexId: "B", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "B", endVertexId: "C", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "C", endVertexId: "D", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
        { startVertexId: "D", endVertexId: "A", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
      ],
      geometrySource: "drawing_geometry", shapeEvidence: [], siteAreaSquareMeters: 100, overallConfidence: 1,
      orientation: "", roads: [], trueNorthAngleDegrees: 0, trueNorthSource: "north_arrow_estimate", trueNorthConfidence: 1, notes: [],
    };
    const envelope = buildMassingEnvelope(basePlan, { width: 1000, height: 1000 }, {
      setbackMeters: 0.5, maximumHeightMeters: 45, roadSlope: 1.5,
      adjacentSlant: { startHeightMeters: 31, slope: 2.5 },
    });
    expect(envelope?.maximumHeightMeters).toBeCloseTo(32.25, 8);
    expect(envelope?.minimumHeightMeters).toBeCloseTo(32.25, 8);
  });
});
