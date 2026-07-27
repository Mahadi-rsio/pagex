import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/db";
import { checkRedisConnection } from "@/lib/redis";

export async function GET() {
    try {
        await Promise.all([checkDatabaseConnection(), checkRedisConnection()]);
        return NextResponse.json({ status: "ok" });
    } catch (error) {
        return NextResponse.json(
            {
                status: "error",
                message:
                    error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
        );
    }
}
