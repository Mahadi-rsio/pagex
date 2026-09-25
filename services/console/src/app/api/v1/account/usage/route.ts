import { NextResponse } from "next/server";
import { withApiAuth } from "@/server/api/http/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiAuth(async (_request, auth) => {
    const { getAccountUsage } = await import(
        "@/features/usage/usage.service"
    );
    try {
        const result = await getAccountUsage(auth.id);
        return NextResponse.json(result);
    } catch (error) {
        console.error("Account usage request failed:", error);
        return NextResponse.json(
            { error: "Failed to fetch usage" },
            { status: 500 },
        );
    }
});
