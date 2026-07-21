import { describe, expect, it } from "vitest";
import {
  adjustedEdgeLength,
  areaAtDrawingPrecision,
  applyEvidenceQualityRules,
  auditCoordinateMeasurements,
  circleIntersections,
  completeCoordinateDerivedMeasurements,
  estimatePixelsPerMeter,
  polygonAreaFromReference,
  polygonAreaSquareMeters,
  parseSurveyBearingDegrees,
  resolveRoadEdgeIndex,
  resolveRoadEdgeIndices,
  roadWidthForEdge,
  SitePlanSchema,
  SitePlan,
  trueNorthFromDrawingBearing,
} from "./site-plan";

const plan: SitePlan = {
  vertices: [
    { id: "A", x: 100, y: 100, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
    { id: "B", x: 600, y: 100, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
    { id: "C", x: 600, y: 600, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
    { id: "D", x: 100, y: 600, sourcePointName: null, surveyedX: null, surveyedY: null, confidence: 1 },
  ],
  edges: [
    { startVertexId: "A", endVertexId: "B", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
    { startVertexId: "B", endVertexId: "C", lengthMeters: 5, measurementSource: "boundary_label", confidence: 1 },
    { startVertexId: "C", endVertexId: "D", lengthMeters: 10, measurementSource: "boundary_label", confidence: 1 },
    { startVertexId: "D", endVertexId: "A", lengthMeters: 5, measurementSource: "boundary_label", confidence: 1 },
  ],
  geometrySource: "drawing_geometry",
  shapeEvidence: [],
  siteAreaSquareMeters: 50,
  overallConfidence: 1,
  orientation: "North is up",
  roads: [],
  trueNorthAngleDegrees: 0,
  trueNorthSource: "north_arrow_estimate",
  trueNorthConfidence: 1,
  notes: [],
};

describe("geometry scale", () => {
  it("reads survey bearings written as degrees-minutes-seconds", () => {
    expect(parseSurveyBearingDegrees("95-00-22")).toBeCloseTo(95.006111, 6);
    expect(trueNorthFromDrawingBearing(90, parseSurveyBearingDegrees("95-00-22")!)).toBeCloseTo(354.993889, 6);
  });
  it("estimates a stable image scale from labelled edges", () => {
    expect(estimatePixelsPerMeter(plan, { width: 2000, height: 1000 })).toBe(100);
  });

  it("keeps an authoritative printed edge length", () => {
    const scale = estimatePixelsPerMeter(plan, { width: 2000, height: 1000 });
    const moved = plan.vertices.map((vertex) => vertex.id === "B" ? { ...vertex, x: 700 } : vertex);
    expect(adjustedEdgeLength(plan.edges[0], moved, { width: 2000, height: 1000 }, scale)).toBe(10);
  });

  it("calculates the polygon area from the fixed drawing scale", () => {
    const scale = estimatePixelsPerMeter(plan, { width: 2000, height: 1000 });
    expect(polygonAreaSquareMeters(plan.vertices, { width: 2000, height: 1000 }, scale)).toBe(50);
  });

  it("recalculates area relative to the stated original area", () => {
    const wider = plan.vertices.map((vertex) => vertex.id === "B" || vertex.id === "C" ? { ...vertex, x: 1100 } : vertex);
    expect(polygonAreaFromReference(wider, { width: 2000, height: 1000 }, plan.vertices, 50)).toBe(100);
  });

  it("keeps the drawing's two-decimal area when a third-decimal rounding difference appears", () => {
    expect(areaAtDrawingPrecision(1000.005, 1000.00)).toBe(1000.00);
    expect(areaAtDrawingPrecision(1000.005, 1000.01)).toBe(1000.01);
    expect(areaAtDrawingPrecision(1000.026, 1000.00)).toBe(1000.03);
  });

  it("limits a vertex to the two intersections of its adjacent lengths", () => {
    const candidates = circleIntersections({ x: 0, y: 0 }, 5, { x: 6, y: 0 }, 5);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({ x: 3, y: 4 });
    expect(candidates[1]).toEqual({ x: 3, y: -4 });
  });

  it("calculates a missing boundary length from surveyed coordinates", () => {
    const coordinatePlan: SitePlan = {
      ...plan,
      geometrySource: "coordinate_table",
      vertices: plan.vertices.map((vertex, index) => ({
        ...vertex,
        sourcePointName: vertex.id,
        surveyedX: index === 1 || index === 2 ? 3 : 0,
        surveyedY: index >= 2 ? 4 : 0,
      })),
      edges: plan.edges.map((edge) => ({
        ...edge,
        lengthMeters: null,
        measurementSource: "unclear",
      })),
    };

    const completed = completeCoordinateDerivedMeasurements(coordinatePlan);
    expect(completed.edges.map((edge) => edge.lengthMeters)).toEqual([3, 4, 3, 4]);
    expect(completed.edges.every((edge) => edge.measurementSource === "coordinate_calculation")).toBe(true);
  });

  it("detects an OCR dimension that conflicts with target-parcel coordinates", () => {
    const coordinatePlan: SitePlan = {
      ...plan,
      geometrySource: "mixed",
      vertices: plan.vertices.map((vertex, index) => ({
        ...vertex,
        surveyedX: index === 1 || index === 2 ? 4.49 : 0,
        surveyedY: index >= 2 ? 4 : 0,
      })),
      edges: plan.edges.map((edge, index) => ({
        ...edge,
        lengthMeters: index === 0 ? 2.96 : [4.49, 4, 4.49, 4][index],
        confidence: index === 0 ? 0.7 : 1,
      })),
    };
    const conflicts = auditCoordinateMeasurements(coordinatePlan);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].edgeName).toBe("A-B");
    expect(conflicts[0].coordinateMeters).toBeCloseTo(4.49, 3);
    const checked = applyEvidenceQualityRules(coordinatePlan);
    expect(checked.overallConfidence).toBe(0.75);
    expect(checked.notes.at(-1)).toContain("寸法整合チェック");
  });

  it("matches a road to its adjoining boundary edge", () => {
    expect(resolveRoadEdgeIndex({
      legalClassification: "法42条1項1号道路",
      roadName: null,
      widthMeters: 7.97,
      positionDescription: "対象敷地の左側（D-A辺）に接道",
      adjacentEdgeStartVertexId: "D",
      adjacentEdgeEndVertexId: "A",
      confidence: 1,
    }, plan.edges, plan.vertices)).toBe(3);
  });

  it("accepts complex parcels with more than 20 boundary points", () => {
    const vertices = Array.from({ length: 32 }, (_, index) => ({
      id: `V${index + 1}`, x: 500 + 300 * Math.cos(index * Math.PI / 16), y: 500 + 300 * Math.sin(index * Math.PI / 16),
      sourcePointName: `P${index + 1}`, surveyedX: null, surveyedY: null, confidence: 1,
    }));
    const edges = vertices.map((vertex, index) => ({
      startVertexId: vertex.id, endVertexId: vertices[(index + 1) % vertices.length].id,
      lengthMeters: 2, measurementSource: "boundary_label" as const, confidence: 1,
    }));
    expect(SitePlanSchema.safeParse({ ...plan, vertices, edges }).success).toBe(true);
  });

  it("maps one bent road to every listed adjoining segment", () => {
    expect(resolveRoadEdgeIndices({
      legalClassification: null,
      roadName: null,
      widthMeters: 5.2,
      positionDescription: "北側のジグザグ道路。接道辺: A-B, B-C",
      adjacentEdgeStartVertexId: "A",
      adjacentEdgeEndVertexId: "B",
      confidence: 1,
    }, plan.edges, plan.vertices)).toEqual([0, 1]);
  });

  it("uses the printed width for each segment of a variable-width road", () => {
    const road = {
      legalClassification: null,
      roadName: null,
      widthMeters: 5.06,
      positionDescription: "接道辺: A-B, B-C。幅員変化: A-B=5.060, B-C=5.200。",
      adjacentEdgeStartVertexId: "A",
      adjacentEdgeEndVertexId: "B",
      confidence: 1,
    };
    expect(roadWidthForEdge(road, plan.edges[0])).toBe(5.06);
    expect(roadWidthForEdge(road, plan.edges[1])).toBe(5.2);
  });
});
