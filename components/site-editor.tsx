"use client";

import { MouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adjustedEdgeLength,
  areaAtDrawingPrecision,
  circleIntersections,
  Edge,
  estimatePixelsPerMeter,
  imagePointToVertexPosition,
  ImagePoint,
  ImageSize,
  polygonAreaFromReference,
  polygonAreaSquareMeters,
  resolveRoadEdgeIndices,
  roadWidthForEdge,
  SitePlan,
  Vertex,
  vertexToImagePoint,
} from "@/lib/site-plan";
import { RegulationAnalysis } from "@/lib/regulations";
import { RegulationResults } from "@/components/regulation-results";
import { Massing3DViewer } from "@/components/massing-3d-viewer";
import { MassingViewState } from "@/lib/projects";
import { useLanguage } from "@/components/language-provider";

type Props = {
  imageSize: ImageSize;
  plan: SitePlan;
  onChange: (plan: SitePlan) => void;
  regulations: RegulationAnalysis | null;
  massingView: MassingViewState;
  onMassingViewChange: (state: MassingViewState) => void;
  projectActions?: ReactNode;
};

function midpoint(a: ImagePoint, b: ImagePoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function nextVertexId(vertices: Vertex[]) {
  const used = new Set(vertices.map((vertex) => vertex.id));
  let number = 1;
  while (used.has(`V${number}`)) number += 1;
  return `V${number}`;
}

export function SiteEditor({ imageSize, plan, onChange, regulations, massingView, onMassingViewChange, projectActions }: Props) {
  const { text, translateDynamic } = useLanguage();
  const [history, setHistory] = useState<SitePlan[]>([plan]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedVertexId, setSelectedVertexId] = useState<string | null>(null);
  const [previousLength, setPreviousLength] = useState("");
  const [nextLength, setNextLength] = useState("");
  const [candidatePositions, setCandidatePositions] = useState<ImagePoint[]>([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null);
  const [pendingDeleteVertexId, setPendingDeleteVertexId] = useState<string | null>(null);
  const [editError, setEditError] = useState("");
  const [siteZoom, setSiteZoom] = useState(1);
  const [sitePan, setSitePan] = useState({ x: 0, y: 0 });
  const drawingStageRef = useRef<HTMLDivElement>(null);
  const sitePanDrag = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  // 最初に読み取った縮尺を固定し、編集した距離と面積を同じ基準で計算する。
  const [pixelsPerMeter] = useState(() => estimatePixelsPerMeter(plan, imageSize));
  const [referenceVertices] = useState(() => plan.vertices);
  const [referenceArea] = useState(() => plan.siteAreaSquareMeters);
  const activePlan = history[historyIndex];

  const recalculateArea = useCallback((vertices: Vertex[]) => areaAtDrawingPrecision(
    polygonAreaFromReference(vertices, imageSize, referenceVertices, referenceArea) ??
      polygonAreaSquareMeters(vertices, imageSize, pixelsPerMeter),
    referenceArea,
  ), [imageSize, pixelsPerMeter, referenceArea, referenceVertices]);

  const resetSelection = useCallback(() => {
    setSelectedVertexId(null);
    setCandidatePositions([]);
    setSelectedCandidateIndex(null);
    setEditError("");
  }, []);

  const commitPlan = useCallback((nextPlan: SitePlan) => {
    const nextHistory = [...history.slice(0, historyIndex + 1), nextPlan];
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    onChange(nextPlan);
    resetSelection();
  }, [history, historyIndex, onChange, resetSelection]);

  const undo = useCallback(() => {
    if (historyIndex === 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    onChange(history[nextIndex]);
    resetSelection();
  }, [history, historyIndex, onChange, resetSelection]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    onChange(history[nextIndex]);
    resetSelection();
  }, [history, historyIndex, onChange, resetSelection]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const verticesById = useMemo(
    () => new Map(activePlan.vertices.map((vertex) => [vertex.id, vertex])),
    [activePlan.vertices],
  );

  const previewVertices = useMemo(() => {
    if (selectedVertexId === null || selectedCandidateIndex === null) return activePlan.vertices;
    const candidate = candidatePositions[selectedCandidateIndex];
    if (!candidate) return activePlan.vertices;
    return activePlan.vertices.map((vertex) =>
      vertex.id === selectedVertexId ? { ...vertex, ...candidate } : vertex,
    );
  }, [activePlan.vertices, candidatePositions, selectedCandidateIndex, selectedVertexId]);

  const previewRenderById = useMemo(
    () => new Map(previewVertices.map((vertex) => [vertex.id, vertexToImagePoint(vertex, imageSize)])),
    [imageSize, previewVertices],
  );

  const candidateRenderPositions = useMemo(
    () => candidatePositions.map((candidate) => ({
      x: (candidate.x / 1000) * imageSize.width,
      y: (candidate.y / 1000) * imageSize.height,
    })),
    [candidatePositions, imageSize],
  );

  const roadRenderData = useMemo(() => {
    const signedTwiceArea = previewVertices.reduce((sum, vertex, index) => {
      const current = vertexToImagePoint(vertex, imageSize);
      const next = vertexToImagePoint(previewVertices[(index + 1) % previewVertices.length], imageSize);
      return sum + current.x * next.y - next.x * current.y;
    }, 0);

    return activePlan.roads.flatMap((road, roadIndex) => {
      const edgeIndices = resolveRoadEdgeIndices(road, activePlan.edges, activePlan.vertices);
      const segments = edgeIndices.flatMap((edgeIndex) => {
        const edge = activePlan.edges[edgeIndex];
        const start = previewRenderById.get(edge.startVertexId);
        const end = previewRenderById.get(edge.endVertexId);
        if (!start || !end) return [];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const edgeLength = Math.hypot(dx, dy);
        if (edgeLength === 0) return [];
        const direction = signedTwiceArea >= 0 ? 1 : -1;
        const outward = { x: direction * dy / edgeLength, y: direction * -dx / edgeLength };
        const segmentWidthMeters = roadWidthForEdge(road, edge) ?? 4;
        const widthPixels = Math.max(48, segmentWidthMeters * (pixelsPerMeter ?? 12));
        const startOuter = { x: start.x + outward.x * widthPixels, y: start.y + outward.y * widthPixels };
        const endOuter = { x: end.x + outward.x * widthPixels, y: end.y + outward.y * widthPixels };
        return [{
          points: [
            start,
            end,
            endOuter,
            startOuter,
          ],
          start,
          end,
          startOuter,
          endOuter,
          widthMeters: segmentWidthMeters,
          edgeLength,
          label: {
            x: (start.x + end.x) / 2 + outward.x * widthPixels * 0.66,
            y: (start.y + end.y) / 2 + outward.y * widthPixels * 0.66,
          },
        }];
      });
      if (!segments.length) return [];
      const labelSegment = [...segments].sort((a, b) => b.edgeLength - a.edgeLength)[0];
      const widths = [...new Set(segments.map((segment) => segment.widthMeters))].sort((a, b) => a - b);
      const widthLabel = widths.length > 1
        ? `${widths[0].toFixed(3)}–${widths[widths.length - 1].toFixed(3)} m`
        : `${widths[0].toFixed(3)} m`;
      return [{ road, roadIndex, segments, label: labelSegment.label, widthLabel }];
    });
  }, [activePlan.edges, activePlan.roads, activePlan.vertices, imageSize, pixelsPerMeter, previewRenderById, previewVertices]);

  const roadJunctions = useMemo(() => {
    const segments = roadRenderData.flatMap((item) => item.segments);
    const joins: ImagePoint[][] = [];
    segments.forEach((first, firstIndex) => {
      segments.slice(firstIndex + 1).forEach((second) => {
        const samePoint = Math.hypot(first.end.x - second.start.x, first.end.y - second.start.y) < 0.01;
        if (samePoint) joins.push([first.end, first.endOuter, second.startOuter]);
      });
    });
    return joins;
  }, [roadRenderData]);

  const viewport = useMemo(() => {
    const roadPoints = roadRenderData.flatMap((road) => road.segments.flatMap((segment) => segment.points));
    const points = [...previewRenderById.values(), ...candidateRenderPositions, ...roadPoints];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const rawWidth = Math.max(120, Math.max(...xs) - Math.min(...xs));
    const rawHeight = Math.max(120, Math.max(...ys) - Math.min(...ys));
    const paddingY = Math.max(70, rawHeight * 0.25);
    const viewportHeight = rawHeight + paddingY * 2;
    const markerScale = viewportHeight / 480;
    const paddingX = Math.max(rawWidth * 0.25, 82 * markerScale);
    return {
      x: Math.min(...xs) - paddingX,
      y: Math.min(...ys) - paddingY,
      width: rawWidth + paddingX * 2,
      height: rawHeight + paddingY * 2,
    };
  }, [candidateRenderPositions, previewRenderById, roadRenderData]);

  const effectiveViewport = useMemo(() => ({
    x: viewport.x + viewport.width / 2 - viewport.width / (siteZoom * 2) + sitePan.x,
    y: viewport.y + viewport.height / 2 - viewport.height / (siteZoom * 2) + sitePan.y,
    width: viewport.width / siteZoom,
    height: viewport.height / siteZoom,
  }), [sitePan, siteZoom, viewport]);

  const markerScale = effectiveViewport.height / 480;

  useEffect(() => {
    const stage = drawingStageRef.current;
    if (!stage) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setSiteZoom((value) => Math.max(0.7, Math.min(4, value - event.deltaY * 0.0015)));
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  function onSitePanStart(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest(".vertex, .site-edge-hit, .candidate, .site-zoom-control")) return;
    event.preventDefault();
    sitePanDrag.current = { clientX: event.clientX, clientY: event.clientY, panX: sitePan.x, panY: sitePan.y };
  }

  function onSitePanMove(event: MouseEvent<HTMLDivElement>) {
    if (!sitePanDrag.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - sitePanDrag.current.clientX) * effectiveViewport.width / rect.width;
    const dy = (event.clientY - sitePanDrag.current.clientY) * effectiveViewport.height / rect.height;
    setSitePan({ x: sitePanDrag.current.panX - dx, y: sitePanDrag.current.panY - dy });
  }

  function selectVertex(vertexId: string) {
    const index = activePlan.vertices.findIndex((vertex) => vertex.id === vertexId);
    if (index < 0) return;
    const previousEdge = activePlan.edges[(index - 1 + activePlan.edges.length) % activePlan.edges.length];
    const followingEdge = activePlan.edges[index];
    setSelectedVertexId(vertexId);
    setPreviousLength(
      (previousEdge.lengthMeters ?? adjustedEdgeLength(previousEdge, activePlan.vertices, imageSize, pixelsPerMeter))?.toFixed(3) ?? "",
    );
    setNextLength(
      (followingEdge.lengthMeters ?? adjustedEdgeLength(followingEdge, activePlan.vertices, imageSize, pixelsPerMeter))?.toFixed(3) ?? "",
    );
    setCandidatePositions([]);
    setSelectedCandidateIndex(null);
    setEditError("");
  }

  function calculateCandidates() {
    if (!selectedVertexId || !pixelsPerMeter) {
      setEditError("図面の縮尺を確認できないため、辺長による修正ができません。");
      return;
    }
    const firstLength = Number(previousLength);
    const secondLength = Number(nextLength);
    if (!(firstLength > 0) || !(secondLength > 0)) {
      setEditError("両方の辺長に0より大きい数値を入力してください。");
      return;
    }
    const index = activePlan.vertices.findIndex((vertex) => vertex.id === selectedVertexId);
    const previousVertex = activePlan.vertices[(index - 1 + activePlan.vertices.length) % activePlan.vertices.length];
    const nextVertex = activePlan.vertices[(index + 1) % activePlan.vertices.length];
    const intersections = circleIntersections(
      vertexToImagePoint(previousVertex, imageSize),
      firstLength * pixelsPerMeter,
      vertexToImagePoint(nextVertex, imageSize),
      secondLength * pixelsPerMeter,
    ).map((point) => imagePointToVertexPosition(point, imageSize));

    if (intersections.length === 0) {
      setCandidatePositions([]);
      setSelectedCandidateIndex(null);
      setEditError("指定した2辺は交わらないため、頂点位置を作れません。入力した寸法を確認してください。");
      return;
    }

    const current = activePlan.vertices[index];
    intersections.sort(
      (a, b) => Math.hypot(a.x - current.x, a.y - current.y) - Math.hypot(b.x - current.x, b.y - current.y),
    );
    setCandidatePositions(intersections);
    setSelectedCandidateIndex(null);
    setEditError("");
  }

  function confirmCandidate() {
    if (selectedVertexId === null || selectedCandidateIndex === null) return;
    const candidate = candidatePositions[selectedCandidateIndex];
    if (!candidate) return;
    const index = activePlan.vertices.findIndex((vertex) => vertex.id === selectedVertexId);
    const previousEdgeIndex = (index - 1 + activePlan.edges.length) % activePlan.edges.length;
    const nextVertices = activePlan.vertices.map((vertex) =>
      vertex.id === selectedVertexId ? { ...vertex, ...candidate, confidence: 1 } : vertex,
    );
    const nextEdges = activePlan.edges.map((edge, edgeIndex) => {
      if (edgeIndex === previousEdgeIndex) {
        return { ...edge, lengthMeters: Number(previousLength), measurementSource: "manual" as const, confidence: 1 };
      }
      if (edgeIndex === index) {
        return { ...edge, lengthMeters: Number(nextLength), measurementSource: "manual" as const, confidence: 1 };
      }
      return edge;
    });
    commitPlan({
      ...activePlan,
      vertices: nextVertices,
      edges: nextEdges,
      siteAreaSquareMeters: recalculateArea(nextVertices),
    });
  }

  function addVertex(edgeIndex: number, event: MouseEvent<SVGLineElement>) {
    event.stopPropagation();
    const edge = activePlan.edges[edgeIndex];
    const start = verticesById.get(edge.startVertexId);
    const end = verticesById.get(edge.endVertexId);
    if (!start || !end) return;
    const newVertex: Vertex = {
      id: nextVertexId(activePlan.vertices),
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      sourcePointName: null,
      surveyedX: null,
      surveyedY: null,
      confidence: 1,
    };
    const startIndex = activePlan.vertices.findIndex((vertex) => vertex.id === edge.startVertexId);
    const nextVertices = [
      ...activePlan.vertices.slice(0, startIndex + 1),
      newVertex,
      ...activePlan.vertices.slice(startIndex + 1),
    ];
    const fullLength = edge.lengthMeters ?? adjustedEdgeLength(edge, activePlan.vertices, imageSize, pixelsPerMeter);
    const splitLength = fullLength === null ? null : fullLength / 2;
    const nextEdges: Edge[] = [
      ...activePlan.edges.slice(0, edgeIndex),
      { startVertexId: start.id, endVertexId: newVertex.id, lengthMeters: splitLength, measurementSource: "manual", confidence: 1 },
      { startVertexId: newVertex.id, endVertexId: end.id, lengthMeters: splitLength, measurementSource: "manual", confidence: 1 },
      ...activePlan.edges.slice(edgeIndex + 1),
    ];
    commitPlan({
      ...activePlan,
      vertices: nextVertices,
      edges: nextEdges,
      siteAreaSquareMeters: recalculateArea(nextVertices),
    });
  }

  function requestDeleteVertex(vertexId: string, event: MouseEvent<SVGGElement>) {
    event.stopPropagation();
    if (activePlan.vertices.length <= 3) {
      window.alert(text("敷地形状には最低3つの頂点が必要です。", "A site boundary requires at least three vertices."));
      return;
    }
    setPendingDeleteVertexId(vertexId);
  }

  function confirmDeleteVertex() {
    const vertexId = pendingDeleteVertexId;
    if (!vertexId) return;
    setPendingDeleteVertexId(null);
    const nextVertices = activePlan.vertices.filter((vertex) => vertex.id !== vertexId);
    const existingEdges = new Map(
      activePlan.edges.map((edge) => [`${edge.startVertexId}->${edge.endVertexId}`, edge]),
    );
    const nextEdges: Edge[] = nextVertices.map((vertex, index) => {
      const end = nextVertices[(index + 1) % nextVertices.length];
      const existing = existingEdges.get(`${vertex.id}->${end.id}`);
      if (existing) return existing;
      const length = pixelsPerMeter
        ? Math.hypot(
          vertexToImagePoint(end, imageSize).x - vertexToImagePoint(vertex, imageSize).x,
          vertexToImagePoint(end, imageSize).y - vertexToImagePoint(vertex, imageSize).y,
        ) / pixelsPerMeter
        : null;
      return {
        startVertexId: vertex.id,
        endVertexId: end.id,
        lengthMeters: length,
        measurementSource: "manual",
        confidence: 1,
      };
    });
    commitPlan({
      ...activePlan,
      vertices: nextVertices,
      edges: nextEdges,
      siteAreaSquareMeters: recalculateArea(nextVertices),
    });
  }

  const polygonPoints = previewVertices
    .map((vertex) => vertexToImagePoint(vertex, imageSize))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <div>
          <span className="eyebrow">{text("敷地形状の確認・修正", "Review and refine the site")}</span>
          <h2>{text("図面上の境界を確認", "Review the detected boundary")}</h2>
        </div>
        <div className="history-actions">
          <button type="button" onClick={undo} disabled={historyIndex === 0}>{text("元に戻す", "Undo")} <small>Ctrl+Z</small></button>
          <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1}>{text("やり直す", "Redo")} <small>Ctrl+Y</small></button>
        </div>
      </div>

      <div
        ref={drawingStageRef}
        className="drawing-stage standalone"
        onMouseDown={onSitePanStart}
        onMouseMove={onSitePanMove}
        onMouseUp={() => { sitePanDrag.current = null; }}
        onMouseLeave={() => { sitePanDrag.current = null; }}
      >
        <svg
          viewBox={`${effectiveViewport.x} ${effectiveViewport.y} ${effectiveViewport.width} ${effectiveViewport.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={text("編集できる敷地境界", "Editable site boundary")}
        >
          {roadRenderData.map(({ road, roadIndex, segments, label, widthLabel }) => (
            <g key={`road-${roadIndex}`} className="road-overlay" aria-label={`${text("道路", "Road")} ${roadIndex + 1}`}>
              {segments.map((segment, segmentIndex) => (
                <polygon key={`road-${roadIndex}-segment-${segmentIndex}`} points={segment.points.map((point) => `${point.x},${point.y}`).join(" ")} />
              ))}
              <g transform={`translate(${label.x} ${label.y}) scale(${markerScale})`} className="road-label">
                <rect x="-60" y="-23" width="120" height="46" rx="9" />
                <text y="-7" textAnchor="middle" dominantBaseline="central">{text("道路", "Road")} {roadIndex + 1}</text>
                <text y="11" textAnchor="middle" dominantBaseline="central">
                  {text("幅員", "Width")} {road.widthMeters !== null ? widthLabel : text("不明", "Unknown")}
                </text>
              </g>
            </g>
          ))}
          <g className="road-overlay road-junctions" aria-hidden="true">
            {roadJunctions.map((points, index) => <polygon key={`road-junction-${index}`} points={points.map((point) => `${point.x},${point.y}`).join(" ")} />)}
          </g>
          <polygon className="site-polygon" points={polygonPoints} />
          {activePlan.edges.map((edge, index) => {
            const start = previewRenderById.get(edge.startVertexId);
            const end = previewRenderById.get(edge.endVertexId);
            if (!start || !end) return null;
            const label = midpoint(start, end);
            const length = edge.lengthMeters ?? adjustedEdgeLength(edge, previewVertices, imageSize, pixelsPerMeter);
            return (
              <g key={`${edge.startVertexId}-${edge.endVertexId}-${index}`}>
                <line
                  className="site-edge-hit"
                  x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                  onDoubleClick={(event) => addVertex(index, event)}
                />
                <line className="site-edge" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
                {(activePlan.vertices.length <= 16 || siteZoom >= 1.35) && <g transform={`translate(${label.x} ${label.y}) scale(${markerScale})`} className="edge-label">
                  <rect x="-68" y="-16" width="136" height="32" rx="10" />
                  <text textAnchor="middle" dominantBaseline="central">
                    S{index + 1}｜{length !== null ? `${length.toFixed(3)} m` : text("要確認", "Review")}
                  </text>
                </g>}
              </g>
            );
          })}

          {candidateRenderPositions.map((candidate, index) => (
            <g
              key={`candidate-${index}`}
              className={selectedCandidateIndex === index ? "candidate selected" : "candidate"}
              onClick={() => setSelectedCandidateIndex(index)}
              transform={`translate(${candidate.x} ${candidate.y}) scale(${markerScale})`}
            >
              <circle r="16" />
              <text textAnchor="middle" dominantBaseline="central">{index + 1}</text>
            </g>
          ))}

          {previewVertices.map((vertex, index) => (
            (() => {
              const renderPoint = vertexToImagePoint(vertex, imageSize);
              return (
            <g
              key={vertex.id}
              className={selectedVertexId === vertex.id ? "vertex selected" : "vertex"}
              role="button"
              aria-label={`${text("頂点", "Vertex")} ${index + 1}`}
              tabIndex={0}
              transform={`translate(${renderPoint.x} ${renderPoint.y})`}
              onClick={(event) => { event.stopPropagation(); selectVertex(vertex.id); }}
              onDoubleClick={(event) => requestDeleteVertex(vertex.id, event)}
            >
              <g transform={`scale(${markerScale})`}>
                <circle className="vertex-center" cx="0" cy="0" r="8" />
                {(activePlan.vertices.length <= 24 || siteZoom >= 1.25 || index % 5 === 0) && <g className="number-pin">
                  <path d="M 0 0 C -2 -8 -14 -12 -14 -27 A 14 14 0 1 1 14 -27 C 14 -12 2 -8 0 0 Z" />
                  <text x="0" y="-27" textAnchor="middle" dominantBaseline="central">{index + 1}</text>
                </g>}
              </g>
            </g>
              );
            })()
          ))}
        </svg>
        {activePlan.trueNorthAngleDegrees !== null && (
          <div className="north-indicator" aria-label={`${text("真北", "True north")} ${activePlan.trueNorthAngleDegrees.toFixed(1)}°`}>
            <svg viewBox="0 0 54 112" style={{ transform: `rotate(${activePlan.trueNorthAngleDegrees}deg)` }} aria-hidden="true">
              <text x="27" y="13" textAnchor="middle">N</text>
              <line x1="27" y1="94" x2="27" y2="29" />
              <path d="M27 24 L12 53 L27 61 Z" />
              <line x1="12" y1="53" x2="41" y2="67" />
              <line x1="8" y1="70" x2="46" y2="70" />
            </svg>
            <span>{text("真北", "True north")} {activePlan.trueNorthAngleDegrees.toFixed(1)}°</span>
          </div>
        )}
        <label className="site-zoom-control" onMouseDown={(event) => event.stopPropagation()}>
          <span>{text("敷地図の拡大", "Site-view zoom")} <b>{siteZoom.toFixed(2)}×</b></span>
          <input type="range" min="0.7" max="4" step="0.05" value={siteZoom} onChange={(event) => setSiteZoom(Number(event.target.value))} />
        </label>
      </div>

      {selectedVertexId && (
        <div className="vertex-editor">
          <div>
            <span className="eyebrow">{text("選択中の頂点", "Selected vertex")}</span>
            <h3>{text("頂点", "Vertex")} {activePlan.vertices.findIndex((vertex) => vertex.id === selectedVertexId) + 1} {text("を修正", "editing")}</h3>
          </div>
          <label>{text("辺", "Side")} {(activePlan.vertices.findIndex((vertex) => vertex.id === selectedVertexId) - 1 + activePlan.edges.length) % activePlan.edges.length + 1} {text("の長さ（m）", "length (m)")}<input inputMode="decimal" value={previousLength} onChange={(event) => setPreviousLength(event.target.value)} /></label>
          <label>{text("辺", "Side")} {activePlan.vertices.findIndex((vertex) => vertex.id === selectedVertexId) + 1} {text("の長さ（m）", "length (m)")}<input inputMode="decimal" value={nextLength} onChange={(event) => setNextLength(event.target.value)} /></label>
          <button type="button" className="secondary-button" onClick={calculateCandidates}>{text("候補を計算", "Calculate positions")}</button>
          {candidatePositions.length > 0 && (
            <div className="candidate-buttons">
              {candidatePositions.map((_, index) => (
                <button
                  type="button"
                  key={index}
                  className={selectedCandidateIndex === index ? "active" : ""}
                  onClick={() => setSelectedCandidateIndex(index)}
                >{text("候補", "Option")} {index + 1}{index === 0 ? text("（現在位置に近い）", " (nearest current position)") : ""}</button>
              ))}
            </div>
          )}
          {editError && <p className="edit-error">{translateDynamic(editError)}</p>}
          <button type="button" className="primary-button" onClick={confirmCandidate} disabled={selectedCandidateIndex === null}>{text("この位置で決定", "Confirm this position")}</button>
        </div>
      )}

      <div className="editor-notes">
        <p>{text("頂点をクリックして両隣の2辺の長さを指定。辺をダブルクリックで頂点追加、頂点をダブルクリックで削除できます。", "Click a vertex to edit its two adjoining side lengths. Double-click a side to add a vertex, or a vertex to delete it.")}</p>
        <p>{text("本データは図面画像に対する編集可能な一次デジタル化であり、測量成果または法的な境界確定ではない。", "This is an editable preliminary digitization of the uploaded drawing, not a survey result or legal boundary determination.")}</p>
      </div>

      <h3 className="analysis-heading">{text("敷地の解析データ", "Site analysis")}</h3>
      <div className="result-grid analysis-data">
        <div className="metric-card"><span>{text("地積", "Site area")}</span><strong>{activePlan.siteAreaSquareMeters?.toFixed(2) ?? text("不明", "Unknown")} {text("㎡", "m²")}</strong></div>
        <div className="metric-card"><span>{text("頂点数", "Vertices")}</span><strong>{activePlan.vertices.length}</strong></div>
        {activePlan.roads.length > 0 ? activePlan.roads.flatMap((road, index) => [
          <div className="metric-card text-metric" key={`road-type-${index}`}>
            <span>{text("道路", "Road")} {index + 1} {text("種別", "classification")}</span>
            <strong>{translateDynamic(road.legalClassification ?? "読取不可")}</strong>
            {road.roadName && <small>{translateDynamic(road.roadName)}</small>}
          </div>,
          <div className="metric-card" key={`road-width-${index}`}>
            <span>{text("道路", "Road")} {index + 1} {text("幅員", "width")}</span>
            <strong>{roadRenderData.find((item) => item.roadIndex === index)?.widthLabel ?? (road.widthMeters !== null ? `${road.widthMeters.toFixed(3)} m` : "不明")}</strong>
          </div>,
        ]) : (
          <div className="metric-card text-metric"><span>{text("道路", "Road")}</span><strong>{text("読取不可", "Not detected")}</strong></div>
        )}
        <div className="metric-card text-metric">
          <span>{text("真北角度", "True-north angle")}</span>
          <strong>{activePlan.trueNorthAngleDegrees !== null ? `${activePlan.trueNorthAngleDegrees.toFixed(1)}°` : text("読取不可", "Not detected")}</strong>
          <small>{text("画面上方向を0°、時計回り", "Clockwise from screen up (0°)")}{activePlan.trueNorthSource === "north_arrow_estimate" ? text("（画像推定）", " (image estimate)") : ""}</small>
        </div>
      </div>

      {regulations && (
        <>
          <RegulationResults
            analysis={regulations}
            siteAreaSquareMeters={activePlan.siteAreaSquareMeters}
            roadWidthMeters={activePlan.roads.find((road) => road.widthMeters !== null)?.widthMeters ?? null}
          />
          <Massing3DViewer
            plan={activePlan}
            imageSize={imageSize}
            regulations={regulations}
            initialViewState={massingView}
            onViewStateChange={onMassingViewChange}
            projectActions={projectActions}
          />
        </>
      )}

      {pendingDeleteVertexId && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setPendingDeleteVertexId(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="delete-dialog-title">{text("この頂点を削除しますか？", "Delete this vertex?")}</h3>
            <p>{text("削除後も「元に戻す」で修正前へ戻れます。", "You can restore it with Undo.")}</p>
            <div>
              <button type="button" className="secondary-button" onClick={() => setPendingDeleteVertexId(null)}>{text("いいえ", "No")}</button>
              <button type="button" className="primary-button" onClick={confirmDeleteVertex}>{text("はい", "Yes")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
