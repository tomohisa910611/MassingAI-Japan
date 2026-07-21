import "server-only";

import { del, get, list, put } from "@vercel/blob";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectSummary, SavedProject } from "@/lib/projects";
import { getDemoProject, isDemoProjectId, mergeProjectSummariesWithDemoSeeds } from "@/lib/demo-data";

const COMPANY_ID = "demo-company";
const BLOB_PREFIX = `projects/${COMPANY_ID}/`;
const LOCAL_DIRECTORY = path.join(process.cwd(), ".project-data", COMPANY_ID);

function hasCloudStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN);
}

function projectPathname(id: string) {
  return `${BLOB_PREFIX}${encodeURIComponent(id)}.json`;
}

function localPath(id: string) {
  return path.join(LOCAL_DIRECTORY, `${encodeURIComponent(id)}.json`);
}

function summary(project: SavedProject): ProjectSummary {
  return { id: project.id, caseName: project.caseName, displayName: project.displayName, createdAt: project.createdAt, updatedAt: project.updatedAt, intendedUse: project.intendedUse, isDemo: project.isDemo };
}

async function readBlobProject(pathname: string): Promise<SavedProject | null> {
  const result = await get(pathname, { access: "private" });
  if (!result?.stream) return null;
  return JSON.parse(await new Response(result.stream).text()) as SavedProject;
}

export async function listProjects(): Promise<{ projects: ProjectSummary[]; storage: "cloud" | "local" }> {
  if (hasCloudStorage()) {
    try {
      const result = await list({ prefix: BLOB_PREFIX, limit: 100 });
      const projects = (await Promise.all(result.blobs.map((blob) => readBlobProject(blob.pathname))))
        .filter((project): project is SavedProject => project !== null).map(summary);
      return { projects: mergeProjectSummariesWithDemoSeeds(projects), storage: "cloud" };
    } catch (error) {
      console.warn("Cloud project storage is unavailable; returning bundled demos", error);
      return { projects: mergeProjectSummariesWithDemoSeeds([]), storage: "cloud" };
    }
  }
  try {
    const files = (await readdir(LOCAL_DIRECTORY)).filter((name) => name.endsWith(".json"));
    const projects = (await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(LOCAL_DIRECTORY, name), "utf8")) as SavedProject))).map(summary);
    return { projects: mergeProjectSummariesWithDemoSeeds(projects), storage: "local" };
  } catch (error) {
    if (!["ENOENT", "EROFS", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    return { projects: mergeProjectSummariesWithDemoSeeds([]), storage: "local" };
  }
}

export async function getProject(id: string): Promise<SavedProject | null> {
  const demo = getDemoProject(id);
  if (demo) return demo;
  if (hasCloudStorage()) return readBlobProject(projectPathname(id));
  try { return JSON.parse(await readFile(localPath(id), "utf8")) as SavedProject; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function saveProject(project: SavedProject): Promise<"cloud" | "local"> {
  const serialized = JSON.stringify(project);
  if (hasCloudStorage()) {
    await put(projectPathname(project.id), serialized, { access: "private", allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
    return "cloud";
  }
  await mkdir(LOCAL_DIRECTORY, { recursive: true });
  await writeFile(localPath(project.id), serialized, "utf8");
  return "local";
}

export async function deleteProject(id: string): Promise<"cloud" | "local"> {
  if (isDemoProjectId(id)) throw new Error("Bundled demo projects cannot be deleted");
  if (hasCloudStorage()) { await del(projectPathname(id)); return "cloud"; }
  await rm(localPath(id), { force: true });
  return "local";
}
