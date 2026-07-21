"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type Language = "en" | "ja";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  text: (japanese: string, english: string) => string;
  translateDynamic: (value: string | null | undefined) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

const exactEnglish: Record<string, string> = {
  "商業地域": "Commercial zone",
  "近隣商業地域": "Neighborhood commercial zone",
  "準防火地域": "Quasi-fire prevention district",
  "読取不可": "Not detected",
  "不明": "Unknown",
  "要確認": "Review required",
  "適用なし": "Not applicable",
  "該当なしとして評価": "Assessed as not applicable",
  "法４２条１項１号道路": "Building Standards Act, Article 42(1)(i) road",
  "法42条1項1号道路": "Building Standards Act, Article 42(1)(i) road",
  "住居表示を優先した公式都市計画図との照合済み参考値（街区内の詳細境界は未確定）": "Reference values checked against the official planning map using the postal address; detailed block boundaries remain unconfirmed.",
  "住居表示を優先した公式都市計画図との照合済み参考値（街区内の境界は役所確認が必要）": "Reference values checked against the official planning map using the postal address; detailed block boundaries require authority confirmation.",
  "防火地域（耐火建築物等による建ぺい率加算は自動適用しない）": "Fire prevention district (BCR bonus for fire-resistant construction is not applied automatically)",
  "高度地区の指定なし。3Dでは不利側として地区計画B地区の高さ45mを上限に採用。": "No height district designation. The 3D model conservatively applies the District Plan Zone B height cap of 45m.",
  "商業地域の通常値：勾配1.5。地区計画による緩和は自動適用しない。": "Standard commercial-zone road plane: slope 1.5. District-plan relaxations are not applied automatically.",
  "立上り31m・勾配2.5（通常値）": "Starting height 31m; slope 2.5 (standard value)",
  "商業地域のため通常は適用なし": "Normally not applicable in a commercial zone",
  "商業地域のため東京都の日影規制は通常対象外。敷地が他地域にまたがる場合は、対象となる側の不利な条件を採用。": "Tokyo shadow controls normally do not apply in a commercial zone. If the site crosses another zone, the more restrictive applicable condition is used.",
  "商業地域のため東京都の日影規制は通常対象外。敷地が他地域にまたがる場合は要確認。": "Tokyo shadow controls normally do not apply in a commercial zone. Review is required if the site crosses another zone.",
  "外神田二・三丁目地区地区計画（不利側としてB地区条件を採用）": "Sotokanda 2- and 3-chome District Plan (Zone B conditions applied conservatively)",
  "敷地面積最低限度50㎡、高さ45m、壁面位置0.5mを今回の3Dへ見込む。基準容積率を超える住宅等向けの割増や道路斜線緩和は見込まない。": "The 3D model applies a 50m² minimum site area, 45m height cap, and 0.5m wall setback. Residential FAR bonuses and road-plane relaxations are excluded.",
  "住宅等は、地区計画の条件を満たす場合に容積率割増の検討余地がありますが、未確定のため割増は採用しません。": "A residential FAR bonus may be available if district-plan conditions are met, but it is not applied because eligibility is unconfirmed.",
  "住宅等は、地区計画の条件を満たす場合に容積率割増の検討余地があります。40㎡以上の住戸等の条件を役所へ確認してください。": "A residential FAR bonus may be available if district-plan conditions are met. Confirm requirements such as dwelling units of at least 40m² with the authority.",
  "この用途だけで地区計画の住宅等向け容積率割増を使えるとは扱わず、安全側の基準容積率で計算します。": "This use is not assumed eligible for the district-plan residential FAR bonus; the conservative base FAR is used.",
  "地区計画の届出が必要となる可能性があります。": "A district-plan notification may be required.",
  "神田地域の景観形成基準、東京都建築安全条例、用途別の避難・バリアフリー・駐車場規定は建物規模確定後に再判定します。": "Kanda landscape guidelines, the Tokyo Building Safety Ordinance, and use-specific egress, accessibility, and parking rules must be reassessed after building size is set.",
  "隣地境界線・道路境界線の全てから0.5m後退": "0.5m setback from every adjacent-lot and road boundary",
  "地区計画B地区の高さ45m上限を採用": "45m height cap from District Plan Zone B",
  "通常の道路斜線（勾配1.5）を採用": "Standard road plane (slope 1.5)",
  "防火地域の建ぺい率加算、地区計画の容積率割増・道路斜線緩和は不採用": "No BCR bonus for the fire district, FAR bonus, or road-plane relaxation",
  "敷地が地区計画B地区内か、計画図の壁面線と後退距離": "Whether the site is in District Plan Zone B, and the mapped wall line/setback",
  "防火地域の建ぺい率加算要件を建物仕様が満たすか": "Whether the building specification qualifies for the fire-district BCR bonus",
  "都市計画情報提供ポータル上の敷地ピンと筆界の一致": "Alignment between the planning portal pin and cadastral boundary",
  "住居表示を優先し、足立区の都市計画情報で確認した保存済みのデモ解析値": "Saved demo values checked against Adachi City planning information using the postal address",
  "第三種高度地区": "Type 3 height control district",
  "近隣商業地域の道路斜線。通常勾配1.5を採用。": "Neighborhood-commercial road plane; standard slope 1.5 applied.",
  "隣地斜線：立上り31m・勾配2.5を採用。": "Adjacent-lot plane: starting height 31m; slope 2.5.",
  "日影規制5時間・3時間、測定面4.0mの条件を採用。": "Shadow limits of 5/3 hours with a 4.0m measurement plane.",
  "確認済み情報の範囲では該当なし。": "Not applicable within the verified information.",
  "全ての道路境界線・隣地境界線から0.5m後退": "0.5m setback from all road and adjacent-lot boundaries",
  "複数道路の道路斜線は各接道辺から同時に適用": "Road planes from multiple roads are applied simultaneously from every frontage",
  "未確定の緩和規定は不採用": "Unconfirmed relaxations are excluded",
  "敷地内の用途地域・防火地域境界の詳細位置": "Exact zoning and fire-district boundaries within the site",
  "道路種別の確定情報": "Confirmed road classification",
  "千代田区": "Chiyoda City", "足立区": "Adachi City", "e-Gov法令検索": "e-Gov Laws and Regulations",
  "千代田区 都市計画情報（用途地域等）": "Chiyoda City planning information (zoning, etc.)",
  "外神田二・三丁目地区地区計画": "Sotokanda 2- and 3-chome District Plan",
  "建築基準法": "Building Standards Act",
  "あだち地図情報提供サービス 都市計画情報": "Adachi Map Information Service — planning information",
  "特別区道千第669号線": "Chiyoda City Road No. 669",
};

const replacements: Array<[RegExp, string]> = [
  [/ボリュームチェック/g, "MassingCheck"],
  [/共同住宅/g, "Apartment building"],
  [/飲食店/g, "Restaurant"],
  [/百貨店・マーケット・物品販売店舗/g, "Department / market / retail store"],
  [/その他・複合用途/g, "Other / mixed use"],
  [/08030｜共同住宅/g, "08030｜Apartment building"],
  [/08440｜百貨店・マーケット・物品販売店舗/g, "08440｜Department / market / retail store"],
  [/08450｜飲食店/g, "08450｜Restaurant"],
  [/08470｜事務所/g, "08470｜Office"],
  [/08990｜その他・複合用途/g, "08990｜Other / mixed use"],
  [/。建物規模の確定後に、用途固有の避難・設備・駐車場基準を再判定。/g, ". Reassess use-specific egress, equipment, and parking rules after the building size is set."],
  [/東京都建築安全条例、東京都駐車場条例、足立区景観計画は建物規模に応じて適用条件を再判定。/g, "Reassess the Tokyo Building Safety Ordinance, Tokyo Parking Ordinance, and Adachi Landscape Plan according to building size."],
  [/未確定（安全側で評価）/g, "Unconfirmed (conservative assumption)"],
  [/用途地域/g, "zoning district"],
  [/防火地域/g, "fire prevention district"],
  [/高度地区/g, "height control district"],
  [/道路斜線/g, "road setback plane"],
  [/隣地斜線/g, "adjacent-lot setback plane"],
  [/北側斜線/g, "north-side setback plane"],
  [/日影規制/g, "shadow regulation"],
  [/地区計画/g, "district plan"],
  [/適用なし/g, "not applicable"],
  [/通常値/g, "standard value"],
  [/立上り/g, "starting height "],
  [/勾配/g, "slope "],
  [/高さ/g, "height "],
  [/壁面位置/g, "wall setback"],
  [/敷地面積最低限度/g, "minimum site area"],
  [/緩和/g, "relaxation"],
  [/採用しない/g, "not applied"],
  [/採用/g, "applied"],
  [/要確認/g, "review required"],
  [/道路幅員/g, "road width"],
  [/道路境界線/g, "road boundary"],
  [/隣地境界線/g, "adjacent-lot boundary"],
  [/全て/g, "all"],
  [/から/g, " from "],
  [/後退/g, " setback"],
  [/通常は/g, "normally "],
  [/対象外/g, "outside the scope"],
  [/確認済み/g, "verified"],
  [/公式/g, "official"],
  [/初期検討/g, "preliminary study"],
  [/安全側/g, "conservative"],
];

function translateDynamicValue(value: string | null | undefined, language: Language) {
  if (!value) return language === "en" ? "Unconfirmed (conservative assumption)" : "未確定（安全側で評価）";
  if (language === "ja") return value;
  if (exactEnglish[value]) return exactEnglish[value];
  const opened = value.match(/^「(.+)」を開きました。$/);
  if (opened) return `Opened “${replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), opened[1])}”.`;
  const cleared = value.match(/^(住所|主要用途)を変更したため、法令・条例の解析結果をクリアしました。$/);
  if (cleared) return `${cleared[1] === "住所" ? "Address" : "Primary use"} changed. The planning and building-control results were cleared.`;
  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  function setLanguage(next: Language) {
    setLanguageState(next);
    document.documentElement.lang = next;
  }

  useEffect(() => { document.documentElement.lang = language; }, [language]);

  const context = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    text: (japanese, english) => language === "en" ? english : japanese,
    translateDynamic: (value) => translateDynamicValue(value, language),
  }), [language]);

  return <LanguageContext.Provider value={context}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}
