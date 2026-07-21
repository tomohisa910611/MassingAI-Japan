import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/demo-data", async () => import("./demo-data"));
vi.mock("@vercel/blob", () => ({
  del: vi.fn(), get: vi.fn(), list: vi.fn(), put: vi.fn(),
}));

describe("project storage demo read-through", () => {
  let originalCwd: string;
  let emptyRoot: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    emptyRoot = await mkdtemp(path.join(os.tmpdir(), "massingai-empty-store-"));
    process.chdir(emptyRoot);
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    vi.resetModules();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(emptyRoot, { recursive: true, force: true });
  });

  it("lists and opens both demos without .project-data", async () => {
    const storage = await import("./project-storage");
    const result = await storage.listProjects();
    expect(result.projects).toHaveLength(2);
    expect(result.projects.every((project) => project.isDemo)).toBe(true);
    const project = await storage.getProject(result.projects[0].id);
    expect(project?.isDemo).toBe(true);
  });

  it("rejects deletion before touching the filesystem", async () => {
    const storage = await import("./project-storage");
    const [project] = (await storage.listProjects()).projects;
    await expect(storage.deleteProject(project.id)).rejects.toThrow(/cannot be deleted/i);
  });
});
