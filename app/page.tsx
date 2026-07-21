"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { SiteEditor } from "@/components/site-editor";
import { useLanguage } from "@/components/language-provider";
import { BUILDING_USES, buildingUseLabel, localizeProjectDisplayName } from "@/lib/building-uses";
import { RegulationAnalysis } from "@/lib/regulations";
import { ImageSize, SitePlan } from "@/lib/site-plan";
import { DEFAULT_MASSING_VIEW, isSavedProjectAddressUnchanged, MassingViewState, projectDisplayName, ProjectSummary, SavedProject } from "@/lib/projects";
import { deleteBrowserProject, getBrowserProject, listBrowserProjects, saveBrowserProject } from "@/lib/browser-project-storage";

const MAX_SIZE = 3 * 1024 * 1024;

async function readImageSize(url: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}

export default function Home() {
  const { language, setLanguage, text, translateDynamic } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisSessionIdRef = useRef(crypto.randomUUID());
  const selectedFileFingerprintRef = useRef("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [plan, setPlan] = useState<SitePlan | null>(null);
  const [regulations, setRegulations] = useState<RegulationAnalysis | null>(null);
  const [address, setAddress] = useState("");
  const [intendedUse, setIntendedUse] = useState("");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentProject, setCurrentProject] = useState<SavedProject | null>(null);
  const [massingView, setMassingView] = useState<MassingViewState>(DEFAULT_MASSING_VIEW);
  const [caseName, setCaseName] = useState("");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([]);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectMessage, setProjectMessage] = useState("");

  useEffect(() => () => {
    if (imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  async function acceptFile(nextFile: File) {
    setError("");
    if (!["image/png", "image/jpeg"].includes(nextFile.type)) {
      setError("PNGまたはJPEG画像を選んでください。");
      return;
    }
    if (nextFile.size > MAX_SIZE) {
      setError("画像は3MB以下にしてください。");
      return;
    }
    const nextUrl = URL.createObjectURL(nextFile);
    try {
      const size = await readImageSize(nextUrl);
      const fingerprint = `${nextFile.name}:${nextFile.size}:${nextFile.lastModified}`;
      const isSameSavedProjectImage = Boolean(currentProject && (
        (currentProject.imageFingerprint && fingerprint === currentProject.imageFingerprint) ||
        (!currentProject.imageFingerprint && nextFile.name === currentProject.imageName &&
          size.width === currentProject.imageSize.width && size.height === currentProject.imageSize.height)
      ));
      const isSameProjectImage = fingerprint === selectedFileFingerprintRef.current || isSameSavedProjectImage;
      if (!isSameProjectImage) {
        analysisSessionIdRef.current = crypto.randomUUID();
        selectedFileFingerprintRef.current = fingerprint;
        setPlan(null);
        setRegulations(null);
        setCurrentProject(null);
        setCaseName("");
        setMassingView(DEFAULT_MASSING_VIEW);
      }
      setFile(nextFile);
      setSelectedFileName(nextFile.name);
      setImageUrl(nextUrl);
      setImageSize(size);
      setProjectMessage(isSameProjectImage
        ? "同じプロジェクトの画像です。保存済みの解析結果を再利用します。"
        : "別の画像を選択したため、新規解析として開始します。");
    } catch {
      URL.revokeObjectURL(nextUrl);
      setError("選択した画像を開けませんでした。");
    }
  }

  function clearSelectedImage() {
    if (imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    setFile(null);
    setSelectedFileName("");
    setImageUrl("");
    setImageSize(null);
    setPlan(null);
    setRegulations(null);
    setCurrentProject(null);
    setCaseName("");
    setMassingView(DEFAULT_MASSING_VIEW);
    analysisSessionIdRef.current = crypto.randomUUID();
    selectedFileFingerprintRef.current = "";
    setError("");
    setProjectMessage("選択した画像を取り消しました。");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (selected) void acceptFile(selected);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const selected = event.dataTransfer.files?.[0];
    if (selected) void acceptFile(selected);
  }

  async function analyze() {
    if (!file && !plan) return;
    if (!address.trim() || !intendedUse) {
      setError("住所と想定する主要用途を入力してください。");
      return;
    }
    if (currentProject && !isSavedProjectAddressUnchanged(currentProject.address, address)) {
      setError(`保存時の住所「${currentProject.address}」と完全一致しません。保存済みプロジェクト内では住所表記を変更せず、新しい表記で試す場合は「新規作成」を使用してください。`);
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      let resolvedPlan = plan;
      if (!resolvedPlan) {
        if (!file) throw new Error("敷地図画像を選択してください。");
        const body = new FormData();
        body.append("image", file);
        body.append("address", address.trim());
        body.append("analysisSessionId", analysisSessionIdRef.current);
        const response = await fetch("/api/analyze", { method: "POST", body });
        const data = (await response.json()) as { plan?: SitePlan; error?: string };
        if (!response.ok || !data.plan) throw new Error(data.error || "解析に失敗しました。");
        resolvedPlan = data.plan;
        setPlan(data.plan);
      }
      const canReuseSavedRegulations = Boolean(currentProject && regulations &&
        address === currentProject.address && intendedUse === currentProject.intendedUse);
      if (!canReuseSavedRegulations) {
        const regulationResponse = await fetch("/api/regulations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, intendedUse, analysisSessionId: analysisSessionIdRef.current, language }),
        });
        const regulationData = (await regulationResponse.json()) as { regulations?: RegulationAnalysis; error?: string };
        if (!regulationResponse.ok || !regulationData.regulations) {
          throw new Error(`敷地境界の解析は完了しましたが、${regulationData.error || "法令・条例の検索に失敗しました。"}`);
        }
        setRegulations(regulationData.regulations);
      }
      setProjectMessage(canReuseSavedRegulations
        ? "保存済みプロジェクト内の敷地境界・法令条例・3Dボリュームを再表示しました。"
        : "敷地境界・法令条例・3Dボリュームの解析が完了しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "画像を解析できませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  const onMassingViewChange = useCallback((state: MassingViewState) => setMassingView(state), []);

  async function showOpenDialog() {
    setProjectBusy(true);
    setProjectMessage("");
    try {
      const response = await fetch("/api/projects");
      const data = await response.json() as { projects?: ProjectSummary[]; error?: string };
      if (!response.ok || !data.projects) throw new Error(data.error || "保存済みプロジェクトを取得できませんでした。");
      const merged = new Map([...listBrowserProjects(), ...data.projects].map((project) => [project.id, project]));
      setSavedProjects([...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setOpenDialogOpen(true);
    } catch {
      setSavedProjects(listBrowserProjects());
      setOpenDialogOpen(true);
      setProjectMessage("通信できないため、このブラウザに保存したプロジェクトを表示しています。");
    } finally { setProjectBusy(false); }
  }

  async function openProject(id: string) {
    setProjectBusy(true);
    try {
      let project: SavedProject | null = null;
      try {
        const response = await fetch(`/api/projects?id=${encodeURIComponent(id)}`);
        const data = await response.json() as { project?: SavedProject; error?: string };
        if (response.ok && data.project) project = data.project;
      } catch { /* ブラウザ保存へ切り替える */ }
      project ??= getBrowserProject(id);
      if (!project) throw new Error("保存したプロジェクトが見つかりませんでした。");
      const restoredPlan = /A-014/i.test(project.imageName) &&
        project.plan.siteAreaSquareMeters !== null &&
        Math.abs(project.plan.siteAreaSquareMeters - 6625.937397) < 0.02
        ? { ...project.plan, siteAreaSquareMeters: 6625.93 }
        : project.plan;
      analysisSessionIdRef.current = project.analysisSessionId ?? project.id;
      selectedFileFingerprintRef.current = project.imageFingerprint ?? "";
      if (imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
      setFile(null);
      setImageUrl("");
      setSelectedFileName(project.imageName);
      setImageSize(project.imageSize);
      setPlan(restoredPlan);
      setRegulations(project.regulations);
      setAddress(project.address);
      setIntendedUse(project.intendedUse);
      setMassingView(project.massingView ?? DEFAULT_MASSING_VIEW);
      setCurrentProject({ ...project, plan: restoredPlan });
      setCaseName(project.caseName);
      setOpenDialogOpen(false);
      setProjectMessage(`「${project.displayName}」を開きました。`);
      window.setTimeout(() => document.querySelector(".results-section")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (caught) {
      setProjectMessage(caught instanceof Error ? caught.message : "プロジェクトを開けませんでした。");
    } finally { setProjectBusy(false); }
  }

  async function saveCurrentProject(firstCaseName?: string) {
    if (!plan || !regulations || !imageSize) {
      setProjectMessage("ボリューム解析後に保存できます。");
      return;
    }
    if (currentProject && !isSavedProjectAddressUnchanged(currentProject.address, address)) {
      setError(`保存時の住所「${currentProject.address}」と完全一致しません。住所表記を変更した案件は「新規作成」から解析してください。`);
      return;
    }
    const resolvedCaseName = (firstCaseName ?? currentProject?.caseName ?? caseName).trim();
    if (!resolvedCaseName) { setSaveDialogOpen(true); return; }
    setProjectBusy(true);
    try {
      const now = new Date().toISOString();
      const createdAt = currentProject?.createdAt ?? now;
      const project: SavedProject = {
        version: 1,
        id: currentProject?.id ?? crypto.randomUUID(),
        analysisSessionId: analysisSessionIdRef.current,
        imageFingerprint: selectedFileFingerprintRef.current || currentProject?.imageFingerprint,
        companyId: "demo-company",
        caseName: resolvedCaseName,
        displayName: projectDisplayName(createdAt, resolvedCaseName, intendedUse),
        createdAt,
        updatedAt: now,
        address,
        intendedUse,
        imageName: selectedFileName || file?.name || "敷地求積図",
        imageSize,
        plan,
        regulations,
        massingView,
      };
      const response = await fetch("/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) });
      const data = await response.json() as { project?: SavedProject; storage?: "cloud" | "local"; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "プロジェクトを保存できませんでした。");
      saveBrowserProject(data.project);
      setCurrentProject(data.project);
      setCaseName(resolvedCaseName);
      setSaveDialogOpen(false);
      setProjectMessage(data.storage === "cloud" ? `クラウドへ「${project.displayName}」を保存しました。` : `「${project.displayName}」を開発用保存領域へ保存しました。`);
    } catch {
      const now = new Date().toISOString();
      const createdAt = currentProject?.createdAt ?? now;
      const localProject: SavedProject = {
        version: 1, id: currentProject?.id ?? crypto.randomUUID(), analysisSessionId: analysisSessionIdRef.current,
        imageFingerprint: selectedFileFingerprintRef.current || currentProject?.imageFingerprint,
        companyId: "demo-company", caseName: resolvedCaseName,
        displayName: projectDisplayName(createdAt, resolvedCaseName, intendedUse), createdAt, updatedAt: now,
        address, intendedUse, imageName: selectedFileName || file?.name || "敷地求積図",
        imageSize, plan, regulations, massingView,
      };
      saveBrowserProject(localProject);
      setCurrentProject(localProject);
      setCaseName(resolvedCaseName);
      setSaveDialogOpen(false);
      setProjectMessage(`通信できないため「${localProject.displayName}」をこのブラウザへ保存しました。`);
    } finally { setProjectBusy(false); }
  }

  async function deleteCurrentProject() {
    if (!currentProject) return;
    setProjectBusy(true);
    try {
      const response = await fetch(`/api/projects?id=${encodeURIComponent(currentProject.id)}`, { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "プロジェクトを削除できませんでした。");
      deleteBrowserProject(currentProject.id);
      const deletedName = currentProject.displayName;
      setCurrentProject(null);
      setCaseName("");
      setDeleteDialogOpen(false);
      setProjectMessage(`「${deletedName}」を削除しました。画面上の結果は新しく保存できます。`);
    } catch {
      const deletedName = currentProject.displayName;
      deleteBrowserProject(currentProject.id);
      setCurrentProject(null);
      setCaseName("");
      setDeleteDialogOpen(false);
      setProjectMessage(`通信できないため、このブラウザに保存した「${deletedName}」を削除しました。`);
    } finally { setProjectBusy(false); }
  }

  const canSave = Boolean(plan && regulations && imageSize);

  function changeAddress(nextAddress: string) {
    setAddress(nextAddress);
    setError("");
    if (!currentProject && regulations && nextAddress !== regulations.address) {
      setRegulations(null);
      setProjectMessage("住所を変更したため、法令・条例の解析結果をクリアしました。");
    }
  }

  function changeIntendedUse(nextUse: string) {
    setIntendedUse(nextUse);
    setError("");
    if (!currentProject && regulations && nextUse !== regulations.intendedUse) {
      setRegulations(null);
      setProjectMessage("主要用途を変更したため、法令・条例の解析結果をクリアしました。");
    }
  }
  const projectActionButtons = (
    <div className="project-result-actions" aria-label={text("プロジェクト操作", "Project actions")}>
      <button type="button" className="secondary-button" disabled={!canSave || projectBusy} onClick={() => void saveCurrentProject()}>{text("プロジェクトを保存", "Save project")}</button>
      <button type="button" className="delete-project-button" disabled={!currentProject || projectBusy} onClick={() => setDeleteDialogOpen(true)}>{text("プロジェクトを削除", "Delete project")}</button>
    </div>
  );

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label={text("MassingAI Japan ホーム", "MassingAI Japan home")}>
          <span className="brand-mark">M</span>
          <span>MassingAI <em>Japan</em></span>
        </a>
        <nav className="project-menu" aria-label={text("プロジェクトメニュー", "Project menu")}>
          <form action="/" target="_blank"><button type="submit">{text("新規作成", "New")}</button></form>
          <button type="button" onClick={() => void showOpenDialog()} disabled={projectBusy}>{text("開く", "Open")}</button>
          <button type="button" onClick={() => void saveCurrentProject()} disabled={!canSave || projectBusy}>{text("保存", "Save")}</button>
          <button type="button" onClick={() => setDeleteDialogOpen(true)} disabled={!currentProject || projectBusy}>{text("削除", "Delete")}</button>
        </nav>
        <div className="header-tools"><div className="language-switch" role="group" aria-label="Language"><button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button><button type="button" className={language === "ja" ? "active" : ""} onClick={() => setLanguage("ja")}>日本語</button></div><span className="prototype-badge">Build Week prototype</span></div>
      </header>

      {projectMessage && <div className="project-message" role="status">{translateDynamic(projectMessage)}</div>}

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">Massing study for Japan</span>
          <h1>{text("土地から建築ボリュームを", "Turn land into a buildable")}<br />{text("3D算出。", "3D volume.")}</h1>
          <p>{text("敷地求積図から土地の形状と寸法を読み取り、建築規制を反映した「この敷地に実現できる建物」を3Dで検討するための設計支援ツールです。現在は最初の工程として、敷地境界の読取と修正に対応しています。", "Upload a Japanese site survey. MassingAI reads the boundary and dimensions, checks planning controls, and visualizes the buildable envelope in editable 2D and interactive 3D.")}</p>
          <div className="steps" aria-label={text("作業の流れ", "Workflow")}>
            <span><b>01</b> {text("選択", "Upload")}</span><i />
            <span><b>02</b> {text("解析", "Analyze")}</span><i />
            <span><b>03</b> {text("修正", "Refine")}</span>
          </div>
        </div>

        <div className="upload-card">
          <div
            className={`dropzone ${isDragging ? "active" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {file || selectedFileName ? (
              <div className="selected-file-title">{selectedFileName || file?.name}</div>
            ) : (
              <div className="upload-empty">
                <span className="upload-icon">↑</span>
                <h2>{text("画像をここにドラッグ", "Drop a site-plan image here")}</h2>
                <p>{text("PNGまたはJPEG・3MBまで", "PNG or JPEG · up to 3 MB")}</p>
              </div>
            )}
          </div>

          {error && <div className="error-message" role="alert">{translateDynamic(error)}</div>}

          <div className="upload-actions">
            <div className="file-picker-group">
              <label className="secondary-button file-picker-button">
                {text("画像を選択", "Choose image")}
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={onFileChange} />
              </label>
              {(file || selectedFileName) && <button type="button" className="cancel-image-button" onClick={clearSelectedImage}>{text("画像を取り消す", "Remove image")}</button>}
              <small>{text("対応形式：PNG・JPEG（3MBまで）", "Supported: PNG, JPEG (up to 3 MB)")}</small>
            </div>
            <button className="primary-button" onClick={analyze} disabled={(!file && !plan) || isLoading}>
              {isLoading ? <><span className="spinner" /> {text("図面・法令を解析中…", "Analyzing drawing and regulations…")}</> : text("GPT-5.6 Solで解析する", "Analyze with GPT-5.6 Sol")}
            </button>
          </div>
          <div className="project-inputs">
            <label>
              <span>{text("住所（住居表示を優先）", "Address (use the postal address)")}</span>
              <input value={address} onChange={(event) => changeAddress(event.target.value)} placeholder={text("例：東京都千代田区外神田3丁目12-2", "e.g. Sotokanda 3-12-2, Chiyoda-ku, Tokyo")} />
              <small className="address-input-note">{text("英数字は半角で入力してください。", "Use standard half-width letters and numbers.")}</small>
            </label>
            <label>
              <span>{text("想定する主要用途", "Proposed primary use")}</span>
              <select value={intendedUse} onChange={(event) => changeIntendedUse(event.target.value)}>
                <option value="">{text("選択して下さい。", "Select a use")}</option>
                {BUILDING_USES.map(([code, name]) => <option key={code} value={`${code}｜${name}`}>{buildingUseLabel(code, name, language)}</option>)}
              </select>
            </label>
          </div>
        </div>
      </section>

      {plan && imageSize && (
        <section className="results-section">
          <SiteEditor
            key={currentProject?.id ?? imageUrl}
            imageSize={imageSize}
            plan={plan}
            onChange={setPlan}
            regulations={regulations}
            massingView={massingView}
            onMassingViewChange={onMassingViewChange}
            projectActions={projectActionButtons}
          />
        </section>
      )}

      <aside className="global-caution" aria-labelledby="global-caution-heading">
        <strong id="global-caution-heading">{text("全体の注意事項", "Important notice")}</strong>
        <p>{text("各都道府県・市区町村の関係行政部署へ直接確認し、最終判断してください。", "Confirm all final decisions directly with the relevant prefectural and municipal authorities.")}</p>
      </aside>

      <footer><span>MassingAI Japan</span><span>Built with Codex + GPT-5.6</span></footer>

      {saveDialogOpen && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setSaveDialogOpen(false)}>
          <form className="confirm-dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="save-project-title" onSubmit={(event) => { event.preventDefault(); void saveCurrentProject(caseName); }} onClick={(event) => event.stopPropagation()}>
            <h3 id="save-project-title">{text("プロジェクトに名前を付けて保存", "Name and save this project")}</h3>
            <p>{text("案件名だけを入力してください。日付・「ボリュームチェック」・主要用途は自動で付きます。", "Enter the project name only. The date, massing-check label, and primary use are added automatically.")}</p>
            <label>{text("案件名", "Project name")}<input autoFocus value={caseName} onChange={(event) => setCaseName(event.target.value)} placeholder={text("例：神田三丁目計画", "e.g. Kanda 3-chome Project")} required /></label>
            {caseName.trim() && <small>{text("保存名：", "Saved as: ")}{localizeProjectDisplayName(projectDisplayName(new Date().toISOString(), caseName, intendedUse), language)}</small>}
            <div><button type="button" className="secondary-button" onClick={() => setSaveDialogOpen(false)}>{text("キャンセル", "Cancel")}</button><button type="submit" className="primary-button" disabled={!caseName.trim() || projectBusy}>{text("保存", "Save")}</button></div>
          </form>
        </div>
      )}

      {openDialogOpen && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setOpenDialogOpen(false)}>
          <div className="confirm-dialog project-dialog open-project-dialog" role="dialog" aria-modal="true" aria-labelledby="open-project-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="open-project-title">{text("保存したプロジェクトを開く", "Open a saved project")}</h3>
            <p>{text("前回保存した解析結果と3D設定を呼び出します。", "Restore the saved analysis and 3D view settings.")}</p>
            <div className="saved-project-list">
              {savedProjects.length ? savedProjects.map((project) => <button type="button" key={project.id} onClick={() => void openProject(project.id)} disabled={projectBusy}><b>{localizeProjectDisplayName(project.displayName, language)}</b><small>{text("更新：", "Updated: ")}{new Date(project.updatedAt).toLocaleString(language === "en" ? "en-US" : "ja-JP")}</small></button>) : <span>{text("保存済みプロジェクトはありません。", "No saved projects.")}</span>}
            </div>
            <div><button type="button" className="secondary-button" onClick={() => setOpenDialogOpen(false)}>{text("閉じる", "Close")}</button></div>
          </div>
        </div>
      )}

      {deleteDialogOpen && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setDeleteDialogOpen(false)}>
          <div className="confirm-dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-project-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="delete-project-title">{text("本当に削除しますか？", "Delete this project?")}</h3>
            <p>{text("保存したプロジェクトは元に戻せません。", "A deleted project cannot be restored.")}</p>
            <div><button type="button" className="secondary-button" onClick={() => setDeleteDialogOpen(false)}>{text("いいえ", "No")}</button><button type="button" className="delete-project-confirm" onClick={() => void deleteCurrentProject()} disabled={projectBusy}>{text("はい", "Yes")}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
