import { NextResponse } from "next/server";
import { deleteProject, getProject, listProjects, saveProject } from "@/lib/project-storage";
import type { SavedProject } from "@/lib/projects";

export const runtime = "nodejs";

function validId(value: string | null) { return value && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null; }

export async function GET(request: Request) {
  try {
    const id = validId(new URL(request.url).searchParams.get("id"));
    if (!id) return NextResponse.json(await listProjects());
    const project = await getProject(id);
    return project ? NextResponse.json({ project }) : NextResponse.json({ error: "保存したプロジェクトが見つかりません。" }, { status: 404 });
  } catch (error) { console.error("Project read failed", error); return NextResponse.json({ error: "プロジェクトを読み込めませんでした。" }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const project = await request.json() as SavedProject;
    if (!validId(project?.id) || !project.caseName?.trim() || !project.plan || !project.regulations || !project.imageSize) return NextResponse.json({ error: "保存データが不足しています。" }, { status: 400 });
    const storage = await saveProject(project);
    return NextResponse.json({ project, storage });
  } catch (error) { console.error("Project save failed", error); return NextResponse.json({ error: "プロジェクトを保存できませんでした。" }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const id = validId(new URL(request.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "削除対象が不正です。" }, { status: 400 });
    const storage = await deleteProject(id);
    return NextResponse.json({ deleted: true, storage });
  } catch (error) { console.error("Project deletion failed", error); return NextResponse.json({ error: "プロジェクトを削除できませんでした。" }, { status: 500 }); }
}
