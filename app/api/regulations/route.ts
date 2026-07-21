import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { knownAdachiChuoHonchoRegulations, knownSotokandaRegulations, RegulationAnalysisSchema } from "@/lib/regulations";

export const runtime = "nodejs";
export const maxDuration = 300;
const REGULATION_CACHE_DIRECTORY = path.join(process.cwd(), ".regulation-cache");
const REGULATION_CACHE_VERSION = "nationwide-official-source-v3-shadow-latitude";

async function readRegulationCache(key: string) {
  try {
    const parsed = RegulationAnalysisSchema.safeParse(JSON.parse(await readFile(path.join(REGULATION_CACHE_DIRECTORY, `${key}.json`), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeRegulationCache(key: string, value: unknown) {
  try {
    await mkdir(REGULATION_CACHE_DIRECTORY, { recursive: true });
    await writeFile(path.join(REGULATION_CACHE_DIRECTORY, `${key}.json`), JSON.stringify(value), "utf8");
  } catch (error) {
    console.warn("Could not save regulation cache", error);
  }
}

function isOfficialJapaneseUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "laws.e-gov.go.jp" || hostname.endsWith(".go.jp") || hostname.endsWith(".lg.jp") ||
      /^(www\.)?(city|pref|town|vill)\.[a-z0-9-]+\.(tokyo|osaka|kyoto|hokkaido)\.jp$/.test(hostname);
  } catch { return false; }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as { address?: string; intendedUse?: string; analysisSessionId?: string; language?: "en" | "ja" };
    const address = input.address?.trim() ?? "";
    const intendedUse = input.intendedUse?.trim() ?? "";
    const requestedSessionId = input.analysisSessionId?.trim() ?? "";
    const language = input.language === "ja" ? "ja" : "en";
    const analysisSessionId = /^[a-zA-Z0-9-]{8,80}$/.test(requestedSessionId)
      ? requestedSessionId
      : `one-request-${Date.now()}-${Math.random()}`;
    if (!address || !intendedUse) {
      return NextResponse.json({ error: "住所と想定する主要用途を入力してください。" }, { status: 400 });
    }

    const known = knownSotokandaRegulations(address, intendedUse) ?? knownAdachiChuoHonchoRegulations(address, intendedUse);
    if (known) return NextResponse.json({ regulations: known, source: "official-reference" });

    const cacheKey = createHash("sha256").update(REGULATION_CACHE_VERSION).update(language).update(analysisSessionId).update(address).update(intendedUse).digest("hex");
    const cached = await readRegulationCache(cacheKey);
    if (cached) return NextResponse.json({ regulations: cached, source: "official-cache", cached: true });

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "法令検索を行うためのOpenAI API設定がありません。" }, { status: 500 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.parse({
      model: "gpt-5.6-sol",
      reasoning: { effort: "medium" },
      tools: [{
        type: "web_search",
        search_context_size: "high",
        user_location: { type: "approximate", country: "JP", timezone: "Asia/Tokyo" },
      }],
      include: ["web_search_call.action.sources"],
      input: `次の日本国内の敷地について、建築ボリューム初期検討に必要な現行法令・都市計画・都道府県条例・市区町村条例を公式サイトだけで調査してください。
住所: ${address}
想定する主要用途: ${intendedUse}

全国共通の順序で調べてください。(1)住所を緯度経度へ特定、(2)国土交通省の不動産情報ライブラリ・国土数値情報、(3)都道府県公式の都市計画・条例、(4)市区町村公式の都市計画図/GIS・例規・道路情報。市区町村公式情報が国の概略データより新しい場合は市区町村を優先してください。
用途地域、建ぺい率、容積率、道路幅員による容積率係数、防火地域、高度地区、道路・隣地・北側斜線、日影規制、地区計画、用途固有規制を確認してください。斜線制限は用途地域名だけから推測せず、自治体の都市計画情報に表示された道路・隣地・北側斜線の数値または適用なしを個別に採用してください。古い求積図や民間地図と現在の自治体公式図が異なる場合は自治体公式図を優先し、locationStatusに相違を記録してください。敷地内を用途地域や防火地域の境界が通るかは代表点だけでなく敷地範囲で確認してください。
住所のWGS84緯度をsiteLatitudeDegreesに入れ、最も近い整数緯度（四捨五入）をshadowCalculationLatitudeDegreesに入れてください（例: 東京35.69°は計算用36°）。日影規制が適用される場合はshadowRegulationApplies=trueとし、近距離・遠距離の規制時間と測定面高さを数値で入れ、対象建築物の高さ条件もshadowRestrictionへ明記してください。
未確定条件が該当すると壁面後退・建ぺい率・容積率・高さが不利になる場合だけconservativeAssumptionsへ入れて3Dへ採用し、緩和側は採用しないでください。conservativeSetbackMetersは最低0.5mとし、道路斜線勾配と安全側の高さ上限も数値化してください。確定不能な情報はnullまたはunresolvedItemsへ入れてください。結果欄に行政確認の案内文は書かないでください。sourcesには実際に参照した国・都道府県・市区町村の公式ページURLだけを入れ、checkedDateはYYYY-MM-DD形式にしてください。
${language === "en" ? "JSON内の説明文、要約、規制名称、出典タイトルは英語で記述してください。固有の日本語法令名は、英訳の後に括弧内で原文を残してください。" : "JSON内の説明文は日本語で記述してください。"}`,
      text: { format: zodTextFormat(RegulationAnalysisSchema, "site_regulation_analysis") },
    });
    if (!response.output_parsed) {
      return NextResponse.json({ error: "この住所の公式な法令情報を整理できませんでした。" }, { status: 422 });
    }
    const officialOnly = {
      ...response.output_parsed,
      sources: response.output_parsed.sources.filter((source) => isOfficialJapaneseUrl(source.url)),
    };
    await writeRegulationCache(cacheKey, officialOnly);
    return NextResponse.json({ regulations: officialOnly, source: "official-web-search" });
  } catch (error) {
    console.error("Regulation search failed", error);
    const details = error && typeof error === "object"
      ? error as { status?: number; code?: string; message?: string }
      : null;
    if (details?.status === 429 || details?.code === "insufficient_quota") {
      return NextResponse.json({ error: "法令検索の利用枠が不足しているため、未登録住所の公式情報検索を実行できません。" }, { status: 503 });
    }
    if (details?.message?.toLowerCase().includes("connection")) {
      return NextResponse.json({ error: "公式情報検索サービスへ接続できませんでした。通信状態を確認してもう一度お試しください。" }, { status: 503 });
    }
    return NextResponse.json({ error: "この住所の法令・条例を整理できませんでした。住所表記ではなく公式情報検索側で処理に失敗しました。" }, { status: 500 });
  }
}
