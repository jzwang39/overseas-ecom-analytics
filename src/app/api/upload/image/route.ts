import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getSession } from "@/lib/auth/server";
import { ensureInitialSuperAdmin } from "@/lib/db/seed";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

function safeExtFromMime(mime: string) {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return "";
}

export async function POST(req: NextRequest) {
  await ensureInitialSuperAdmin();
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "参数错误" }, { status: 400 });
  const file = form.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "缺少文件" }, { status: 400 });

  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "仅支持图片" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "图片大小不能超过10M" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const dir = path.join(process.cwd(), "public", "uploads", `${y}${m}`);
  await fs.mkdir(dir, { recursive: true });

  const ext = safeExtFromMime(file.type);
  const filename = `${crypto.randomUUID()}${ext}`;
  const abs = path.join(dir, filename);
  await fs.writeFile(abs, buf);

  const url = `/uploads/${y}${m}/${filename}`;
  return NextResponse.json({ url });
}
