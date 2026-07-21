import type { ProjectSummary, SavedProject } from "./projects";

const STORAGE_KEY = "massingai-japan-projects-v1";

function readAll(): SavedProject[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is SavedProject =>
      Boolean(item && typeof item === "object" && "id" in item && "plan" in item && "regulations" in item)) : [];
  } catch { return []; }
}

function writeAll(projects: SavedProject[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function listBrowserProjects(): ProjectSummary[] {
  return readAll().map(({ id, caseName, displayName, createdAt, updatedAt, intendedUse }) =>
    ({ id, caseName, displayName, createdAt, updatedAt, intendedUse }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getBrowserProject(id: string) {
  return readAll().find((project) => project.id === id) ?? null;
}

export function saveBrowserProject(project: SavedProject) {
  const projects = readAll().filter((item) => item.id !== project.id);
  writeAll([project, ...projects]);
}

export function deleteBrowserProject(id: string) {
  writeAll(readAll().filter((project) => project.id !== id));
}
