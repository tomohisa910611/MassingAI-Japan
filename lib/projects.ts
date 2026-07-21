import type { RegulationAnalysis } from "@/lib/regulations";
import type { ImageSize, SitePlan } from "@/lib/site-plan";

export type MassingViewState = {
  orbitEnabled: boolean;
  azimuth: number;
  elevation: number;
  zoom: number;
  pan: { x: number; y: number };
  floorHeights: string[];
};

export type SavedProject = {
  version: 1;
  id: string;
  /** 同じ案件の中だけで解析結果を再利用するための識別子 */
  analysisSessionId?: string;
  /** 保存した案件へ同じ図面を戻したときだけ解析状態を維持するための識別子 */
  imageFingerprint?: string;
  companyId: string;
  caseName: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  address: string;
  intendedUse: string;
  imageName: string;
  imageSize: ImageSize;
  plan: SitePlan;
  regulations: RegulationAnalysis;
  massingView: MassingViewState;
  /** Bundled, immutable demonstration project available without external storage. */
  isDemo?: boolean;
};

export type ProjectSummary = Pick<SavedProject, "id" | "caseName" | "displayName" | "createdAt" | "updatedAt" | "intendedUse" | "isDemo">;

export const DEFAULT_MASSING_VIEW: MassingViewState = {
  orbitEnabled: true,
  azimuth: 45,
  elevation: 32,
  zoom: 1,
  pan: { x: 0, y: 0 },
  floorHeights: [""],
};

export function buildingUseName(intendedUse: string) {
  const separatorIndex = Math.max(intendedUse.indexOf("｜"), intendedUse.indexOf("|"));
  return (separatorIndex >= 0 ? intendedUse.slice(separatorIndex + 1) : intendedUse.replace(/^\d+\s*/, "")).trim() || "用途未設定";
}

export function projectDisplayName(createdAt: string, caseName: string, intendedUse: string) {
  const date = createdAt.slice(0, 10);
  const normalizedCaseName = caseName.trim().replace(/[\\/:*?"<>|]/g, "-");
  return `${date}_${normalizedCaseName}ボリュームチェック_${buildingUseName(intendedUse)}`;
}

/** 保存済み案件では、住所表記も保存時の文字列と完全一致させる。 */
export function isSavedProjectAddressUnchanged(savedAddress: string, currentAddress: string) {
  return savedAddress === currentAddress;
}
