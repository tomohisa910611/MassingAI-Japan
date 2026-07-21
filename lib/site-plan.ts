import { z } from "zod";

export const VertexSchema = z.object({
  id: z.string().min(1),
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
  sourcePointName: z.string().nullable(),
  surveyedX: z.number().nullable(),
  surveyedY: z.number().nullable(),
  confidence: z.number().min(0).max(1),
});

export const EdgeSchema = z.object({
  startVertexId: z.string().min(1),
  endVertexId: z.string().min(1),
  lengthMeters: z.number().positive().nullable(),
  measurementSource: z.enum(["boundary_label", "coordinate_calculation", "manual", "inferred", "unclear"]),
  confidence: z.number().min(0).max(1),
});

export const ShapeEvidenceSchema = z.object({
  kind: z.enum(["diagonal", "triangle_base", "triangle_height", "coordinate_table", "other"]),
  label: z.string(),
  valueMeters: z.number().positive().nullable(),
  relatedVertexIds: z.array(z.string()).max(4),
  confidence: z.number().min(0).max(1),
});

export const RoadInformationSchema = z.object({
  legalClassification: z.string().nullable(),
  roadName: z.string().nullable(),
  widthMeters: z.number().positive().nullable(),
  positionDescription: z.string().nullable(),
  adjacentEdgeStartVertexId: z.string().nullable(),
  adjacentEdgeEndVertexId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const SitePlanSchema = z.object({
  // Large cadastral drawings frequently contain several dozen boundary points.
  // The previous limit of 20 silently truncated real sites and created a false
  // closing edge from point 20 back to point 1.
  vertices: z.array(VertexSchema).min(3).max(120),
  edges: z.array(EdgeSchema).min(3).max(120),
  geometrySource: z.enum(["drawing_geometry", "coordinate_table", "mixed"]),
  shapeEvidence: z.array(ShapeEvidenceSchema).max(30),
  siteAreaSquareMeters: z.number().positive().nullable(),
  overallConfidence: z.number().min(0).max(1),
  orientation: z.string(),
  roads: z.array(RoadInformationSchema).max(8),
  trueNorthAngleDegrees: z.number().min(0).max(360).nullable(),
  trueNorthSource: z.enum(["printed_angle", "north_arrow_estimate", "coordinate_calculation", "unclear"]),
  trueNorthConfidence: z.number().min(0).max(1),
  notes: z.array(z.string()).max(12),
});

export type Vertex = z.infer<typeof VertexSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type ShapeEvidence = z.infer<typeof ShapeEvidenceSchema>;
export type RoadInformation = z.infer<typeof RoadInformationSchema>;
export type SitePlan = z.infer<typeof SitePlanSchema>;

export type ImageSize = { width: number; height: number };
export type ImagePoint = { x: number; y: number };

/** 測量図の AA-BB-CC（度-分-秒）表記を10進角へ変換する。 */
export function parseSurveyBearingDegrees(value: string) {
  const match = value.trim().match(/^(\d{1,3})\s*[-ー－]\s*(\d{1,2})\s*[-ー－]\s*(\d{1,2}(?:\.\d+)?)$/);
  if (!match) return null;
  const degrees = Number(match[1]); const minutes = Number(match[2]); const seconds = Number(match[3]);
  if (degrees >= 360 || minutes >= 60 || seconds >= 60) return null;
  return degrees + minutes / 60 + seconds / 3600;
}

/** 図面上の線方向と、その線の測量方位角から図面上の真北角を求める。 */
export function trueNorthFromDrawingBearing(lineClockwiseFromPageUp: number, bearingFromTrueNorth: number) {
  return (lineClockwiseFromPageUp - bearingFromTrueNorth + 360) % 360;
}

function roadEdgePairsFromDescription(description: string) {
  return [...description.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*[-–—〜~]\s*([A-Za-z][A-Za-z0-9_]*)/g)]
    .map((match) => [match[1], match[2]] as const);
}

export function roadWidthForEdge(
  road: RoadInformation,
  edge: Edge,
): number | null {
  const description = road.positionDescription ?? "";
  const measurements = [...description.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*[-–—〜~]\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*([0-9]+(?:\.[0-9]+)?)/g)];
  const match = measurements.find((item) => (
    (item[1].toLowerCase() === edge.startVertexId.toLowerCase() && item[2].toLowerCase() === edge.endVertexId.toLowerCase()) ||
    (item[1].toLowerCase() === edge.endVertexId.toLowerCase() && item[2].toLowerCase() === edge.startVertexId.toLowerCase())
  ));
  return match ? Number(match[3]) : road.widthMeters;
}

export function resolveRoadEdgeIndices(
  road: RoadInformation,
  edges: Edge[],
  vertices: Vertex[],
): number[] {
  const describedPairs = roadEdgePairsFromDescription(road.positionDescription ?? "");
  const describedIndices = describedPairs.flatMap(([first, second]) => {
    const index = edges.findIndex((edge) => (
      (edge.startVertexId.toLowerCase() === first.toLowerCase() && edge.endVertexId.toLowerCase() === second.toLowerCase()) ||
      (edge.startVertexId.toLowerCase() === second.toLowerCase() && edge.endVertexId.toLowerCase() === first.toLowerCase())
    ));
    return index >= 0 ? [index] : [];
  });
  if (describedIndices.length) return [...new Set(describedIndices)];

  const explicitIndex = edges.findIndex((edge) => (
    (edge.startVertexId === road.adjacentEdgeStartVertexId && edge.endVertexId === road.adjacentEdgeEndVertexId) ||
    (edge.startVertexId === road.adjacentEdgeEndVertexId && edge.endVertexId === road.adjacentEdgeStartVertexId)
  ));
  if (explicitIndex >= 0) return [explicitIndex];

  const description = road.positionDescription ?? "";
  const byId = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const midpoints = edges.map((edge, index) => {
    const start = byId.get(edge.startVertexId);
    const end = byId.get(edge.endVertexId);
    return start && end ? { index, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : null;
  }).filter((value): value is { index: number; x: number; y: number } => value !== null);
  if (!midpoints.length) return [];

  if (/左|西/.test(description)) return [midpoints.reduce((best, item) => item.x < best.x ? item : best).index];
  if (/右|東/.test(description)) return [midpoints.reduce((best, item) => item.x > best.x ? item : best).index];
  if (/上|北/.test(description)) return [midpoints.reduce((best, item) => item.y < best.y ? item : best).index];
  if (/下|南/.test(description)) return [midpoints.reduce((best, item) => item.y > best.y ? item : best).index];
  return [];
}

export function resolveRoadEdgeIndex(
  road: RoadInformation,
  edges: Edge[],
  vertices: Vertex[],
): number | null {
  const indices = resolveRoadEdgeIndices(road, edges, vertices);
  if (indices.length) return indices[0];
  return null;
  /* Legacy fallback retained below for reference; all current resolution is
     handled by resolveRoadEdgeIndices so a road may adjoin several bends. */
  /*
  const explicitIndex = edges.findIndex((edge) => (
    (edge.startVertexId === road.adjacentEdgeStartVertexId && edge.endVertexId === road.adjacentEdgeEndVertexId) ||
    (edge.startVertexId === road.adjacentEdgeEndVertexId && edge.endVertexId === road.adjacentEdgeStartVertexId)
  ));
  if (explicitIndex >= 0) return explicitIndex;

  const description = road.positionDescription ?? "";
  const edgeHint = description.match(/([A-Za-z0-9_]+)\s*[-–—→]\s*([A-Za-z0-9_]+)\s*辺/i);
  if (edgeHint) {
    const hintedIndex = edges.findIndex((edge) => (
      (edge.startVertexId.toLowerCase() === edgeHint[1].toLowerCase() && edge.endVertexId.toLowerCase() === edgeHint[2].toLowerCase()) ||
      (edge.startVertexId.toLowerCase() === edgeHint[2].toLowerCase() && edge.endVertexId.toLowerCase() === edgeHint[1].toLowerCase())
    ));
    if (hintedIndex >= 0) return hintedIndex;
  }

  const byId = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const midpoints = edges.map((edge, index) => {
    const start = byId.get(edge.startVertexId);
    const end = byId.get(edge.endVertexId);
    return start && end ? { index, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : null;
  }).filter((value): value is { index: number; x: number; y: number } => value !== null);
  if (!midpoints.length) return null;

  if (/左/.test(description)) return midpoints.reduce((best, item) => item.x < best.x ? item : best).index;
  if (/右/.test(description)) return midpoints.reduce((best, item) => item.x > best.x ? item : best).index;
  if (/上|北側/.test(description)) return midpoints.reduce((best, item) => item.y < best.y ? item : best).index;
  if (/下|南側/.test(description)) return midpoints.reduce((best, item) => item.y > best.y ? item : best).index;
  return null;
  */
}

export function completeCoordinateDerivedMeasurements(plan: SitePlan): SitePlan {
  const byId = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
  return {
    ...plan,
    edges: plan.edges.map((edge) => {
      const start = byId.get(edge.startVertexId);
      const end = byId.get(edge.endVertexId);
      if (
        edge.lengthMeters !== null ||
        start?.surveyedX === null || start?.surveyedY === null ||
        end?.surveyedX === null || end?.surveyedY === null ||
        start?.surveyedX === undefined || start?.surveyedY === undefined ||
        end?.surveyedX === undefined || end?.surveyedY === undefined
      ) {
        return edge;
      }
      return {
        ...edge,
        lengthMeters: Math.hypot(
          end.surveyedX - start.surveyedX,
          end.surveyedY - start.surveyedY,
        ),
        measurementSource: "coordinate_calculation" as const,
      };
    }),
  };
}

export type CoordinateMeasurementConflict = {
  edgeIndex: number;
  edgeName: string;
  printedMeters: number;
  coordinateMeters: number;
  differenceMeters: number;
};

/**
 * 図面の印字寸法と、対象求積表の座標から得た寸法を独立に照合する。
 * 印字値は勝手に上書きせず、矛盾を品質情報として残す。
 */
export function auditCoordinateMeasurements(plan: SitePlan): CoordinateMeasurementConflict[] {
  const byId = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
  return plan.edges.flatMap((edge, edgeIndex) => {
    const start = byId.get(edge.startVertexId);
    const end = byId.get(edge.endVertexId);
    if (
      edge.lengthMeters === null ||
      start?.surveyedX == null || start.surveyedY == null ||
      end?.surveyedX == null || end.surveyedY == null
    ) return [];
    const coordinateMeters = Math.hypot(end.surveyedX - start.surveyedX, end.surveyedY - start.surveyedY);
    const differenceMeters = Math.abs(edge.lengthMeters - coordinateMeters);
    const toleranceMeters = Math.max(0.05, coordinateMeters * 0.005);
    if (differenceMeters <= toleranceMeters) return [];
    return [{
      edgeIndex,
      edgeName: `${edge.startVertexId}-${edge.endVertexId}`,
      printedMeters: edge.lengthMeters,
      coordinateMeters,
      differenceMeters,
    }];
  });
}

/** 新しい案件にも共通適用する、解析後の証拠整合ルール。 */
export function applyEvidenceQualityRules(plan: SitePlan): SitePlan {
  const completed = completeCoordinateDerivedMeasurements(plan);
  const areaAdjusted = completed.siteAreaSquareMeters === null ? completed : {
    ...completed,
    siteAreaSquareMeters: Math.round((completed.siteAreaSquareMeters + Number.EPSILON) * 100) / 100,
  };
  const conflicts = auditCoordinateMeasurements(areaAdjusted);
  if (!conflicts.length) return areaAdjusted;
  const names = conflicts.slice(0, 5).map((conflict) => conflict.edgeName).join("、");
  return {
    ...areaAdjusted,
    overallConfidence: Math.min(areaAdjusted.overallConfidence, 0.75),
    notes: [
      ...areaAdjusted.notes.filter((note) => !note.startsWith("寸法整合チェック:")),
      `寸法整合チェック: ${names}${conflicts.length > 5 ? "ほか" : ""}で印字寸法と対象求積表座標に差があります。印字値を保持して要確認としました。`,
    ].slice(0, 12),
  };
}

export function areaAtDrawingPrecision(value: number | null, drawingArea: number | null): number | null {
  if (value === null) return null;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (drawingArea === null) return rounded;
  const drawingRounded = Math.round((drawingArea + Number.EPSILON) * 100) / 100;
  return Math.abs(value - drawingArea) <= 0.015 ? drawingRounded : rounded;
}

export function distanceInImagePixels(a: Vertex, b: Vertex, image: ImageSize): number {
  const dx = ((b.x - a.x) / 1000) * image.width;
  const dy = ((b.y - a.y) / 1000) * image.height;
  return Math.hypot(dx, dy);
}

export function polygonAreaSquareMeters(
  vertices: Vertex[],
  image: ImageSize,
  pixelsPerMeter: number | null,
): number | null {
  if (!pixelsPerMeter || vertices.length < 3) return null;
  let twiceAreaInPixels = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const currentX = (current.x / 1000) * image.width;
    const currentY = (current.y / 1000) * image.height;
    const nextX = (next.x / 1000) * image.width;
    const nextY = (next.y / 1000) * image.height;
    twiceAreaInPixels += currentX * nextY - nextX * currentY;
  }
  return Math.abs(twiceAreaInPixels) / 2 / (pixelsPerMeter * pixelsPerMeter);
}

export function polygonAreaInImagePixels(vertices: Vertex[], image: ImageSize): number {
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertexToImagePoint(vertices[index], image);
    const next = vertexToImagePoint(vertices[(index + 1) % vertices.length], image);
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

export function polygonAreaFromReference(
  vertices: Vertex[],
  image: ImageSize,
  referenceVertices: Vertex[],
  referenceAreaSquareMeters: number | null,
): number | null {
  if (!referenceAreaSquareMeters) return null;
  const referencePixelArea = polygonAreaInImagePixels(referenceVertices, image);
  if (referencePixelArea <= 0) return null;
  return referenceAreaSquareMeters * polygonAreaInImagePixels(vertices, image) / referencePixelArea;
}

export function circleIntersections(
  firstCenter: ImagePoint,
  firstRadius: number,
  secondCenter: ImagePoint,
  secondRadius: number,
): ImagePoint[] {
  const dx = secondCenter.x - firstCenter.x;
  const dy = secondCenter.y - firstCenter.y;
  const centerDistance = Math.hypot(dx, dy);
  if (
    centerDistance === 0 ||
    centerDistance > firstRadius + secondRadius ||
    centerDistance < Math.abs(firstRadius - secondRadius)
  ) {
    return [];
  }

  const along = (
    firstRadius * firstRadius -
    secondRadius * secondRadius +
    centerDistance * centerDistance
  ) / (2 * centerDistance);
  const heightSquared = Math.max(0, firstRadius * firstRadius - along * along);
  const height = Math.sqrt(heightSquared);
  const baseX = firstCenter.x + (along * dx) / centerDistance;
  const baseY = firstCenter.y + (along * dy) / centerDistance;
  const offsetX = (-dy * height) / centerDistance;
  const offsetY = (dx * height) / centerDistance;

  const first = { x: baseX + offsetX, y: baseY + offsetY };
  if (height < 0.000001) return [first];
  return [first, { x: baseX - offsetX, y: baseY - offsetY }];
}

export function vertexToImagePoint(vertex: Vertex, image: ImageSize): ImagePoint {
  return { x: (vertex.x / 1000) * image.width, y: (vertex.y / 1000) * image.height };
}

export function imagePointToVertexPosition(point: ImagePoint, image: ImageSize): ImagePoint {
  return { x: (point.x / image.width) * 1000, y: (point.y / image.height) * 1000 };
}

export function estimatePixelsPerMeter(plan: SitePlan, image: ImageSize): number | null {
  const byId = new Map(plan.vertices.map((vertex) => [vertex.id, vertex]));
  const estimates = plan.edges.flatMap((edge) => {
    if (!edge.lengthMeters) return [];
    const start = byId.get(edge.startVertexId);
    const end = byId.get(edge.endVertexId);
    if (!start || !end) return [];
    const pixels = distanceInImagePixels(start, end, image);
    return pixels > 0 ? [pixels / edge.lengthMeters] : [];
  });

  if (!estimates.length) return null;
  estimates.sort((a, b) => a - b);
  const middle = Math.floor(estimates.length / 2);
  return estimates.length % 2
    ? estimates[middle]
    : (estimates[middle - 1] + estimates[middle]) / 2;
}

export function adjustedEdgeLength(
  edge: Edge,
  vertices: Vertex[],
  image: ImageSize,
  pixelsPerMeter: number | null,
): number | null {
  // 印字された寸法・座標値・手入力値を、画像上の見かけの縮尺より優先する。
  if (edge.lengthMeters !== null) return edge.lengthMeters;
  if (!pixelsPerMeter) return edge.lengthMeters;
  const start = vertices.find((vertex) => vertex.id === edge.startVertexId);
  const end = vertices.find((vertex) => vertex.id === edge.endVertexId);
  if (!start || !end) return edge.lengthMeters;
  return distanceInImagePixels(start, end, image) / pixelsPerMeter;
}

export function validateTopology(plan: SitePlan): string | null {
  const ids = new Set(plan.vertices.map((vertex) => vertex.id));
  if (ids.size !== plan.vertices.length) return "頂点の名前が重複しています。";
  if (plan.edges.length !== plan.vertices.length) {
    return "境界線を一周分読み取れませんでした。より鮮明な画像をお試しください。";
  }
  for (const edge of plan.edges) {
    if (!ids.has(edge.startVertexId) || !ids.has(edge.endVertexId)) {
      return "境界線が不明な頂点を参照しています。";
    }
  }
  const seenStarts = new Set(plan.edges.map((edge) => edge.startVertexId));
  const seenEnds = new Set(plan.edges.map((edge) => edge.endVertexId));
  if (seenStarts.size !== plan.vertices.length || seenEnds.size !== plan.vertices.length) {
    return "境界線が一周する順番になっていません。より鮮明な画像をお試しください。";
  }
  for (let index = 0; index < plan.vertices.length; index += 1) {
    const expectedStart = plan.vertices[index].id;
    const expectedEnd = plan.vertices[(index + 1) % plan.vertices.length].id;
    const edge = plan.edges[index];
    if (edge.startVertexId !== expectedStart || edge.endVertexId !== expectedEnd) {
      return "頂点と境界線の順番が一致していません。もう一度解析してください。";
    }
  }
  for (const evidence of plan.shapeEvidence) {
    if (evidence.relatedVertexIds.some((id) => !ids.has(id))) {
      return "補助寸法が不明な頂点を参照しています。";
    }
  }
  return null;
}
