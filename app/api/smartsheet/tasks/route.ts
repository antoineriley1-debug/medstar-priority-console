import { NextResponse } from "next/server";

// =============================================================
// PUBLIC SMARTSHEET TASKS ROUTE — for EXEC-OS dashboard
// =============================================================
// Path: app/api/smartsheet/tasks/route.ts
//
// Read-only sheet fetch, no Clerk auth, CORS-open. Gated by the
// EXEC_OS_PUBLIC_TOKEN env var (same token used by /api/tasks/public).
//
// Request:   GET /api/smartsheet/tasks?token=YOUR_TOKEN
//   or pass token as the x-exec-os-token header.
//   Optional: ?sheet=<smartsheet_id> to override the default sheet.
//
// Response:  {
//   sheetName, fetchedAt,
//   tasks: [ { id, rowNumber, status, task, owner, dueDate,
//              priority, notes, raw: {...} }, ... ]
// }
// =============================================================

const DEFAULT_SHEET_ID_FALLBACK = "8870685098069892"; // Priority Tasks from Tom Watson
const SMARTSHEET_API = "https://api.smartsheet.com/2.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-exec-os-token",
  "Access-Control-Max-Age": "86400",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Map Smartsheet column titles into normalized task fields.
// Loose-match — handles "Status", "Task Status", "STATUS:", etc.
function normalizeColumnTitle(title: string): string | null {
  const t = (title || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  if (!t) return null;
  if (/^task$|^name$|^title$|^item$|^description$|^summary$/.test(t)) return "task";
  if (/^tasks$/.test(t)) return "task";
  if (/^status$|^state$/.test(t)) return "status";
  if (/^owner$|^assignedto$|^assigned$|^responsible$|^assignee$/.test(t)) return "owner";
  if (/^duedate$|^due$|^deadline$|^enddate$|^datedue$/.test(t)) return "dueDate";
  if (/^startdate$|^start$/.test(t)) return "startDate";
  if (/^priority$|^prio$|^p$/.test(t)) return "priority";
  if (/^notes$|^comments$|^note$|^remarks$/.test(t)) return "notes";
  if (/^site$|^hospital$|^facility$|^location$/.test(t)) return "site";
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("token") || req.headers.get("x-exec-os-token") || "";
  const expected = process.env.EXEC_OS_PUBLIC_TOKEN;
  const smartsheetToken = process.env.SMARTSHEET_TOKEN;
  const sheetId =
    url.searchParams.get("sheet") ||
    process.env.SMARTSHEET_SHEET_ID ||
    DEFAULT_SHEET_ID_FALLBACK;

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

    // Map column ID -> normalized field name
    const idToField: Record<number, string> = {};
    const idToTitle: Record<number, string> = {};
    for (const col of columns) {
      idToTitle[col.id] = col.title;
      const norm = normalizeColumnTitle(col.title);
      if (norm) idToField[col.id] = norm;
    }

    const tasks = (sheet.rows || []).map((row: any) => {
      const obj: Record<string, any> = {
        id: row.id,
        rowNumber: row.rowNumber,
        status: "",
        task: "",
        owner: "",
        dueDate: "",
        priority: "",
        notes: "",
        site: "",
        raw: {},
      };
      for (const cell of row.cells || []) {
        const title = idToTitle[cell.columnId];
        const value = cell.displayValue ?? cell.value ?? "";
        if (title) obj.raw[title] = value;
        const norm = idToField[cell.columnId];
        if (norm) obj[norm] = value;
      }
      return obj;
    });

    // Sort: incomplete first, high priority first, by due date
    const isDone = (s: string) => /complete|done|closed/i.test(s || "");
    const prio = (s: string) => {
      const v = (s || "").toLowerCase();
      if (/high|urgent|critical|^1$/.test(v)) return 1;
      if (/med|^2$/.test(v)) return 2;
      if (/low|^3$/.test(v)) return 3;
      return 4;
    };
    tasks.sort((a: any, b: any) => {
      const ad = isDone(a.status) ? 1 : 0;
      const bd = isDone(b.status) ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const ap = prio(a.priority), bp = prio(b.priority);
      if (ap !== bp) return ap - bp;
      // Then by due date if both present
      if (a.dueDate && b.dueDate) return String(a.dueDate).localeCompare(String(b.dueDate));
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });

    return NextResponse.json(
      {
        sheetName: sheet.name,
        sheetId: sheet.id,
        rowCount: tasks.length,
        fetchedAt: new Date().toISOString(),
        tasks,
      },
      { headers: { ...CORS, "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal error" },
      { status: 500, headers: CORS }
    );
  }
}
