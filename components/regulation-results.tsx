import { calculateRegulationLimits, RegulationAnalysis } from "@/lib/regulations";
import { useLanguage } from "@/components/language-provider";
import { BUILDING_USE_ENGLISH } from "@/lib/building-uses";

type Props = {
  analysis: RegulationAnalysis;
  siteAreaSquareMeters: number | null;
  roadWidthMeters: number | null;
};

export function RegulationResults({ analysis, siteAreaSquareMeters, roadWidthMeters }: Props) {
  const { language, text, translateDynamic } = useLanguage();
  const value = (input: string | null) => translateDynamic(input);
  const intendedUseCode = analysis.intendedUse.split("｜")[0];
  const intendedUseLabel = language === "en" ? `${intendedUseCode}｜${BUILDING_USE_ENGLISH[intendedUseCode] ?? analysis.intendedUse}` : analysis.intendedUse;
  const limits = calculateRegulationLimits(analysis, siteAreaSquareMeters, roadWidthMeters);
  return (
    <section className="regulation-results" aria-labelledby="regulation-heading">
      <div className="regulation-title-row">
        <div>
          <span className="eyebrow">Official sources first</span>
          <h3 id="regulation-heading">{text("法令・条例の解析結果", "Planning and building-control analysis")}</h3>
        </div>
        <span className="provisional-badge">{text("初期検討・安全側評価", "Preliminary · conservative")}</span>
      </div>
      <p className="location-status">{translateDynamic(analysis.locationStatus)}</p>

      <div className="regulation-metrics">
        <article className="regulation-card featured"><span>{text("建ぺい率", "Building coverage ratio")}</span><strong>{analysis.designatedBuildingCoveragePercent?.toFixed(1) ?? "—"}%</strong><small>{text("許容建築面積（目安）", "Permitted building area (est.)")}<b>{limits.permittedBuildingArea?.toFixed(2) ?? "—"} {text("㎡", "m²")}</b></small></article>
        <article className="regulation-card featured"><span>{text("適用容積率（安全側）", "Applied FAR (conservative)")}</span><strong>{limits.appliedFar?.toFixed(1) ?? "—"}%</strong><small>{text("許容延床面積（目安）", "Permitted gross floor area (est.)")}<b>{limits.permittedGrossFloorArea?.toFixed(2) ?? "—"} {text("㎡", "m²")}</b></small></article>
        <article className="regulation-card"><span>{text("指定容積率", "Designated FAR")}</span><strong>{analysis.designatedFloorAreaRatioPercent?.toFixed(1) ?? "—"}%</strong><small>{text("道路幅員による上限", "Road-width cap")} {limits.roadLimitedFar?.toFixed(1) ?? "—"}%</small></article>
        <article className="regulation-card"><span>{text("用途地域", "Zoning")}</span><strong>{value(analysis.zoning)}</strong></article>
        <article className="regulation-card"><span>{text("防火地域", "Fire-control district")}</span><strong>{value(analysis.firePreventionArea)}</strong></article>
        <article className="regulation-card"><span>{text("高度地区", "Height district")}</span><strong>{value(analysis.heightDistrict)}</strong></article>
      </div>

      <div className="regulation-details">
        <article><h4>{text("斜線制限", "Setback-plane controls")}</h4><dl><div><dt>{text("道路斜線", "Road plane")}</dt><dd>{value(analysis.roadSlantRestriction)}</dd></div><div><dt>{text("隣地斜線", "Adjacent-lot plane")}</dt><dd>{value(analysis.adjacentSlantRestriction)}</dd></div><div><dt>{text("北側斜線", "North-side plane")}</dt><dd>{value(analysis.northSlantRestriction)}</dd></div></dl></article>
        <article><h4>{text("日影規制", "Shadow regulation")}</h4><p>{value(analysis.shadowRestriction)}</p>{analysis.shadowRegulationApplies && <small>{text(`住所の緯度 ${analysis.siteLatitudeDegrees?.toFixed(4) ?? "—"}°／計算用緯度 ${analysis.shadowCalculationLatitudeDegrees?.toFixed(0) ?? "—"}°。冬至日の時刻別日影計算を行い、規制時間内に収まる高さを最終3D形状へ反映します。`, `Site latitude ${analysis.siteLatitudeDegrees?.toFixed(4) ?? "—"}° / calculation latitude ${analysis.shadowCalculationLatitudeDegrees?.toFixed(0) ?? "—"}°. Winter-solstice shadows are calculated by time and applied to the final 3D envelope.`)}</small>}</article>
        <article><h4>{text("地区計画", "District plan")}</h4><p><b>{value(analysis.districtPlan)}</b></p><p>{value(analysis.districtPlanSummary)}</p></article>
        <article><h4>{text("主要用途", "Primary use")} “{intendedUseLabel}”</h4><p>{value(analysis.useSpecificSummary)}</p></article>
        <article><h4>{text("その他の関係法令・条例", "Other relevant controls")}</h4><ul>{analysis.otherRelevantRules.length ? analysis.otherRelevantRules.map((item) => <li key={item}>{translateDynamic(item)}</li>) : <li>{text("要確認", "Review required")}</li>}</ul></article>
        <article className="conservative"><h4>{text("3Dへ採用する不利側条件", "Conservative assumptions applied to 3D")}</h4><ul>{analysis.conservativeAssumptions.map((item) => <li key={item}>{translateDynamic(item)}</li>)}</ul></article>
        {analysis.unresolvedItems.length > 0 && <article className="unresolved"><h4>{text("未確定条件", "Unresolved items")}</h4><p>{text("3Dでは、緩和を見込まず不利側の条件で評価します。", "The 3D envelope excludes beneficial relaxations and uses the conservative case.")}</p><ul>{analysis.unresolvedItems.map((item) => <li key={item}>{translateDynamic(item)}</li>)}</ul></article>}
      </div>

      <div className="regulation-sources"><h4>{text("根拠となる公式情報", "Official sources")}</h4><div>{analysis.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{translateDynamic(source.authority)}｜{translateDynamic(source.title)}</a>)}</div><small>{text("確認基準日：", "Checked: ")}{analysis.checkedDate}</small></div>
    </section>
  );
}
