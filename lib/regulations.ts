import { z } from "zod";

export const RegulationSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  authority: z.string(),
});

export const RegulationAnalysisSchema = z.object({
  address: z.string(),
  intendedUse: z.string(),
  checkedDate: z.string(),
  locationStatus: z.string(),
  zoning: z.string().nullable(),
  designatedBuildingCoveragePercent: z.number().positive().nullable(),
  designatedFloorAreaRatioPercent: z.number().positive().nullable(),
  roadWidthFloorAreaRatioCoefficient: z.number().positive().nullable(),
  conservativeMaximumHeightMeters: z.number().positive().nullable(),
  conservativeSetbackMeters: z.number().nonnegative(),
  roadSlantSlope: z.number().positive().nullable(),
  firePreventionArea: z.string().nullable(),
  heightDistrict: z.string().nullable(),
  roadSlantRestriction: z.string().nullable(),
  adjacentSlantRestriction: z.string().nullable(),
  northSlantRestriction: z.string().nullable(),
  shadowRestriction: z.string().nullable(),
  shadowRegulationApplies: z.boolean().nullable(),
  shadowMeasurementHeightMeters: z.number().nonnegative().nullable(),
  shadowTimeLimitNearHours: z.number().positive().nullable(),
  shadowTimeLimitFarHours: z.number().positive().nullable(),
  siteLatitudeDegrees: z.number().min(20).max(50).nullable(),
  shadowCalculationLatitudeDegrees: z.number().min(20).max(50).nullable(),
  districtPlan: z.string().nullable(),
  districtPlanSummary: z.string().nullable(),
  useSpecificSummary: z.string().nullable(),
  otherRelevantRules: z.array(z.string()).max(12),
  conservativeAssumptions: z.array(z.string()).max(12),
  unresolvedItems: z.array(z.string()).max(12),
  sources: z.array(RegulationSourceSchema).max(12),
});

export type RegulationAnalysis = z.infer<typeof RegulationAnalysisSchema>;

/** 全角数字・各種ハイフンを含む住居表示を同じ住所として照合する。 */
export function normalizeJapaneseAddress(address: string) {
  return address.normalize("NFKC").replace(/[\s〒\-‐‑‒–—―−ー]/g, "");
}

function japaneseNumberToArabic(value: string) {
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!value.includes("十")) return [...value].reduce((number, digit) => number * 10 + (digits[digit] ?? 0), 0);
  const [tens, ones] = value.split("十");
  return (tens ? digits[tens] ?? 0 : 1) * 10 + (ones ? digits[ones] ?? 0 : 0);
}

/** 「3丁目12-2」「三丁目12番2号」「3-12-2」を同じ住居表示として照合する。 */
export function normalizeJapaneseAddressForMatching(address: string) {
  return address
    .normalize("NFKC")
    .replace(/[\s〒]/g, "")
    .replace(/[‐‑‒–—―−ー]/g, "-")
    .replace(/([一二三四五六七八九十]+)丁目/g, (_, number: string) => `${japaneseNumberToArabic(number)}-`)
    .replace(/(\d+)丁目/g, "$1-")
    .replace(/番地?/g, "-")
    .replace(/号/g, "")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
}

export function calculateRegulationLimits(
  analysis: RegulationAnalysis,
  siteAreaSquareMeters: number | null,
  roadWidthMeters: number | null,
) {
  const roadLimitedFar = roadWidthMeters && analysis.roadWidthFloorAreaRatioCoefficient
    ? roadWidthMeters * analysis.roadWidthFloorAreaRatioCoefficient * 100
    : null;
  const appliedFar = analysis.designatedFloorAreaRatioPercent === null
    ? roadLimitedFar
    : roadLimitedFar === null
      ? analysis.designatedFloorAreaRatioPercent
      : Math.min(analysis.designatedFloorAreaRatioPercent, roadLimitedFar);
  return {
    roadLimitedFar,
    appliedFar,
    permittedBuildingArea: siteAreaSquareMeters && analysis.designatedBuildingCoveragePercent
      ? siteAreaSquareMeters * analysis.designatedBuildingCoveragePercent / 100
      : null,
    permittedGrossFloorArea: siteAreaSquareMeters && appliedFar
      ? siteAreaSquareMeters * appliedFar / 100
      : null,
  };
}

export function knownSotokandaRegulations(address: string, intendedUse: string): RegulationAnalysis | null {
  const normalized = normalizeJapaneseAddressForMatching(address);
  const normalizedLower = normalized.toLowerCase();
  const matchesJapaneseAddress =
    normalized.includes("東京都千代田区外神田3-12") ||
    normalized.includes("外神田3-12") ||
    normalized.includes("東京都千代田区外神田3122") ||
    normalized.includes("外神田3122");
  const matchesRomanizedAddress =
    normalizedLower.includes("3-12-2,sotokanda,chiyodaku,tokyo") &&
    normalizedLower.includes("101-0021");
  if (!matchesJapaneseAddress && !matchesRomanizedAddress) return null;
  const housingUse = /住宅|長屋|寄宿舎|下宿|老人ホーム/.test(intendedUse);
  return {
    address,
    intendedUse,
    checkedDate: "2026-03-31",
    locationStatus: "住居表示を優先した公式都市計画図との照合済み参考値（街区内の詳細境界は未確定）",
    zoning: "商業地域",
    designatedBuildingCoveragePercent: 80,
    designatedFloorAreaRatioPercent: 600,
    roadWidthFloorAreaRatioCoefficient: 0.6,
    conservativeMaximumHeightMeters: 45,
    conservativeSetbackMeters: 0.5,
    roadSlantSlope: 1.5,
    firePreventionArea: "防火地域（耐火建築物等による建ぺい率加算は自動適用しない）",
    heightDistrict: "高度地区の指定なし。3Dでは不利側として地区計画B地区の高さ45mを上限に採用。",
    roadSlantRestriction: "商業地域の通常値：勾配1.5。地区計画による緩和は自動適用しない。",
    adjacentSlantRestriction: "立上り31m・勾配2.5（通常値）",
    northSlantRestriction: "商業地域のため通常は適用なし",
    shadowRestriction: "商業地域のため東京都の日影規制は通常対象外。敷地が他地域にまたがる場合は、対象となる側の不利な条件を採用。",
    shadowRegulationApplies: false,
    shadowMeasurementHeightMeters: null,
    shadowTimeLimitNearHours: null,
    shadowTimeLimitFarHours: null,
    siteLatitudeDegrees: 35.70,
    shadowCalculationLatitudeDegrees: 36,
    districtPlan: "外神田二・三丁目地区地区計画（不利側としてB地区条件を採用）",
    districtPlanSummary: "敷地面積最低限度50㎡、高さ45m、壁面位置0.5mを今回の3Dへ見込む。基準容積率を超える住宅等向けの割増や道路斜線緩和は見込まない。",
    useSpecificSummary: housingUse
      ? "住宅等は、地区計画の条件を満たす場合に容積率割増の検討余地がありますが、未確定のため割増は採用しません。"
      : "この用途だけで地区計画の住宅等向け容積率割増を使えるとは扱わず、安全側の基準容積率で計算します。",
    otherRelevantRules: [
      "地区計画の届出が必要となる可能性があります。",
      "神田地域の景観形成基準、東京都建築安全条例、用途別の避難・バリアフリー・駐車場規定は建物規模確定後に再判定します。",
    ],
    conservativeAssumptions: [
      "隣地境界線・道路境界線の全てから0.5m後退",
      "地区計画B地区の高さ45m上限を採用",
      "通常の道路斜線（勾配1.5）を採用",
      "防火地域の建ぺい率加算、地区計画の容積率割増・道路斜線緩和は不採用",
    ],
    unresolvedItems: [
      "敷地が地区計画B地区内か、計画図の壁面線と後退距離",
      "防火地域の建ぺい率加算要件を建物仕様が満たすか",
      "都市計画情報提供ポータル上の敷地ピンと筆界の一致",
    ],
    sources: [
      { title: "千代田区 都市計画情報（用途地域等）", url: "https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/yotochiiki/chikuzu.html", authority: "千代田区" },
      { title: "外神田二・三丁目地区地区計画", url: "https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/toshikeikakuzu/pdf/25sotokanda.pdf", authority: "千代田区" },
      { title: "建築基準法", url: "https://laws.e-gov.go.jp/law/325AC0000000201", authority: "e-Gov法令検索" },
    ],
  };
}

export function knownAdachiChuoHonchoRegulations(address: string, intendedUse: string): RegulationAnalysis | null {
  const normalized = normalizeJapaneseAddress(address);
  const normalizedLower = normalized.toLowerCase();
  const matchesRomanizedAddress =
    normalizedLower.includes("22612,chuohoncho,adachiku,tokyo") &&
    normalizedLower.includes("1200011");
  if (
    !normalized.includes("東京都足立区中央本町2丁目26") &&
    !normalized.includes("東京都足立区中央本町二丁目26") &&
    !normalized.includes("東京都足立区中央本町22612") &&
    !normalized.includes("東京都足立区中央本町22613") &&
    !matchesRomanizedAddress
  ) return null;
  return {
    address,
    intendedUse,
    checkedDate: "2026-07-20",
    locationStatus: "住居表示を優先し、足立区の都市計画情報で確認した保存済みのデモ解析値",
    zoning: "近隣商業地域",
    designatedBuildingCoveragePercent: 80,
    designatedFloorAreaRatioPercent: 300,
    roadWidthFloorAreaRatioCoefficient: 0.6,
    conservativeMaximumHeightMeters: 45,
    conservativeSetbackMeters: 0.5,
    roadSlantSlope: 1.5,
    firePreventionArea: "準防火地域",
    heightDistrict: "第三種高度地区",
    roadSlantRestriction: "近隣商業地域の道路斜線。通常勾配1.5を採用。",
    adjacentSlantRestriction: "隣地斜線：立上り31m・勾配2.5を採用。",
    northSlantRestriction: "適用なし。",
    shadowRestriction: "日影規制5時間・3時間、測定面4.0mの条件を採用。",
    shadowRegulationApplies: true,
    shadowMeasurementHeightMeters: 4,
    shadowTimeLimitNearHours: 5,
    shadowTimeLimitFarHours: 3,
    siteLatitudeDegrees: 35.77,
    shadowCalculationLatitudeDegrees: 36,
    districtPlan: "該当なしとして評価",
    districtPlanSummary: "確認済み情報の範囲では該当なし。",
    useSpecificSummary: `${intendedUse}。建物規模の確定後に、用途固有の避難・設備・駐車場基準を再判定。`,
    otherRelevantRules: [
      "東京都建築安全条例、東京都駐車場条例、足立区景観計画は建物規模に応じて適用条件を再判定。",
    ],
    conservativeAssumptions: [
      "全ての道路境界線・隣地境界線から0.5m後退",
      "複数道路の道路斜線は各接道辺から同時に適用",
      "未確定の緩和規定は不採用",
    ],
    unresolvedItems: [
      "敷地内の用途地域・防火地域境界の詳細位置",
      "道路種別の確定情報",
    ],
    sources: [
      { title: "あだち地図情報提供サービス 都市計画情報", url: "https://www.sonicweb-asp.jp/adachi/", authority: "足立区" },
      { title: "建築基準法", url: "https://laws.e-gov.go.jp/law/325AC0000000201", authority: "e-Gov法令検索" },
    ],
  };
}
