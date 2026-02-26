import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function getUploadBaseDir() {
  const env = process.env.UPLOAD_DIR;
  if (env && env.trim()) return env.trim();
  return path.join(process.cwd(), "public", "uploads");
}

function resolveSafePath(baseDir: string, parts: string[]) {
  const safeParts = parts.filter(Boolean);
  if (safeParts.length === 0) return null;
  if (safeParts.some((p) => p === "." || p === ".." || p.includes("/") || p.includes("\\"))) return null;

  const baseAbs = path.resolve(baseDir);
  const abs = path.resolve(baseAbs, ...safeParts);
  if (abs !== baseAbs && !abs.startsWith(`${baseAbs}${path.sep}`)) return null;
  return abs;
}

function contentTypeFromExt(ext: string) {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const baseDir = getUploadBaseDir();
  const abs = resolveSafePath(baseDir, parts);
  if (!abs) return new NextResponse("Not Found", { status: 404 });

  try {
    const buf = await fs.readFile(abs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFromExt(path.extname(abs)),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}

export async function HEAD(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const baseDir = getUploadBaseDir();
  const abs = resolveSafePath(baseDir, parts);
  if (!abs) return new NextResponse(null, { status: 404 });

  try {
    const st = await fs.stat(abs);
    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFromExt(path.extname(abs)),
        "Content-Length": String(st.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
