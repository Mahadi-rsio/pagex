import { NextResponse } from "next/server";
import { withApiAuth, readJsonBody } from "@/server/api/http/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApiAuth(async (request, auth) => {
    const body = await readJsonBody<unknown>(request);
    if (!body.ok) return body.response;

    const { createPageSchema } = await import(
        "@/features/projects/page.validator"
    );
    const validation = createPageSchema.safeParse(body.value);
    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.format() },
            { status: 400 },
        );
    }

    const { createPage } = await import("@/features/projects/page.service");
    try {
        return NextResponse.json(
            await createPage(
                { project_name: validation.data.project_name },
                { tenant_id: auth.id, tenant_name: auth.name },
            ),
        );
    } catch (error) {
        console.error(error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 },
        );
    }
});
