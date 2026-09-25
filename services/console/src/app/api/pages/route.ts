import { NextResponse } from "next/server";
import { withApiAuth } from "@/server/api/http/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiAuth(async (_request, auth) => {
    const { getListPages } = await import("@/features/projects/page.service");
    try {
        return NextResponse.json(await getListPages(auth.id));
    } catch (error) {
        console.error(error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 },
        );
    }
});
