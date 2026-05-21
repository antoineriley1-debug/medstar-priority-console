import { NextResponse } from "next/server";

// =============================================================
// PUBLIC TASKS ROUTE — for EXEC-OS dashboard
// =============================================================
// Path: app/api/tasks/public/route.ts
//
// Read-only, no Clerk auth, CORS-open. Gated by a shared token
// stored as the EXEC_OS_PUBLIC_TOKEN env var in Vercel.
//
// Request:   GET /api/tasks/public?token=YOUR_TOKEN
//   or pass it as the x-exec-os-token header.
//
// Response:  { tasks: [ { id, ...columns }, ... ] }
// =============================================================

const SHEET_ID_FALLBACK = "8870685098069892"; // Priority Tasks from Tom Watson
const SMARTSHEET_API = "https://api.smartsheet.com/2.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-exec-os-token",
  "Access-Control-Max-Age": "86400",
};

// Tell Next.js this route is dynamic — never cache the response.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("token") || req.headers.get("x-exec-os-token") || "";
  const expected = process.env.EXEC_OS_PUBLIC_TOKEN;
  const smartsheetToken = process.env.SMARTSHEET_TOKEN;
  const sheetId = process.env.SMARTSHEET_SHEET_ID || SHEET_ID_FALLBACK;

  if (!expected) {
    return NextResponse.json(
      { error: "EXEC_OS_PUBLIC_TOKEN not configured on server" },
      { status: 500, headers: CORS }
    );
  }
  if (!smartsheetToken) {
    return NextResponse.json(
      { error: "SMARTSHEET_TOKEN not configured on server" },
      { status: 500, headers: CORS }
    );
  }
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: CORS }
    );
  }

  try {
    const res = await fetch(`${SMARTSHEET_API}/sheets/${sheetId}`, {
      headers: { Authorization: `Bearer ${smartsheetToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `Smartsheet ${res.status}`, detail: body.slice(0, 300) },
        { status: res.status, headers: CORS }
      );
    }

    const sheet = await res.json();
    const columns: Array<{ id: number; title: string }> = sheet.columns || [];
    const colMap: Record<number, string> = Object.fromEntries(
      columns.map((c) => [c.id, c.title])
    );

    const tasks = (sheet.rows || []).map((row: any) => {
      const obj: Record<string, any> = { id: row.id };
      for (const cell of row.cells || []) {
        const title = colMap[cell.columnId];
        if (title) {
          obj[title] = cell.displayValue ?? cell.value ?? "";
        }
      }
      return obj;
    });

    return NextResponse.json(
      { tasks, sheetName: sheet.name, fetchedAt: new Date().toISOString() },
      { headers: { ...CORS, "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal error" },
      { status: 500, headers: CORS }
    );
  }
}
