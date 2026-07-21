import { estimatePixelsPerMeter, ImageSize, resolveRoadEdgeIndices, roadWidthForEdge, SitePlan, vertexToImagePoint } from "./site-plan";

export type PlanPoint = { x: number; z: number };
export type EnvelopePoint = PlanPoint & { height: number };

export type MassingEnvelope = {
  site: PlanPoint[];
  footprint: PlanPoint[];
  roof: EnvelopePoint[];
  roadSurfaces: PlanPoint[][];
  roadEdge: [PlanPoint, PlanPoint] | null;
  setbackMeters: number;
  roadWidthMeters: number | null;
  roadSlope: number | null;
  maximumHeightMeters: number;
  minimumHeightMeters: number;
  footprintAreaSquareMeters: number;
  shadowAnalysis: ShadowAnalysisResult | null;
};

type AdjacentSlant = { startHeightMeters: number; slope: number };
export type ShadowConstraint = {
  latitudeDegrees: number;
  trueNorthAngleDegrees: number;
  measurementHeightMeters: number;
  nearLimitHours: number;
  farLimitHours: number;
};
export type ShadowAnalysisResult = {
  applied: true;
  heightScale: number;
  nearMaximumHours: number;
  farMaximumHours: number;
  timeStepMinutes: number;
  sampleGridMeters: number;
};

export function signedArea(points: PlanPoint[]) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0) / 2;
}

export function polygonArea(points: PlanPoint[]) {
  return Math.abs(signedArea(points));
}

function distanceToSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const denominator = dx * dx + dz * dz;
  const ratio = denominator <= 1e-12 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / denominator,
  ));
  return Math.hypot(point.x - (start.x + dx * ratio), point.z - (start.z + dz * ratio));
}

function segmentDistance(firstStart: PlanPoint, firstEnd: PlanPoint, secondStart: PlanPoint, secondEnd: PlanPoint) {
  const cross = (a: PlanPoint, b: PlanPoint, c: PlanPoint) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const firstA = cross(firstStart, firstEnd, secondStart);
  const firstB = cross(firstStart, firstEnd, secondEnd);
  const secondA = cross(secondStart, secondEnd, firstStart);
  const secondB = cross(secondStart, secondEnd, firstEnd);
  const boxesOverlap = Math.max(Math.min(firstStart.x, firstEnd.x), Math.min(secondStart.x, secondEnd.x)) <=
      Math.min(Math.max(firstStart.x, firstEnd.x), Math.max(secondStart.x, secondEnd.x)) + 1e-9 &&
    Math.max(Math.min(firstStart.z, firstEnd.z), Math.min(secondStart.z, secondEnd.z)) <=
      Math.min(Math.max(firstStart.z, firstEnd.z), Math.max(secondStart.z, secondEnd.z)) + 1e-9;
  if (boxesOverlap && firstA * firstB <= 0 && secondA * secondB <= 0) return 0;
  return Math.min(
    distanceToSegment(firstStart, secondStart, secondEnd),
    distanceToSegment(firstEnd, secondStart, secondEnd),
    distanceToSegment(secondStart, firstStart, firstEnd),
    distanceToSegment(secondEnd, firstStart, firstEnd),
  );
}

export function pointInPolygon(point: PlanPoint, polygon: PlanPoint[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (distanceToSegment(point, previousPoint, currentPoint) < 1e-8) return true;
    const crosses = (currentPoint.z > point.z) !== (previousPoint.z > point.z) &&
      point.x < ((previousPoint.x - currentPoint.x) * (point.z - currentPoint.z)) /
        (previousPoint.z - currentPoint.z) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function minimumDistanceToBoundary(point: PlanPoint, polygon: PlanPoint[]) {
  return Math.min(...polygon.map((start, index) => distanceToSegment(point, start, polygon[(index + 1) % polygon.length])));
}

function convexHull(points: PlanPoint[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length <= 2) return sorted;
  const cross = (a: PlanPoint, b: PlanPoint, c: PlanPoint) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const lower: PlanPoint[] = [];
  sorted.forEach((point) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper: PlanPoint[] = [];
  [...sorted].reverse().forEach((point) => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  });
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 冬至日の太陽方向。east/north/up は建物から太陽へ向かう単位ベクトル。 */
export function winterSolsticeSunVector(latitudeDegrees: number, solarTimeHours: number) {
  const latitude = latitudeDegrees * Math.PI / 180;
  const declination = -23.44 * Math.PI / 180;
  const hourAngle = (solarTimeHours - 12) * 15 * Math.PI / 180;
  return {
    east: -Math.cos(declination) * Math.sin(hourAngle),
    north: Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * Math.cos(declination) * Math.cos(hourAngle),
    up: Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  };
}

function analyzeShadowRoof(site: PlanPoint[], footprint: PlanPoint[], roof: EnvelopePoint[], constraint: ShadowConstraint) {
  const stepMinutes = 30;
  const stepHours = stepMinutes / 60;
  // 大規模敷地でも画面を止めず、概ね1,200点以上を検査する可変格子。格子半幅を規制帯判定へ見込む。
  const gridMeters = Math.max(1, Math.sqrt(Math.max(polygonArea(site), 1) / 1200));
  const northRadians = constraint.trueNorthAngleDegrees * Math.PI / 180;
  const north = { x: Math.sin(northRadians), z: -Math.cos(northRadians) };
  const east = { x: Math.cos(northRadians), z: Math.sin(northRadians) };
  const roofTriangles = triangulatePolygon(footprint);
  const durations = new Map<string, { point: PlanPoint; hours: number; triangleHours: number[] }>();
  for (let time = 8; time <= 16 + 1e-8; time += stepHours) {
    const sun = winterSolsticeSunVector(constraint.latitudeDegrees, time);
    if (sun.up <= 1e-6) continue;
    const sunX = east.x * sun.east + north.x * sun.north;
    const sunZ = east.z * sun.east + north.z * sun.north;
    const projectedRoof = roof.map((point) => {
      const vertical = Math.max(0, point.height - constraint.measurementHeightMeters);
      return { x: point.x - sunX / sun.up * vertical, z: point.z - sunZ / sun.up * vertical };
    });
    // 凹形敷地全体を1枚の凸包にすると欠け部分を影と誤認するため、敷地内三角形ごとの柱体投影を合成する。
    const shadows = roofTriangles.map((triangle) => convexHull([
      ...triangle.map((index) => footprint[index]),
      ...triangle.map((index) => projectedRoof[index]),
    ])).filter((shadow) => shadow.length >= 3);
    if (!shadows.length) continue;
    const shadowPoints = shadows.flat();
    const minX = Math.floor(Math.min(...shadowPoints.map((point) => point.x)) / gridMeters) * gridMeters;
    const maxX = Math.ceil(Math.max(...shadowPoints.map((point) => point.x)) / gridMeters) * gridMeters;
    const minZ = Math.floor(Math.min(...shadowPoints.map((point) => point.z)) / gridMeters) * gridMeters;
    const maxZ = Math.ceil(Math.max(...shadowPoints.map((point) => point.z)) / gridMeters) * gridMeters;
    for (let x = minX; x <= maxX + 1e-8; x += gridMeters) for (let z = minZ; z <= maxZ + 1e-8; z += gridMeters) {
      const point = { x, z };
      if (pointInPolygon(point, site)) continue;
      const coveringTriangles = shadows.flatMap((shadow, triangleIndex) => pointInPolygon(point, shadow) ? [triangleIndex] : []);
      if (!coveringTriangles.length) continue;
      const distance = minimumDistanceToBoundary(point, site);
      if (distance < 5 - gridMeters * .5) continue;
      const key = `${Math.round(x / gridMeters)},${Math.round(z / gridMeters)}`;
      const previous = durations.get(key) ?? { point, hours: 0, triangleHours: Array(roofTriangles.length).fill(0) };
      previous.hours += stepHours;
      coveringTriangles.forEach((triangleIndex) => { previous.triangleHours[triangleIndex] += stepHours; });
      durations.set(key, previous);
    }
  }
  let nearMaximumHours = 0; let farMaximumHours = 0;
  const trianglePenalties = Array(roofTriangles.length).fill(0) as number[];
  durations.forEach(({ point, hours, triangleHours }) => {
    const distance = minimumDistanceToBoundary(point, site);
    const limit = distance < 10 ? constraint.nearLimitHours : constraint.farLimitHours;
    if (distance < 10) nearMaximumHours = Math.max(nearMaximumHours, hours); else farMaximumHours = Math.max(farMaximumHours, hours);
    const excess = Math.max(0, hours - limit);
    if (excess > 0) triangleHours.forEach((hitHours, triangleIndex) => {
      trianglePenalties[triangleIndex] += excess * hitHours;
    });
  });
  return { nearMaximumHours, farMaximumHours, stepMinutes, gridMeters, trianglePenalties, roofTriangles };
}

function applyShadowConstraint(site: PlanPoint[], footprint: PlanPoint[], roof: EnvelopePoint[], constraint: ShadowConstraint) {
  const compliant = (result: ReturnType<typeof analyzeShadowRoof>) =>
    result.nearMaximumHours <= constraint.nearLimitHours + 1e-8 &&
    result.farMaximumHours <= constraint.farLimitHours + 1e-8;
  let adjustedRoof = roof.map((point) => ({ ...point }));
  let result = analyzeShadowRoof(site, footprint, adjustedRoof, constraint);
  for (let iteration = 0; iteration < 18 && !compliant(result); iteration += 1) {
    const vertexPenalties = Array(adjustedRoof.length).fill(0) as number[];
    result.roofTriangles.forEach((triangle, triangleIndex) => triangle.forEach((vertexIndex) => {
      vertexPenalties[vertexIndex] += result.trianglePenalties[triangleIndex];
    }));
    const maximumPenalty = Math.max(...vertexPenalties);
    if (maximumPenalty <= 1e-8) break;
    adjustedRoof = adjustedRoof.map((point, index) => {
      const ratio = vertexPenalties[index] / maximumPenalty;
      if (ratio < .08) return point;
      const reduction = .12 + .18 * ratio;
      return {
        ...point,
        height: constraint.measurementHeightMeters +
          Math.max(0, point.height - constraint.measurementHeightMeters) * (1 - reduction),
      };
    });
    result = analyzeShadowRoof(site, footprint, adjustedRoof, constraint);
  }
  const originalExcess = roof.reduce((sum, point) => sum + Math.max(0, point.height - constraint.measurementHeightMeters), 0);
  const adjustedExcess = adjustedRoof.reduce((sum, point) => sum + Math.max(0, point.height - constraint.measurementHeightMeters), 0);
  const scale = originalExcess > 0 ? adjustedExcess / originalExcess : 1;
  return {
    roof: adjustedRoof,
    result: {
      applied: true as const,
      heightScale: scale,
      nearMaximumHours: result.nearMaximumHours,
      farMaximumHours: result.farMaximumHours,
      timeStepMinutes: result.stepMinutes,
      sampleGridMeters: result.gridMeters,
    },
  };
}

function pointInTriangle(point: PlanPoint, a: PlanPoint, b: PlanPoint, c: PlanPoint) {
  const cross = (p: PlanPoint, q: PlanPoint, r: PlanPoint) =>
    (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const first = cross(a, b, point);
  const second = cross(b, c, point);
  const third = cross(c, a, point);
  return (first >= -1e-8 && second >= -1e-8 && third >= -1e-8) ||
    (first <= 1e-8 && second <= 1e-8 && third <= 1e-8);
}

/** 凹形敷地でも敷地外を横切る面を作らないための耳切り三角形分割。 */
export function triangulatePolygon(points: PlanPoint[]): number[][] {
  if (points.length < 3) return [];
  const orientation = Math.sign(signedArea(points)) || 1;
  const remaining = points.map((_, index) => index);
  const triangles: number[][] = [];
  let guard = points.length * points.length;
  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let position = 0; position < remaining.length; position += 1) {
      const previous = remaining[(position - 1 + remaining.length) % remaining.length];
      const current = remaining[position];
      const next = remaining[(position + 1) % remaining.length];
      const a = points[previous]; const b = points[current]; const c = points[next];
      const turn = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      if (turn * orientation <= 1e-9) continue;
      if (remaining.some((index) => index !== previous && index !== current && index !== next &&
        pointInTriangle(points[index], a, b, c))) continue;
      triangles.push([previous, current, next]);
      remaining.splice(position, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) triangles.push([...remaining]);
  return triangles;
}

function isSafelyInside(candidate: PlanPoint[], site: PlanPoint[], setbackMeters: number) {
  return candidate.every((start, index) => {
    const end = candidate[(index + 1) % candidate.length];
    const midpoint = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
    return pointInPolygon(start, site) && pointInPolygon(midpoint, site) &&
      site.every((siteStart, siteIndex) => segmentDistance(
        start, end, siteStart, site[(siteIndex + 1) % site.length],
      ) >= setbackMeters - 1e-6);
  });
}

function safestInteriorPoint(points: PlanPoint[]) {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  let best: PlanPoint | null = null;
  let clearance = -1;
  let search = { minX, maxX, minZ, maxZ };
  for (let pass = 0; pass < 4; pass += 1) {
    for (let xi = 0; xi <= 36; xi += 1) for (let zi = 0; zi <= 36; zi += 1) {
      const point = {
        x: search.minX + (search.maxX - search.minX) * xi / 36,
        z: search.minZ + (search.maxZ - search.minZ) * zi / 36,
      };
      if (!pointInPolygon(point, points)) continue;
      const distance = minimumDistanceToBoundary(point, points);
      if (distance > clearance) { best = point; clearance = distance; }
    }
    if (!best) break;
    const halfX = (search.maxX - search.minX) / 12;
    const halfZ = (search.maxZ - search.minZ) / 12;
    search = { minX: best.x - halfX, maxX: best.x + halfX, minZ: best.z - halfZ, maxZ: best.z + halfZ };
  }
  return best ? { point: best, clearance } : null;
}

export function floorPlatePolygonAtHeight(envelope: MassingEnvelope, heightMeters: number): PlanPoint[] {
  if (heightMeters <= 0) return envelope.footprint.map((point) => ({ ...point }));
  const output: EnvelopePoint[] = [];
  envelope.roof.forEach((current, index) => {
    const next = envelope.roof[(index + 1) % envelope.roof.length];
    const currentInside = current.height + 1e-8 >= heightMeters;
    const nextInside = next.height + 1e-8 >= heightMeters;
    if (currentInside) output.push(current);
    if (currentInside !== nextInside) {
      const ratio = (heightMeters - current.height) / (next.height - current.height);
      output.push({
        x: current.x + (next.x - current.x) * ratio,
        z: current.z + (next.z - current.z) * ratio,
        height: heightMeters,
      });
    }
  });
  return output.map(({ x, z }) => ({ x, z }));
}

/**
 * 指定高さまで屋根面が確保できる範囲を、元の屋根三角形ごとに返す。
 * 各三角形は屋根面の高さで直接切断するため、凹形敷地でも3D外形を横切らない。
 */
export function floorPlateTrianglesAtHeight(envelope: MassingEnvelope, heightMeters: number): PlanPoint[][] {
  if (heightMeters <= 0) {
    return triangulatePolygon(envelope.footprint)
      .map((triangle) => triangle.map((index) => ({ ...envelope.footprint[index] })));
  }
  return triangulatePolygon(envelope.footprint).flatMap((triangle) => {
    const clipped: EnvelopePoint[] = [];
    const points = triangle.map((index) => envelope.roof[index]);
    points.forEach((current, index) => {
      const next = points[(index + 1) % points.length];
      const currentInside = current.height + 1e-8 >= heightMeters;
      const nextInside = next.height + 1e-8 >= heightMeters;
      if (currentInside) clipped.push(current);
      if (currentInside !== nextInside) {
        const ratio = (heightMeters - current.height) / (next.height - current.height);
        clipped.push({
          x: current.x + (next.x - current.x) * ratio,
          z: current.z + (next.z - current.z) * ratio,
          height: heightMeters,
        });
      }
    });
    return clipped.length >= 3
      ? [clipped.map(({ x, z }) => ({ x, z }))]
      : [];
  });
}

export function floorPlateAreaAtHeight(envelope: MassingEnvelope, heightMeters: number) {
  return floorPlateTrianglesAtHeight(envelope, heightMeters)
    .reduce((sum, triangle) => sum + polygonArea(triangle), 0);
}

export function grossFloorAreaForLevels(envelope: MassingEnvelope, floorLevelsMeters: number[]) {
  return floorLevelsMeters
    .filter((level) => level >= 0 && level < envelope.maximumHeightMeters - 1e-8)
    .reduce((sum, level) => sum + floorPlateAreaAtHeight(envelope, level), 0);
}

function lineIntersection(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): PlanPoint | null {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const cdx = d.x - c.x;
  const cdz = d.z - c.z;
  const denominator = abx * cdz - abz * cdx;
  if (Math.abs(denominator) < 1e-8) return null;
  const t = ((c.x - a.x) * cdz - (c.z - a.z) * cdx) / denominator;
  return { x: a.x + t * abx, z: a.z + t * abz };
}

export function insetConvexPolygon(points: PlanPoint[], setbackMeters: number): PlanPoint[] {
  if (points.length < 3 || setbackMeters <= 0) return points.map((point) => ({ ...point }));
  const orientation = Math.sign(signedArea(points)) || 1;
  const offsetLines = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next.x - point.x;
    const dz = next.z - point.z;
    const length = Math.hypot(dx, dz);
    const normal = orientation > 0
      ? { x: -dz / length, z: dx / length }
      : { x: dz / length, z: -dx / length };
    return {
      start: { x: point.x + normal.x * setbackMeters, z: point.z + normal.z * setbackMeters },
      end: { x: next.x + normal.x * setbackMeters, z: next.z + normal.z * setbackMeters },
    };
  });
  const candidate = offsetLines.map((line, index) => {
    const previous = offsetLines[(index - 1 + offsetLines.length) % offsetLines.length];
    const intersection = lineIntersection(previous.start, previous.end, line.start, line.end);
    return intersection && Math.hypot(intersection.x - points[index].x, intersection.z - points[index].z) <= setbackMeters * 8
      ? intersection
      : line.start;
  });
  if (isSafelyInside(candidate, points, setbackMeters)) return candidate;

  // 凹形状や短辺でオフセット交点が外へ飛ぶ場合も、境界を越えない内接円を安全側の代替とする。
  const interior = safestInteriorPoint(points);
  if (!interior || interior.clearance <= setbackMeters + 1e-6) return [];
  const radius = (interior.clearance - setbackMeters) * 0.98;
  return Array.from({ length: 16 }, (_, index) => ({
    x: interior.point.x + radius * Math.cos(index * Math.PI * 2 / 16),
    z: interior.point.z + radius * Math.sin(index * Math.PI * 2 / 16),
  }));
}

function limitFootprintArea(footprint: PlanPoint[], site: PlanPoint[], setbackMeters: number, maximumArea: number | null | undefined) {
  const currentArea = polygonArea(footprint);
  if (!maximumArea || currentArea <= maximumArea + 1e-8) return footprint;
  const interior = safestInteriorPoint(footprint);
  if (!interior) return footprint;
  const targetScale = Math.sqrt(maximumArea / currentArea);
  const candidate = footprint.map((point) => ({
    x: interior.point.x + (point.x - interior.point.x) * targetScale,
    z: interior.point.z + (point.z - interior.point.z) * targetScale,
  }));
  // 複雑な凹形で相似縮小が敷地外を横切る場合、過度な縮小はせず画面の超過警告へ委ねる。
  if (isSafelyInside(candidate, site, setbackMeters)) return candidate;
  return footprint;
}

function inwardRoadNormal(site: PlanPoint[], edgeIndex: number) {
  const start = site[edgeIndex];
  const end = site[(edgeIndex + 1) % site.length];
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const orientation = Math.sign(signedArea(site)) || 1;
  return orientation > 0
    ? { x: -dz / length, z: dx / length }
    : { x: dz / length, z: -dx / length };
}

export function buildMassingEnvelope(
  plan: SitePlan,
  imageSize: ImageSize,
  options: { setbackMeters: number; maximumHeightMeters: number; roadSlope: number; adjacentSlant?: AdjacentSlant | null; shadow?: ShadowConstraint | null; maximumFootprintAreaSquareMeters?: number | null },
): MassingEnvelope | null {
  const pixelsPerMeter = estimatePixelsPerMeter(plan, imageSize);
  if (!pixelsPerMeter || plan.vertices.length < 3) return null;
  const raw = plan.vertices.map((vertex) => {
    const point = vertexToImagePoint(vertex, imageSize);
    // 画像座標の下方向をそのまま平面の+Zとし、2Dと3Dで鏡像を作らない。
    return { x: point.x / pixelsPerMeter, z: point.y / pixelsPerMeter };
  });
  const center = raw.reduce((sum, point) => ({ x: sum.x + point.x / raw.length, z: sum.z + point.z / raw.length }), { x: 0, z: 0 });
  const site = raw.map((point) => ({ x: point.x - center.x, z: point.z - center.z }));
  const insetFootprint = insetConvexPolygon(site, options.setbackMeters);
  const footprint = limitFootprintArea(insetFootprint, site, options.setbackMeters, options.maximumFootprintAreaSquareMeters);
  if (footprint.length < 3 || polygonArea(footprint) <= 0) return null;

  const roadConstraints = plan.roads.flatMap((road, roadIndex) => {
    if (road.widthMeters === null) return [];
    return resolveRoadEdgeIndices(road, plan.edges, plan.vertices)
      .flatMap((edgeIndex) => {
        const widthMeters = roadWidthForEdge(road, plan.edges[edgeIndex]);
        return widthMeters === null ? [] : [{ edgeIndex, widthMeters, roadIndex }];
      });
  });
  const roadEdgeIndices = new Set(roadConstraints.map((constraint) => constraint.edgeIndex));
  const primaryRoadConstraint = [...roadConstraints].sort((a, b) => a.widthMeters - b.widthMeters)[0] ?? null;
  const roadEdgeIndex = primaryRoadConstraint?.edgeIndex ?? null;
  const roadWidthMeters = primaryRoadConstraint?.widthMeters ?? null;
  const roadEdge: [PlanPoint, PlanPoint] | null = roadEdgeIndex === null
    ? null
    : [site[roadEdgeIndex], site[(roadEdgeIndex + 1) % site.length]];

  const roadSurfaceSegments = roadConstraints.map((constraint) => {
    const start = site[constraint.edgeIndex];
    const end = site[(constraint.edgeIndex + 1) % site.length];
    const inward = inwardRoadNormal(site, constraint.edgeIndex);
    const outward = { x: -inward.x, z: -inward.z };
    const startOuter = { x: start.x + outward.x * constraint.widthMeters, z: start.z + outward.z * constraint.widthMeters };
    const endOuter = { x: end.x + outward.x * constraint.widthMeters, z: end.z + outward.z * constraint.widthMeters };
    return { ...constraint, start, end, startOuter, endOuter, points: [start, end, endOuter, startOuter] };
  });
  const roadSurfaces = roadSurfaceSegments.map((segment) => segment.points);
  roadSurfaceSegments.forEach((first, firstIndex) => {
    roadSurfaceSegments.slice(firstIndex + 1).forEach((second) => {
      if (Math.hypot(first.end.x - second.start.x, first.end.z - second.start.z) < 1e-6) {
        roadSurfaces.push([first.end, first.endOuter, second.startOuter]);
      }
    });
  });

  const roof = footprint.map((point) => {
    let height = options.maximumHeightMeters;
    roadConstraints.forEach((constraint) => {
      const distanceFromRoadBoundary = distanceToSegment(
        point, site[constraint.edgeIndex], site[(constraint.edgeIndex + 1) % site.length],
      );
      height = Math.min(height, options.roadSlope * (constraint.widthMeters + distanceFromRoadBoundary));
    });
    if (options.adjacentSlant) {
      site.forEach((_, edgeIndex) => {
        if (roadEdgeIndices.has(edgeIndex)) return;
        const distance = distanceToSegment(point, site[edgeIndex], site[(edgeIndex + 1) % site.length]);
        height = Math.min(height, options.adjacentSlant!.startHeightMeters + options.adjacentSlant!.slope * distance);
      });
    }
    return { ...point, height };
  });

  const shadowAdjusted = options.shadow ? applyShadowConstraint(site, footprint, roof, options.shadow) : null;
  const finalRoof = shadowAdjusted?.roof ?? roof;
  const heights = finalRoof.map((point) => point.height);
  return {
    site,
    footprint,
    roof: finalRoof,
    roadSurfaces,
    roadEdge,
    setbackMeters: options.setbackMeters,
    roadWidthMeters,
    roadSlope: roadWidthMeters === null ? null : options.roadSlope,
    maximumHeightMeters: Math.max(...heights),
    minimumHeightMeters: Math.min(...heights),
    footprintAreaSquareMeters: polygonArea(footprint),
    shadowAnalysis: shadowAdjusted?.result ?? null,
  };
}
