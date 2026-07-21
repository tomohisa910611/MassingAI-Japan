"use client";

import { MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  buildMassingEnvelope,
  floorPlateAreaAtHeight,
  floorPlateTrianglesAtHeight,
  MassingEnvelope,
  PlanPoint,
  triangulatePolygon,
} from "@/lib/massing-envelope";
import { RegulationAnalysis, calculateRegulationLimits } from "@/lib/regulations";
import { ImageSize, SitePlan } from "@/lib/site-plan";
import { DEFAULT_MASSING_VIEW, MassingViewState } from "@/lib/projects";
import { useLanguage } from "@/components/language-provider";
import { BUILDING_USE_ENGLISH } from "@/lib/building-uses";

type Props = {
  plan: SitePlan;
  imageSize: ImageSize;
  regulations: RegulationAnalysis;
  initialViewState?: MassingViewState;
  onViewStateChange?: (state: MassingViewState) => void;
  projectActions?: ReactNode;
};
type Point3 = { x: number; y: number; z: number };
type Projected = { x: number; y: number; depth: number };

const DIRECTIONS = [
  ["北", 0], ["北東", 45], ["東", 90], ["南東", 135],
  ["南", 180], ["南西", 225], ["西", 270], ["北西", 315],
] as const;

function bandColor(index: number, count: number, alpha: number) {
  const ratio = count <= 1 ? 0 : index / (count - 1);
  return `hsla(${210 * (1 - ratio)}, 82%, 52%, ${alpha})`;
}

function normalize(point: Point3): Point3 {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}
function cross(a: Point3, b: Point3): Point3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: Point3, b: Point3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function interpolate(a: PlanPoint, b: PlanPoint, ratio: number): PlanPoint {
  return { x: a.x + (b.x - a.x) * ratio, z: a.z + (b.z - a.z) * ratio };
}
function drawPolygon(context: CanvasRenderingContext2D, points: Projected[], fill: string, stroke: string, width = 1) {
  if (points.length < 3 || points.some((point) => point.depth <= 0)) return;
  context.beginPath(); context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath(); context.fillStyle = fill; context.fill();
  context.strokeStyle = stroke; context.lineWidth = width; context.stroke();
}
function drawLine(context: CanvasRenderingContext2D, first: Projected, second: Projected, color: string, width = 1) {
  if (first.depth <= 0 || second.depth <= 0) return;
  context.beginPath(); context.moveTo(first.x, first.y); context.lineTo(second.x, second.y);
  context.strokeStyle = color; context.lineWidth = width; context.stroke();
}

function contourSegment(envelope: MassingEnvelope, edgeIndex: number, level: number): [Point3, Point3] | null {
  const start = envelope.roof[edgeIndex];
  const end = envelope.roof[(edgeIndex + 1) % envelope.roof.length];
  if (start.height < level && end.height < level) return null;
  const pointAtLevel = (low: typeof start, high: typeof end) => {
    const ratio = (level - low.height) / (high.height - low.height);
    return { x: low.x + (high.x - low.x) * ratio, y: level, z: low.z + (high.z - low.z) * ratio };
  };
  const first = start.height >= level ? { x: start.x, y: level, z: start.z } : pointAtLevel(start, end);
  const second = end.height >= level ? { x: end.x, y: level, z: end.z } : pointAtLevel(end, start);
  return [first, second];
}

function sideBandFace(envelope: MassingEnvelope, edgeIndex: number, low: number, high: number): Point3[] {
  const start = envelope.roof[edgeIndex];
  const end = envelope.roof[(edgeIndex + 1) % envelope.roof.length];
  type SidePoint = { t: number; y: number };
  let polygon: SidePoint[] = [{ t: 0, y: low }, { t: 1, y: low }, { t: 1, y: high }, { t: 0, y: high }];
  const inside = (point: SidePoint) => point.y <= start.height + (end.height - start.height) * point.t + 1e-8;
  const clipped: SidePoint[] = [];
  polygon.forEach((current, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const currentInside = inside(current);
    const nextInside = inside(next);
    if (currentInside) clipped.push(current);
    if (currentInside !== nextInside) {
      const dy = next.y - current.y;
      const dt = next.t - current.t;
      const denominator = dy - (end.height - start.height) * dt;
      const ratio = Math.abs(denominator) < 1e-8
        ? 0
        : (start.height + (end.height - start.height) * current.t - current.y) / denominator;
      clipped.push({ t: current.t + dt * ratio, y: current.y + dy * ratio });
    }
  });
  polygon = clipped;
  return polygon.map((point) => ({
    x: start.x + (end.x - start.x) * point.t,
    y: point.y,
    z: start.z + (end.z - start.z) * point.t,
  }));
}

function clipByHeight(points: Point3[], height: number, keepAbove: boolean): Point3[] {
  const output: Point3[] = [];
  points.forEach((current, index) => {
    const next = points[(index + 1) % points.length];
    const currentInside = keepAbove ? current.y >= height - 1e-8 : current.y <= height + 1e-8;
    const nextInside = keepAbove ? next.y >= height - 1e-8 : next.y <= height + 1e-8;
    if (currentInside) output.push(current);
    if (currentInside !== nextInside) {
      const ratio = (height - current.y) / (next.y - current.y);
      output.push({ x: current.x + (next.x - current.x) * ratio, y: height, z: current.z + (next.z - current.z) * ratio });
    }
  });
  return output;
}

function roofBandFaces(envelope: MassingEnvelope, low: number, high: number): Point3[][] {
  return triangulatePolygon(envelope.footprint)
    .map((triangle) => triangle.map((index) => {
      const point = envelope.roof[index];
      return { x: point.x, y: point.height, z: point.z };
    }))
    .map((roof) => clipByHeight(clipByHeight(roof, low, true), high, false))
    .filter((face) => face.length >= 3);
}

function intersectionsWithGridLine(points: PlanPoint[], axis: "x" | "z", value: number): PlanPoint[] {
  const output: PlanPoint[] = [];
  points.forEach((current, index) => {
    const next = points[(index + 1) % points.length];
    const currentValue = current[axis];
    const nextValue = next[axis];
    if ((value >= Math.min(currentValue, nextValue) - 1e-8) && (value <= Math.max(currentValue, nextValue) + 1e-8) && Math.abs(nextValue - currentValue) > 1e-8) {
      const ratio = (value - currentValue) / (nextValue - currentValue);
      const point = interpolate(current, next, ratio);
      if (!output.some((existing) => Math.hypot(existing.x - point.x, existing.z - point.z) < 1e-6)) output.push(point);
    }
  });
  return output;
}

function cumulativeFloorData(values: string[], maximumHeight: number) {
  const heights: number[] = [];
  for (const value of values) {
    const number = Number(value);
    if (!(number > 0)) break;
    heights.push(number);
  }
  const levels: number[] = [];
  let cumulative = 0;
  heights.forEach((height) => {
    if (cumulative < maximumHeight) levels.push(cumulative);
    cumulative += height;
  });
  const lines = heights.map((height, index) => heights.slice(0, index + 1).reduce((sum, item) => sum + item, 0)).filter((level) => level < maximumHeight);
  return { heights, levels, lines };
}

export function Massing3DViewer({ plan, imageSize, regulations, initialViewState = DEFAULT_MASSING_VIEW, onViewStateChange, projectActions }: Props) {
  const { language, text } = useLanguage();
  const intendedUseCode = regulations.intendedUse.split("｜")[0];
  const intendedUseLabel = language === "en" ? `${intendedUseCode}｜${BUILDING_USE_ENGLISH[intendedUseCode] ?? regulations.intendedUse}` : regulations.intendedUse;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number; mode: "pan" | "orbit" } | null>(null);
  const [orbitEnabled, setOrbitEnabled] = useState(initialViewState.orbitEnabled);
  const [azimuth, setAzimuth] = useState(initialViewState.azimuth);
  const [elevation, setElevation] = useState(initialViewState.elevation);
  const [zoom, setZoom] = useState(initialViewState.zoom);
  const [pan, setPan] = useState(initialViewState.pan);
  const [floorEditorOpen, setFloorEditorOpen] = useState(false);
  const [floorHeights, setFloorHeights] = useState<string[]>(initialViewState.floorHeights.length ? initialViewState.floorHeights : [""]);
  const [rangeEditorOpen, setRangeEditorOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState("1");
  const [rangeEnd, setRangeEnd] = useState("5");
  const [rangeHeight, setRangeHeight] = useState("3.5");
  const [floorError, setFloorError] = useState("");

  const adjacentSlant = useMemo(() => {
    const text = regulations.adjacentSlantRestriction ?? "";
    if (/適用なし|なし/.test(text)) return null;
    const start = text.match(/(?:立上り|高さ)\s*([0-9]+(?:\.[0-9]+)?)\s*m/i);
    const slope = text.match(/(?:勾配|隣)\s*([0-9]+(?:\.[0-9]+)?)/);
    return start && slope ? { startHeightMeters: Number(start[1]), slope: Number(slope[1]) } : null;
  }, [regulations.adjacentSlantRestriction]);
  const shadowConstraint = useMemo(() => {
    if (!regulations.shadowRegulationApplies || plan.trueNorthAngleDegrees === null ||
      regulations.shadowCalculationLatitudeDegrees == null || regulations.shadowMeasurementHeightMeters == null ||
      regulations.shadowTimeLimitNearHours == null || regulations.shadowTimeLimitFarHours == null) return null;
    return {
      latitudeDegrees: regulations.shadowCalculationLatitudeDegrees,
      trueNorthAngleDegrees: plan.trueNorthAngleDegrees,
      measurementHeightMeters: regulations.shadowMeasurementHeightMeters,
      nearLimitHours: regulations.shadowTimeLimitNearHours,
      farLimitHours: regulations.shadowTimeLimitFarHours,
    };
  }, [plan.trueNorthAngleDegrees, regulations]);
  const conservativeRoadWidth = plan.roads
    .map((road) => road.widthMeters)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0] ?? null;
  const limits = calculateRegulationLimits(regulations, plan.siteAreaSquareMeters, conservativeRoadWidth);
  const envelope = useMemo(() => buildMassingEnvelope(plan, imageSize, {
    setbackMeters: Math.max(0.5, regulations.conservativeSetbackMeters),
    maximumHeightMeters: regulations.conservativeMaximumHeightMeters ?? 45,
    roadSlope: regulations.roadSlantSlope ?? 1.5,
    adjacentSlant,
    shadow: shadowConstraint,
    maximumFootprintAreaSquareMeters: limits.permittedBuildingArea,
  }), [adjacentSlant, imageSize, limits.permittedBuildingArea, plan, regulations, shadowConstraint]);
  const floors = useMemo(() => envelope ? cumulativeFloorData(floorHeights, envelope.maximumHeightMeters) : { heights: [], levels: [], lines: [] }, [envelope, floorHeights]);
  const floorScheduleActive = floors.heights.length > 0;
  const floorAreas = useMemo(() => envelope && floorScheduleActive ? floors.heights.map((height, index) => {
    const requiredTopHeight = (floors.levels[index] ?? 0) + height + (index === floors.heights.length - 1 ? 1 : 0);
    return floorPlateAreaAtHeight(envelope, requiredTopHeight);
  }) : [], [envelope, floorScheduleActive, floors.heights, floors.levels]);
  const solidFloors = useMemo(() => envelope && floorScheduleActive ? floors.heights.map((height, index) => {
    const bottom = floors.levels[index] ?? 0;
    const top = bottom + height + (index === floors.heights.length - 1 ? 1 : 0);
    return {
      floorIndex: index,
      bottom,
      top,
      plates: floorPlateTrianglesAtHeight(envelope, top),
    };
  }).filter((floor) => floor.plates.length > 0) : [], [envelope, floorScheduleActive, floors.heights, floors.levels]);
  const grossFloorArea = envelope && floorScheduleActive ? floorAreas.reduce((sum, area) => sum + area, 0) : null;
  const exceedsBuildingArea = Boolean(envelope && limits.permittedBuildingArea !== null && envelope.footprintAreaSquareMeters > limits.permittedBuildingArea + .01);
  const exceedsFar = grossFloorArea !== null && limits.permittedGrossFloorArea !== null && grossFloorArea > limits.permittedGrossFloorArea + .01;

  useEffect(() => {
    onViewStateChange?.({ orbitEnabled, azimuth, elevation, zoom, pan, floorHeights });
  }, [azimuth, elevation, floorHeights, onViewStateChange, orbitEnabled, pan, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleCanvasWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setZoom((value) => Math.max(.65, Math.min(4, value - event.deltaY * .0015)));
    };
    canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleCanvasWheel);
  }, [envelope]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !envelope) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    function render() {
      if (!canvas || !context || !envelope) return;
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(320, Math.round(bounds.width));
      const height = Math.max(360, Math.round(bounds.height));
      if (canvas.width !== width * pixelRatio || canvas.height !== height * pixelRatio) {
        canvas.width = width * pixelRatio; canvas.height = height * pixelRatio;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const allPlanPoints = [...envelope.site, ...envelope.footprint];
      const horizontalSpan = Math.max(
        Math.max(...allPlanPoints.map((point) => point.x)) - Math.min(...allPlanPoints.map((point) => point.x)),
        Math.max(...allPlanPoints.map((point) => point.z)) - Math.min(...allPlanPoints.map((point) => point.z)),
      );
      const isPlanView = elevation >= 60;
      const overallSpan = isPlanView
        ? Math.max(horizontalSpan * 1.1, 8)
        : Math.max(horizontalSpan, envelope.maximumHeightMeters * .85, 8);
      const radians = azimuth * Math.PI / 180;
      const elevationRadians = Math.max(1, Math.min(89, elevation)) * Math.PI / 180;
      const target = { x: 0, y: isPlanView ? 0 : envelope.maximumHeightMeters * .35, z: 0 };
      const distance = overallSpan * (isPlanView ? 1.35 : 2.65) / zoom;
      const camera = {
        x: Math.sin(radians) * Math.cos(elevationRadians) * distance,
        y: target.y + Math.sin(elevationRadians) * distance,
        z: Math.cos(radians) * Math.cos(elevationRadians) * distance,
      };
      const forward = normalize({ x: -camera.x, y: target.y - camera.y, z: -camera.z });
      const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
      const cameraUp = normalize(cross(right, forward));
      const focal = Math.min(width, height) * 1.28;
      const project = (point: Point3): Projected => {
        const relative = { x: point.x - camera.x, y: point.y - camera.y, z: point.z - camera.z };
        const depth = dot(relative, forward);
        return { x: width / 2 + pan.x + dot(relative, right) * focal / Math.max(depth, .1), y: height * .54 + pan.y - dot(relative, cameraUp) * focal / Math.max(depth, .1), depth };
      };
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--card").trim() || "#fffdf8";
      context.fillRect(0, 0, width, height);

      envelope.roadSurfaces.forEach((road) => {
        drawPolygon(context, road.map((point) => project({ ...point, y: -.06 })), "rgba(121,130,136,.24)", "rgba(83,94,100,.5)");
      });
      drawPolygon(context, envelope.site.map((point) => project({ ...point, y: 0 })), "rgba(23,105,210,.04)", "rgba(23,105,210,.75)", 1.3);
      drawPolygon(context, envelope.footprint.map((point) => project({ ...point, y: .03 })), "rgba(35,167,121,.06)", "rgba(16,127,89,.72)", 1.2);

      const shadowPlaneHeight = regulations.shadowRegulationApplies
        ? regulations.shadowMeasurementHeightMeters
        : null;
      if (!isPlanView && shadowPlaneHeight !== null && shadowPlaneHeight !== undefined) {
        const shadowPlane = envelope.site.map((point) => project({ ...point, y: shadowPlaneHeight }));
        drawPolygon(context, shadowPlane, "rgba(244,177,60,.12)", "rgba(184,116,17,.8)", 1.1);
        const anchor = [...shadowPlane].sort((a, b) => b.x - a.x)[0];
        const near = regulations.shadowTimeLimitNearHours;
        const far = regulations.shadowTimeLimitFarHours;
        const timeText = near && far ? ` ${near.toFixed(0)}–${far.toFixed(0)}${text("時間", "h")}` : "";
        context.fillStyle = "rgba(92,58,12,.94)";
        context.font = "700 10px 'Yu Gothic',sans-serif";
        context.fillText(`${text("日影規制検討面", "Shadow-control plane")} H${shadowPlaneHeight.toFixed(2)}m${timeText}`, Math.min(width - 190, anchor.x + 8), anchor.y - 7);
      }

      const minX = Math.min(...envelope.footprint.map((point) => point.x));
      const maxX = Math.max(...envelope.footprint.map((point) => point.x));
      const minZ = Math.min(...envelope.footprint.map((point) => point.z));
      const maxZ = Math.max(...envelope.footprint.map((point) => point.z));
      context.setLineDash([]);
      for (let value = Math.ceil(minX * 2) / 2; value <= maxX; value += .5) {
        const intersections = intersectionsWithGridLine(envelope.footprint, "x", value);
        if (intersections.length >= 2) drawLine(context, project({ ...intersections[0], y: .06 }), project({ ...intersections[1], y: .06 }), "rgba(67,82,91,.18)", .55);
      }
      for (let value = Math.ceil(minZ * 2) / 2; value <= maxZ; value += .5) {
        const intersections = intersectionsWithGridLine(envelope.footprint, "z", value);
        if (intersections.length >= 2) drawLine(context, project({ ...intersections[0], y: .06 }), project({ ...intersections[1], y: .06 }), "rgba(67,82,91,.18)", .55);
      }

      const rawStops = floorScheduleActive
        ? [0, ...floors.lines, envelope.maximumHeightMeters]
        : [0, ...Array.from({ length: Math.floor(envelope.maximumHeightMeters / 5) }, (_, index) => (index + 1) * 5), envelope.maximumHeightMeters];
      const stops = [...new Set(rawStops.map((value) => Math.min(value, envelope.maximumHeightMeters)))].sort((a, b) => a - b);
      const bandCount = Math.max(1, stops.length - 1);
      const faces = envelope.footprint.flatMap((_, edgeIndex) => stops.slice(0, -1).flatMap((low, bandIndex) => {
        const points = sideBandFace(envelope, edgeIndex, low, stops[bandIndex + 1]);
        if (points.length < 3) return [];
        return [{ points, bandIndex, depth: points.reduce((sum, point) => sum + project(point).depth / points.length, 0) }];
      })).sort((a, b) => b.depth - a.depth);
      // 階高設定中は、規制包絡の半透明ポリゴンを隠し、
      // 設定した階高を満たす不透明な立体だけを表示する。
      if (!isPlanView && !floorScheduleActive) faces.forEach((face) => drawPolygon(context, face.points.map(project), bandColor(face.bandIndex, bandCount, .48), "rgba(24,31,38,.2)", .5));
      if (!isPlanView && !floorScheduleActive) stops.slice(0, -1).forEach((low, bandIndex) => {
        roofBandFaces(envelope, low, stops[bandIndex + 1]).forEach((points) =>
          drawPolygon(context, points.map(project), bandColor(bandIndex, bandCount, .58), "rgba(15,20,26,.8)", 1.1));
      });

      // 階高を満たす範囲だけを不透明な立体として重ねる。
      // 指定高さで屋根三角形を切断した領域を押し出すため、透明な法規制外形からはみ出さない。
      if (!isPlanView && solidFloors.length) {
        const solidSides = solidFloors.flatMap((floor) => floor.plates.flatMap((plate) =>
          plate.map((start, edgeIndex) => {
            const end = plate[(edgeIndex + 1) % plate.length];
            const points: Point3[] = [
              { ...start, y: floor.bottom }, { ...end, y: floor.bottom },
              { ...end, y: floor.top }, { ...start, y: floor.top },
            ];
            return {
              points,
              floorIndex: floor.floorIndex,
              depth: points.reduce((sum, point) => sum + project(point).depth / points.length, 0),
            };
          }))).sort((a, b) => b.depth - a.depth);
        solidSides.forEach((face) => drawPolygon(
          context,
          face.points.map(project),
          bandColor(face.floorIndex, floors.heights.length, 1),
          "rgba(17,23,27,.78)",
          .7,
        ));
        solidFloors.forEach((floor) => floor.plates.forEach((plate) => {
          const color = bandColor(floor.floorIndex, floors.heights.length, 1);
          drawPolygon(context, plate.map((point) => project({ ...point, y: floor.top })), color, "rgba(17,23,27,.82)", .8);

          const minPlateX = Math.min(...plate.map((point) => point.x));
          const maxPlateX = Math.max(...plate.map((point) => point.x));
          const minPlateZ = Math.min(...plate.map((point) => point.z));
          const maxPlateZ = Math.max(...plate.map((point) => point.z));
          for (let value = Math.ceil(minPlateX * 2) / 2; value <= maxPlateX + 1e-8; value += .5) {
            const intersections = intersectionsWithGridLine(plate, "x", value);
            if (intersections.length >= 2) drawLine(context, project({ ...intersections[0], y: floor.top + .01 }), project({ ...intersections[1], y: floor.top + .01 }), "rgba(12,20,24,.46)", .55);
          }
          for (let value = Math.ceil(minPlateZ * 2) / 2; value <= maxPlateZ + 1e-8; value += .5) {
            const intersections = intersectionsWithGridLine(plate, "z", value);
            if (intersections.length >= 2) drawLine(context, project({ ...intersections[0], y: floor.top + .01 }), project({ ...intersections[1], y: floor.top + .01 }), "rgba(12,20,24,.46)", .55);
          }
          for (let level = Math.ceil(floor.bottom * 2) / 2; level <= floor.top + 1e-8; level += .5) {
            plate.forEach((start, edgeIndex) => {
              const end = plate[(edgeIndex + 1) % plate.length];
              drawLine(context, project({ ...start, y: level }), project({ ...end, y: level }), "rgba(12,20,24,.42)", .5);
            });
          }
          plate.forEach((start, edgeIndex) => {
            const end = plate[(edgeIndex + 1) % plate.length];
            const edgeLength = Math.hypot(end.x - start.x, end.z - start.z);
            for (let distance = 0; distance <= edgeLength + 1e-8; distance += .5) {
              const point = interpolate(start, end, Math.min(1, distance / Math.max(edgeLength, 1e-8)));
              drawLine(context, project({ ...point, y: floor.bottom }), project({ ...point, y: floor.top }), "rgba(12,20,24,.42)", .5);
            }
          });
        }));
        solidFloors.forEach((floor, index) => {
          const topPoints = floor.plates.flatMap((plate) => plate.map((point) => project({ ...point, y: floor.top })));
          if (!topPoints.length) return;
          const anchor = [...topPoints].sort((a, b) => b.x - a.x)[0];
          const textX = Math.min(width - 132, anchor.x + 34);
          const label = index === solidFloors.length - 1
            ? `${text("屋根上端", "Roof top")}｜${floor.top.toFixed(2)}m`
            : `${floor.floorIndex + 2}${text("階床", "F slab")}｜${floor.top.toFixed(2)}m`;
          drawLine(context, anchor, { x: textX - 5, y: anchor.y, depth: anchor.depth }, "rgba(0,0,0,.88)", 1);
          context.fillStyle = "rgba(20,26,29,.94)";
          context.font = "700 11px 'Yu Gothic',sans-serif";
          context.fillText(label, textX, anchor.y + 4);
        });
      }

      if (!isPlanView && !floorScheduleActive) {
        for (let level = .5; level < envelope.maximumHeightMeters; level += .5) {
          const isMajor = floorScheduleActive ? floors.lines.some((item) => Math.abs(item - level) < .05) : Math.abs(level / 5 - Math.round(level / 5)) < .05;
          envelope.roof.forEach((_, edgeIndex) => {
            const segment = contourSegment(envelope, edgeIndex, level);
            if (segment) drawLine(context, project(segment[0]), project(segment[1]), isMajor ? "rgba(0,0,0,.88)" : "rgba(40,48,54,.19)", isMajor ? 1.55 : .45);
          });
        }
      }
      if (!isPlanView && !floorScheduleActive) envelope.footprint.forEach((start, edgeIndex) => {
        const end = envelope.footprint[(edgeIndex + 1) % envelope.footprint.length];
        const edgeLength = Math.hypot(end.x - start.x, end.z - start.z);
        const count = Math.floor(edgeLength / .5);
        for (let step = 0; step <= count; step += 1) {
          const ratio = Math.min(1, step * .5 / edgeLength);
          const point = interpolate(start, end, ratio);
          const roofStart = envelope.roof[edgeIndex]; const roofEnd = envelope.roof[(edgeIndex + 1) % envelope.roof.length];
          const topHeight = roofStart.height + (roofEnd.height - roofStart.height) * ratio;
          drawLine(context, project({ ...point, y: 0 }), project({ ...point, y: topHeight }), "rgba(40,48,54,.16)", .45);
        }
      });

      const majorLines = floorScheduleActive
        ? []
        : stops.slice(1, -1).map((level) => ({ level, label: `${level.toFixed(0)}m` }));
      majorLines.forEach(({ level, label }) => {
        if (isPlanView) return;
        const segments = envelope.roof.map((_, edgeIndex) => contourSegment(envelope, edgeIndex, level)).filter((item): item is [Point3, Point3] => item !== null);
        if (!segments.length) return;
        segments.forEach((segment) => drawLine(context, project(segment[0]), project(segment[1]), "rgba(0,0,0,.92)", 1.6));
        const projected = segments.flatMap((segment) => segment.map(project)).sort((a, b) => b.x - a.x);
        const anchor = projected[0]; const textX = Math.min(width - 118, anchor.x + 34);
        drawLine(context, anchor, { x: textX - 5, y: anchor.y, depth: anchor.depth }, "rgba(0,0,0,.88)", 1);
        context.fillStyle = "rgba(20,26,29,.92)"; context.font = "700 11px 'Yu Gothic',sans-serif"; context.fillText(label, textX, anchor.y + 4);
        const roadInward = (() => {
          if (!envelope.roadEdge) return null;
          const [roadStart, roadEnd] = envelope.roadEdge;
          const dx = roadEnd.x - roadStart.x;
          const dz = roadEnd.z - roadStart.z;
          const roadLength = Math.hypot(dx, dz) || 1;
          const left = { x: -dz / roadLength, z: dx / roadLength };
          const siteCenter = envelope.site.reduce(
            (sum, point) => ({ x: sum.x + point.x / envelope.site.length, z: sum.z + point.z / envelope.site.length }),
            { x: 0, z: 0 },
          );
          return left.x * (siteCenter.x - roadStart.x) + left.z * (siteCenter.z - roadStart.z) >= 0
            ? left
            : { x: -left.x, z: -left.z };
        })();
        const dimensionCandidates = envelope.roof.flatMap((start, edgeIndex) => {
          const end = envelope.roof[(edgeIndex + 1) % envelope.roof.length];
          if (Math.abs(end.height - start.height) < 1e-8 || level <= Math.min(start.height, end.height) + .05 || level >= Math.max(start.height, end.height) - .05) return [];
          const ratio = (level - start.height) / (end.height - start.height);
          const crossing = { x: start.x + (end.x - start.x) * ratio, y: level, z: start.z + (end.z - start.z) * ratio };
          const nearerStart = ratio <= .5;
          const roofEndpoint = nearerStart ? start : end;
          const reference = { x: roofEndpoint.x, y: level, z: roofEndpoint.z };
          const endpointName = roofEndpoint.height <= (nearerStart ? end.height : start.height)
            ? text("道路側端部線", "road-side edge")
            : text("道路反対側端部線", "rear edge");
          const planDistance = roadInward
            ? Math.abs((crossing.x - reference.x) * roadInward.x + (crossing.z - reference.z) * roadInward.z)
            : Math.hypot(crossing.x - reference.x, crossing.z - reference.z);
          const first = project(reference);
          const second = project(crossing);
          return [{ first, second, planDistance, endpointName, midpointX: (first.x + second.x) / 2 }];
        });

        // 同じ等高線の左右に同寸法が出るため、画面左側の1か所だけを代表表示する。
        const dimension = dimensionCandidates.sort((a, b) => a.midpointX - b.midpointX)[0];
        if (!dimension) return;
        const { first, second, planDistance, endpointName } = dimension;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const lineLength = Math.hypot(dx, dy) || 1;
        let normal = { x: -dy / lineLength, y: dx / lineLength };
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        if (normal.x * (midpoint.x - width / 2) + normal.y * (midpoint.y - height / 2) < 0) {
          normal = { x: -normal.x, y: -normal.y };
        }
        const offset = 14;
        const dimensionFirst = { x: first.x + normal.x * offset, y: first.y + normal.y * offset, depth: first.depth };
        const dimensionSecond = { x: second.x + normal.x * offset, y: second.y + normal.y * offset, depth: second.depth };
        drawLine(context, first, dimensionFirst, "rgba(28,34,38,.66)", .9);
        drawLine(context, second, dimensionSecond, "rgba(28,34,38,.66)", .9);
        drawLine(context, dimensionFirst, dimensionSecond, "rgba(28,34,38,.94)", 1.25);
        const tick = { x: normal.x * 5, y: normal.y * 5 };
        drawLine(context, { x: dimensionFirst.x - tick.x, y: dimensionFirst.y - tick.y, depth: first.depth }, { x: dimensionFirst.x + tick.x, y: dimensionFirst.y + tick.y, depth: first.depth }, "rgba(28,34,38,.94)", 1.25);
        drawLine(context, { x: dimensionSecond.x - tick.x, y: dimensionSecond.y - tick.y, depth: second.depth }, { x: dimensionSecond.x + tick.x, y: dimensionSecond.y + tick.y, depth: second.depth }, "rgba(28,34,38,.94)", 1.25);
        const dimensionMidpoint = { x: (dimensionFirst.x + dimensionSecond.x) / 2, y: (dimensionFirst.y + dimensionSecond.y) / 2 };
        const leaderEnd = { x: dimensionMidpoint.x + normal.x * 30, y: dimensionMidpoint.y + normal.y * 30, depth: first.depth };
        drawLine(context, { ...dimensionMidpoint, depth: first.depth }, leaderEnd, "rgba(28,34,38,.78)", 1);
        const targetName = floorScheduleActive ? label.replace("｜", " ") : `${label}${text("ライン", " line")}`;
        const dimensionText = `${endpointName} → ${targetName}｜${text("水平奥行", "horizontal depth")} ${planDistance.toFixed(2)}m`;
        context.font = "700 10px 'Yu Gothic',sans-serif";
        const textWidth = context.measureText(dimensionText).width;
        const labelToRight = leaderEnd.x >= width / 2;
        const desiredX = labelToRight ? leaderEnd.x + 5 : leaderEnd.x - textWidth - 5;
        const dimensionTextX = Math.max(6, Math.min(width - textWidth - 6, desiredX));
        const dimensionTextY = Math.max(14, Math.min(height - 8, leaderEnd.y + 4));
        context.fillStyle = "rgba(255,253,248,.94)";
        context.fillRect(dimensionTextX - 3, dimensionTextY - 11, textWidth + 6, 15);
        context.fillStyle = "rgba(20,26,29,.96)";
        context.fillText(dimensionText, dimensionTextX, dimensionTextY);
      });

      const lowest = Math.min(...envelope.roof.map((point) => point.height));
      const lowestPoints = envelope.roof.filter((point) => Math.abs(point.height - lowest) < .08);
      if (!isPlanView && lowestPoints.length) {
        const center = lowestPoints.reduce((sum, point) => ({ x: sum.x + point.x / lowestPoints.length, z: sum.z + point.z / lowestPoints.length }), { x: 0, z: 0 });
        const anchor = project({ ...center, y: lowest });
        drawLine(context, anchor, { x: anchor.x - 42, y: anchor.y - 20, depth: anchor.depth }, "rgba(0,0,0,.9)", 1.1);
        context.fillStyle = "rgba(20,26,29,.95)"; context.font = "700 11px 'Yu Gothic',sans-serif";
        context.fillText(`${text("道路斜線開始", "Road plane starts")} ${lowest.toFixed(2)}m`, anchor.x - 145, anchor.y - 23);
      }
      envelope.roof.forEach((point, index) => {
        if (isPlanView) return;
        const anchor = project({ x: point.x, y: point.height, z: point.z });
        const direction = index % 2 === 0 ? 1 : -1;
        drawLine(context, anchor, { x: anchor.x + direction * 20, y: anchor.y - 14, depth: anchor.depth }, "rgba(0,0,0,.76)", .8);
        context.fillStyle = "rgba(20,26,29,.9)"; context.font = "700 10px Arial";
        context.fillText(`H${point.height.toFixed(2)}m`, anchor.x + direction * 23 - (direction < 0 ? 58 : 0), anchor.y - 15);
      });

      if (elevation >= 60) {
        const planCenter = project({ x: 0, y: .12, z: 0 });
        const setbackLabelCount = Math.min(envelope.site.length, 8);
        const setbackLabelIndices = new Set(Array.from({ length: setbackLabelCount }, (_, index) =>
          Math.floor(index * envelope.site.length / setbackLabelCount)));
        envelope.site.forEach((start, index) => {
          const end = envelope.site[(index + 1) % envelope.site.length];
          const midpoint = interpolate(start, end, .5);
          const label = project({ ...midpoint, y: .12 });
          const projectedStart = project({ ...start, y: .12 });
          const projectedEnd = project({ ...end, y: .12 });
          const radialLength = Math.hypot(label.x - planCenter.x, label.y - planCenter.y) || 1;
          const outward = { x: (label.x - planCenter.x) / radialLength, y: (label.y - planCenter.y) / radialLength };
          let textAngle = Math.atan2(projectedEnd.y - projectedStart.y, projectedEnd.x - projectedStart.x);
          if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
          const edgeLength = plan.edges[index]?.lengthMeters ?? Math.hypot(end.x - start.x, end.z - start.z);
          context.save();
          context.translate(label.x + outward.x * 18, label.y + outward.y * 18);
          context.rotate(textAngle);
          context.fillStyle = "rgba(20,26,29,.9)"; context.font = "700 10px 'Yu Gothic',sans-serif"; context.textAlign = "center";
          context.fillText(`S${index + 1}｜${edgeLength.toFixed(3)}m`, 0, -3);
          context.restore();
          if (setbackLabelIndices.has(index)) {
            const siteMidpoint = interpolate(start, end, .5);
            const insetTarget = envelope.footprint.reduce((nearest, point) =>
              Math.hypot(point.x - siteMidpoint.x, point.z - siteMidpoint.z) < Math.hypot(nearest.x - siteMidpoint.x, nearest.z - siteMidpoint.z)
                ? point : nearest);
            const insetProjected = project({ ...insetTarget, y: .12 });
            drawLine(context, label, insetProjected, "rgba(20,26,29,.58)", .8);
            context.save();
            context.translate(insetProjected.x - outward.x * 12, insetProjected.y - outward.y * 12);
            context.rotate(textAngle);
            context.fillStyle = "rgba(20,26,29,.78)"; context.font = "700 9px 'Yu Gothic',sans-serif"; context.textAlign = "center";
            context.fillText(`${text("後退", "Setback")} ${envelope.setbackMeters.toFixed(2)}m`, 0, -3);
            context.restore();
          }
        });
        envelope.footprint.forEach((insetStart, index) => {
          const insetEnd = envelope.footprint[(index + 1) % envelope.footprint.length];
          const insetMid = interpolate(insetStart, insetEnd, .5);
          const insetProjected = project({ ...insetMid, y: .12 });
          const projectedStart = project({ ...insetStart, y: .12 });
          const projectedEnd = project({ ...insetEnd, y: .12 });
          let textAngle = Math.atan2(projectedEnd.y - projectedStart.y, projectedEnd.x - projectedStart.x);
          if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
          const footprintLength = Math.hypot(insetEnd.x - insetStart.x, insetEnd.z - insetStart.z);
          context.save();
          context.translate(insetProjected.x, insetProjected.y);
          context.rotate(textAngle);
          context.fillStyle = "rgba(13,111,78,.9)"; context.font = "700 9px 'Yu Gothic',sans-serif"; context.textAlign = "center";
          context.fillText(`VS${index + 1}｜${footprintLength.toFixed(3)}m`, 0, -3);
          context.restore();
        });
      }
    }
    render();
    const resizeObserver = new ResizeObserver(render); resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [azimuth, elevation, envelope, floorScheduleActive, floors.heights.length, floors.lines, language, pan, plan.edges, regulations, solidFloors, text, zoom]);

  if (!envelope) return <div className="massing-error">{text("3D化に必要な敷地縮尺を確認できません。", "The site scale required for 3D generation could not be verified.")}</div>;
  function chooseView(direction: number, nextElevation: number) { setAzimuth(direction); setElevation(nextElevation); setPan({ x: 0, y: 0 }); }
  function onMouseDown(event: MouseEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1 && !orbitEnabled) return;
    event.preventDefault();
    dragRef.current = { x: event.clientX, y: event.clientY, mode: event.button === 0 ? "pan" : "orbit" };
  }
  function onMouseMove(event: MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x; const dy = event.clientY - dragRef.current.y;
    const mode = dragRef.current.mode; dragRef.current = { x: event.clientX, y: event.clientY, mode };
    if (mode === "pan") setPan((value) => ({ x: value.x + dx, y: value.y + dy }));
    else { setAzimuth((value) => (value + dx * .45 + 360) % 360); setElevation((value) => Math.max(2, Math.min(88, value - dy * .35))); }
  }
  function updateFloor(index: number, value: string) { setFloorHeights((current) => current.map((item, itemIndex) => itemIndex === index ? value : item)); setFloorError(""); }
  function removeFloor(index: number) { setFloorHeights((current) => { const next = current.filter((_, itemIndex) => itemIndex !== index); return next.length ? next : [""]; }); setFloorError(""); }
  function applyRange() {
    const start = Number(rangeStart); const end = Number(rangeEnd); const height = Number(rangeHeight);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || !(height > 0)) { setFloorError(text("開始階・終了階は1以上の整数、階高は0より大きい数値で入力してください。", "Enter whole-number start/end floors of 1 or more, and a positive floor height.")); return; }
    setFloorHeights((current) => {
      const next = Array.from({ length: Math.max(current.length, end) }, (_, index) => current[index] ?? "");
      for (let floor = start; floor <= end; floor += 1) next[floor - 1] = height.toString();
      return next;
    });
    setRangeEditorOpen(false); setFloorError("");
  }

  return (
    <section className="massing-section" aria-labelledby="massing-heading">
      <div className="massing-heading-row">
        <div><span className="eyebrow">Conservative massing envelope</span><h3 id="massing-heading">{text("法規制を反映した3Dボリューム", "Buildable 3D massing envelope")}</h3></div>
        <div className="massing-main-actions">
          <button type="button" className="floor-settings-button" onClick={() => setFloorEditorOpen((value) => !value)}>{text("階高設定", "Floor heights")}</button>
          <label className="orbit-switch"><input type="checkbox" checked={orbitEnabled} onChange={(event) => setOrbitEnabled(event.target.checked)} /><span>360° {text("ビュー", "view")} {orbitEnabled ? "ON" : "OFF"}</span></label>
        </div>
      </div>
      <div className="massing-summary">
        <span>{text("主要用途", "Primary use")} <b>{intendedUseLabel}</b></span>
        <span>{text("最高高さ", "Maximum height")} <b>{envelope.maximumHeightMeters.toFixed(2)}m</b></span>
        <span>{text("道路側高さ", "Road-side height")} <b>{envelope.minimumHeightMeters.toFixed(2)}m</b></span>
        {envelope.shadowAnalysis && <span>{text("日影規制後", "After shadow control")} <b>{envelope.shadowAnalysis.nearMaximumHours.toFixed(2)}h／{envelope.shadowAnalysis.farMaximumHours.toFixed(2)}h</b></span>}
        <span>{text("建築面積", "Building area")} <b>{envelope.footprintAreaSquareMeters.toFixed(2)}m² / {text("許容", "limit ")}{limits.permittedBuildingArea?.toFixed(2) ?? "—"}m²</b></span>
        <span className={exceedsFar ? "limit-exceeded" : ""}>{text("延床面積", "Gross floor area")} <b>{grossFloorArea === null ? text("階高設定後に算出", "Calculated after floor-height setup") : `${grossFloorArea.toFixed(2)}m²`} / {text("許容", "limit ")}{limits.permittedGrossFloorArea?.toFixed(2) ?? "—"}m²</b></span>
      </div>
      {(exceedsBuildingArea || exceedsFar) && <div className="massing-limit-warnings" role="alert">
        {exceedsBuildingArea && <p>{text(`建築面積が許容建築面積を${(envelope.footprintAreaSquareMeters - (limits.permittedBuildingArea ?? 0)).toFixed(2)}㎡超過しています。平面計画で削減してください。`, `Building area exceeds the permitted area by ${(envelope.footprintAreaSquareMeters - (limits.permittedBuildingArea ?? 0)).toFixed(2)}m². Reduce the plan footprint.`)}</p>}
        {exceedsFar && <p>{text(`延床面積が許容延床面積を${((grossFloorArea ?? 0) - (limits.permittedGrossFloorArea ?? 0)).toFixed(2)}㎡超過しています。階数または各階面積を削減してください。`, `Gross floor area exceeds the permitted area by ${((grossFloorArea ?? 0) - (limits.permittedGrossFloorArea ?? 0)).toFixed(2)}m². Reduce the floor count or floor areas.`)}</p>}
      </div>}

      {floorEditorOpen && (
        <div className="floor-settings-panel">
          <div className="floor-setting-list">
            {floorHeights.map((height, index) => <label key={index}><span>{text(`${index + 1}階の階高`, `Floor ${index + 1} height`)}</span><b className="floor-available-area">{text("確保可能", "Available")} {floorAreas[index]?.toFixed(2) ?? "—"}m²{index === floorHeights.length - 1 ? text("（屋根+1m）", " (roof +1m)") : ""}</b><input type="number" min="0.1" step="0.1" value={height} placeholder={text("例 3.5", "e.g. 3.5")} onChange={(event) => updateFloor(index, event.target.value)} /><i>m</i><button type="button" className="remove-floor" aria-label={text(`${index + 1}階を削除`, `Remove floor ${index + 1}`)} onClick={() => removeFloor(index)}>×</button></label>)}
          </div>
          <div className="floor-setting-actions">
            <button type="button" onClick={() => setFloorHeights((current) => [...current, ""])}>① + {text("1階層ずつ追加", "Add one floor")}</button>
            <button type="button" onClick={() => setRangeEditorOpen(true)}>② + {text("同様の階高で追加", "Add repeated heights")}</button>
            <button type="button" className="floor-reset" onClick={() => { setFloorHeights([""]); setRangeEditorOpen(false); setFloorError(""); }}>{text("設定を解除", "Clear settings")}</button>
          </div>
          {rangeEditorOpen && <div className="same-height-range"><input aria-label={text("同じ階高の開始階", "First repeated floor")} type="number" min="1" step="1" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /><span>{text("階 ～", "F to")}</span><input aria-label={text("同じ階高の終了階", "Last repeated floor")} type="number" min="1" step="1" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /><span>{text("階まで　階高", "F, height")}</span><input aria-label={text("共通の階高", "Repeated floor height")} type="number" min="0.1" step="0.1" value={rangeHeight} onChange={(event) => setRangeHeight(event.target.value)} /><span>m</span><button type="button" onClick={applyRange}>{text("一括設定", "Apply")}</button><button type="button" className="range-cancel" onClick={() => { setRangeEditorOpen(false); setFloorError(""); }}>{text("キャンセル", "Cancel")}</button></div>}
          {floorError && <p className="floor-error">{floorError}</p>}
          {exceedsFar && <p className="floor-error">{text("設定した階数では許容延床面積を超えます。階数または階高を見直してください。", "The configured floors exceed the permitted gross floor area. Review the floor count or heights.")}</p>}
        </div>
      )}

      <div className="view-command-groups">
        <div><span>{text("平面", "Plan")}</span><button type="button" onClick={() => chooseView(0, 88)}>{text("平面ビュー", "Plan view")}</button></div>
        <div><span>{text("8方向の立面", "8 elevations")}</span><div>{DIRECTIONS.map(([name, value]) => <button type="button" key={`e-${name}`} onClick={() => chooseView(value, 2)}>{text(name, ({ 北: "N", 北東: "NE", 東: "E", 南東: "SE", 南: "S", 南西: "SW", 西: "W", 北西: "NW" } as Record<string, string>)[name])}</button>)}</div></div>
        <div><span>{text("8方向の斜め上3D", "8 aerial views")}</span><div>{DIRECTIONS.map(([name, value]) => <button type="button" key={`3d-${name}`} onClick={() => chooseView(value, 32)}>{text(name, ({ 北: "N", 北東: "NE", 東: "E", 南東: "SE", 南: "S", 南西: "SW", 西: "W", 北西: "NW" } as Record<string, string>)[name])}</button>)}</div></div>
      </div>
      <div className="massing-canvas-wrap">
        <canvas ref={canvasRef} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={() => { dragRef.current = null; }} onMouseLeave={() => { dragRef.current = null; }} onAuxClick={(event) => event.preventDefault()} className={orbitEnabled ? "orbit-active" : ""} aria-label={text("法規制を反映した建築可能ボリュームの360度ビュー", "360-degree view of the buildable massing envelope")} />
        {plan.trueNorthAngleDegrees !== null && <div className="massing-north-indicator" aria-label={`${text("真北", "True north")} ${plan.trueNorthAngleDegrees.toFixed(1)}°`}><svg viewBox="0 0 54 112" aria-hidden="true"><text x="27" y="13" textAnchor="middle">N</text><g style={{ transformOrigin: "27px 70px", transform: `rotate(${plan.trueNorthAngleDegrees - azimuth}deg)` }}><line x1="27" y1="94" x2="27" y2="29" /><path d="M27 24 L12 53 L27 61 Z" /><line x1="12" y1="53" x2="41" y2="67" /><line x1="8" y1="70" x2="46" y2="70" /></g></svg><span>{text("真北", "True north")} {plan.trueNorthAngleDegrees.toFixed(1)}°</span></div>}
        <div className="height-legend" aria-label={text("高さの色凡例", "Height color legend")}><span>{floorScheduleActive ? text("階", "Floor") : text("高さ", "Height")}</span>{(floorScheduleActive ? floors.heights : Array.from({ length: Math.ceil(envelope.maximumHeightMeters / 5) }, () => 5)).map((_, index, values) => <i key={index} style={{ background: bandColor(index, values.length, .95) }}>{floorScheduleActive ? `${index + 1}F` : `${index * 5}–${Math.min((index + 1) * 5, Math.ceil(envelope.maximumHeightMeters))}m`}</i>)}</div>
      </div>
      <div className="angle-controls">
        <label>{text("方位角", "Azimuth")} <b>{azimuth.toFixed(0)}°</b><input type="range" min="0" max="359" value={azimuth} onChange={(event) => setAzimuth(Number(event.target.value))} /></label>
        <label>{text("仰角", "Elevation")} <b>{elevation.toFixed(0)}°</b><input type="range" min="2" max="88" value={elevation} onChange={(event) => setElevation(Number(event.target.value))} /></label>
        <label>{text("拡大", "Zoom")} <b>{zoom.toFixed(2)}×</b><input type="range" min="0.65" max="4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      </div>
      <p className="massing-note">{text(`全境界から${envelope.setbackMeters.toFixed(2)}m後退し、道路幅員${envelope.roadWidthMeters?.toFixed(3) ?? "不明"}m・通常道路斜線${envelope.roadSlope?.toFixed(1) ?? "—"}・高さ上限${regulations.conservativeMaximumHeightMeters?.toFixed(0) ?? "45"}mを不利側に採用。左ドラッグで上下左右移動、ホイールで拡大縮小、ホイール押しドラッグで方位角・仰角を操作できます。`, `The envelope uses a ${envelope.setbackMeters.toFixed(2)}m setback from every boundary, road width ${envelope.roadWidthMeters?.toFixed(3) ?? "unknown"}m, standard road-plane slope ${envelope.roadSlope?.toFixed(1) ?? "—"}, and a conservative height cap of ${regulations.conservativeMaximumHeightMeters?.toFixed(0) ?? "45"}m. Left-drag to pan, wheel to zoom, and middle-drag to orbit.`)}</p>
      {envelope.shadowAnalysis && <p className="massing-note shadow-study-note">{text(`日影規制を最終3D形状へ適用済みです。冬至日8～16時を${envelope.shadowAnalysis.timeStepMinutes}分間隔で計算し、境界から5～10mは${regulations.shadowTimeLimitNearHours}時間以内、10m超は${regulations.shadowTimeLimitFarHours}時間以内となるよう、影の超過に関係する部分だけを局所的に低くしています。解析格子は約${envelope.shadowAnalysis.sampleGridMeters.toFixed(2)}mです。`, `Shadow controls are applied to the final 3D envelope. Winter-solstice shadows are calculated from 08:00 to 16:00 at ${envelope.shadowAnalysis.timeStepMinutes}-minute intervals. Only contributing areas are lowered to remain within ${regulations.shadowTimeLimitNearHours} hours at 5–10m and ${regulations.shadowTimeLimitFarHours} hours beyond 10m. Analysis grid: approx. ${envelope.shadowAnalysis.sampleGridMeters.toFixed(2)}m.`)}</p>}
      {regulations.shadowRegulationApplies && !envelope.shadowAnalysis && <p className="massing-note shadow-study-note">{text("日影規制の計算に必要な緯度・真北・測定面・規制時間のいずれかを取得できないため、3D結果を確定できません。", "The 3D result cannot be finalized because latitude, true north, measurement plane, or permitted shadow time is unavailable.")}</p>}
      {projectActions}
    </section>
  );
}
