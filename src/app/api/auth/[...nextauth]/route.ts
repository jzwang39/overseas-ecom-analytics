import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { NextResponse, type NextRequest } from "next/server";

const handler = NextAuth(authOptions);

export async function GET(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  if (req.nextUrl.pathname === "/api/auth/_log") return new NextResponse(null, { status: 204 });
  return (handler as unknown as (req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) => Promise<Response>)(
    req,
    ctx,
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  if (req.nextUrl.pathname === "/api/auth/_log") return new NextResponse(null, { status: 204 });
  return (handler as unknown as (req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) => Promise<Response>)(
    req,
    ctx,
  );
}
