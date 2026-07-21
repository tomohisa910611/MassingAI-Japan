# MassingAI Japan

## Live demo

**Production:** https://massing-ai-japan.vercel.app/

The production site opens in English by default and can be switched between English and Japanese.

## Quick start

Requirements: Node.js 20 or later.

```bash
npm install
```

Create `.env.local` from `.env.example`, then add the environment variables you need:

```env
OPENAI_API_KEY=your_openai_api_key
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Only for new, unregistered analyses | Sends a new site-plan image to GPT-5.6 Sol and searches official planning sources for an unregistered address. |
| `BLOB_READ_WRITE_TOKEN` | Optional | Enables shared cloud project storage with Vercel Blob. Without it, development storage or browser fallback is used. |
| `VERCEL_OIDC_TOKEN` | Automatic on supported Vercel environments | Detected automatically for Vercel Blob access; no manual local value is normally required. |

Start the development server:

```bash
npm run dev
```

Open http://localhost:3000/.

## Verified demos work without an API key

Choose **Open** in the project menu to load either bundled verified demo. The verified site geometry, planning controls, saved project state, and 3D settings are embedded in the application. Judges can therefore review the complete 2D, regulation, floor-height, 3D, and project workflow without an OpenAI API key or API credits.

An OpenAI API key is required only when analyzing a new drawing or an address that is not one of the bundled verified references.

## How we built this

GPT-5.6 Sol is used for multimodal understanding of Japanese site-survey drawings. The server sends the uploaded image with original-detail vision input and asks the model to structure the boundary vertices, side lengths, roads, site area, coordinate evidence, and true-north direction. The result is validated before it reaches the editable 2D and 3D interfaces.

Codex implemented and repeatedly verified the Next.js application, server-only OpenAI integration, structured geometry validation, editable 2D boundary tools, regulatory calculations, interactive 3D massing, floor-height analysis, bilingual UI, project persistence, deterministic demo paths, automated tests, and Vercel/GitHub delivery.

The human collaborator supplied Japanese architectural and survey-drawing knowledge, selected conservative legal assumptions, explained how designers interpret dimensions and road information, decided which uncertainty must remain visible, and reviewed every iteration from the perspective of a practicing architectural user. This division of work let Codex accelerate implementation while keeping product and domain decisions under human control.

## Submission references

- **Track:** OpenAI Build Week — Work & Productivity
- **Demo video:** https://youtu.be/YZppVi1qEkw
- **Source code:** https://github.com/tomohisa910611/MassingAI-Japan
- **Detailed Codex collaboration record:** [DEVLOG.md](DEVLOG.md)

敷地求積図を読み取り、住所・主要用途に関係する建築規制を調査し、安全側の建築可能ボリュームを3D算出するハッカソン用Webアプリです。

## 現在できること

- PNGまたはJPEGの敷地図を、選択またはドラッグ＆ドロップで1枚アップロード
- サーバー側からOpenAI GPT-5.6 Solへ画像を送信
- 敷地境界の頂点、辺長、地積、方位を読取
- 読み取った敷地を、細い青線と番号ピン付きの2Dポリゴンとして表示
- 同じ画像には保存済み解析結果を再利用し、再解析時のAIの揺らぎを防止
- 頂点の前後2辺の長さから算出した2候補のどちらかを選んで修正
- 辺のダブルクリックで頂点を追加し、頂点のダブルクリックで確認後に削除
- Ctrl+Z／Ctrl+Yによる取り消し・やり直し
- 修正後の地積と頂点数を自動更新
- 対角線、三角形の底辺・高さを内部データとして形状確認に利用
- 座標求積図の点名・X座標・Y座標を保持し、不足する辺長を座標から計算
- APIキーをブラウザへ出さず、サーバー内だけで使用
- 住所と建築基準法上の主要用途から、国・都道府県・市区町村の法令条例を公式情報優先で一次調査
- 建ぺい率・容積率から許容建築面積と延床面積を計算
- 未確定条件は、不利になる規制だけを安全側として採用し、未確定の緩和は不採用
- 全境界0.5m後退、道路斜線、高さ上限を反映した半透明3Dボリュームを表示
- 360°ドラッグ、平面、東西南北・斜め方向の立面／3Dプリセット、方位角・仰角・拡大の調整
- 階高を1階ずつ、または同一階高の範囲で設定し、階別色帯・床ライン・概算延床面積を自動更新
- 0.5mグリッド、各階・斜線開始・屋根頂点の高さ、平面の辺寸法と後退距離を表示
- 斜線面も高さ帯・階ごとの色へ分割し、斜線と各ラインの交点までの平面距離を表示
- 左ドラッグで表示移動、ホイールで拡大縮小、ホイール押しドラッグで方位角・仰角を操作
- 高さ5mごとに青から赤へ変化する色帯を表示

## 初回の起動方法

必要なものはNode.js 20以上と、利用可能なOpenAI APIキーです。

```bash
npm install
npm run dev
```

起動後、ブラウザで `http://localhost:3000` を開きます。

APIキーは `.env.local` の次の行へ入力します。

```text
OPENAI_API_KEY=ここにAPIキーを貼り付ける
```

APIキーを画面、ソースコード、スクリーンショット、チャット、GitHubへ貼らないでください。

詳しい手順は [docs/START_HERE_JA.md](docs/START_HERE_JA.md) を参照してください。

## 確認用コマンド

```bash
npm run test
npm run lint
npm run build
```

## 注意点

- AIの画像読取には誤差があるため、必ず元図面と目視で照合してください。
- 辺長が似ていても長方形とは仮定せず、図面上の歪みを保持する設計です。
- 座標がある場合は、図形の位置関係と辺長の根拠として座標を優先します。
- 図面に印字された辺長は画像上の見かけの縮尺より優先します。
- 手動修正後の地積は、印字された初期地積と図形の面積比を基準に更新します。
- 本ツールの結果は測量成果や法的判断の代わりにはなりません。
- 3Dは安全側の初期包絡形状です。避難、設備、構造、用途別条例、行政解釈などで実際の建物はさらに小さくなる場合があります。

## OpenAI公式資料

- [画像入力](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-5.6](https://developers.openai.com/api/docs/models/gpt-5.6-sol)

## 道路・真北情報の読み取り

- 敷地に接する道路について、図面に印字された道路種別・路線名・道路幅員を読み取ります。
- 真北矢印から、画面上方向を0°、時計回りとした角度を表示します。
- 法的な道路種別が図面に書かれていない場合は推測せず、「不明」として人の確認を残します。
- 数値角度が書かれていない真北矢印は画像からの推定値であり、測量精度の方位角ではありません。
- 複数の接道は「道路1、道路2…」と番号を付け、接する敷地辺の外側へ薄いグレーの道路帯として描きます。
- 道路帯には道路番号と幅員を表示し、図面右下には解析角度に合わせて回転する真北記号を表示します。
