import "@/lib/handlers";
import { dispatch } from "@/lib/router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return dispatch(req, "/" + path.join("/"));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
