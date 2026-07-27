import { z } from "zod/v4";

export default function handleApiError(error: unknown) {
    if (error instanceof z.ZodError) {
        const firstError = error.issues[0];
        return new Response(
            JSON.stringify({
                success: false,
                error: firstError.message,
                field: firstError.path.join("."),
            }),
            {
                status: 400,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    // Handle JSON parsing errors
    if (error instanceof SyntaxError) {
        return new Response(
            JSON.stringify({
                success: false,
                error: "Invalid JSON format",
            }),
            {
                status: 400,
                headers: { "Content-Type": "application/json" },
            },
        );
    }

    // Handle AI/service errors
    const message =
        error instanceof Error ? error.message : "Internal server error";
    return new Response(
        JSON.stringify({
            success: false,
            error: message,
        }),
        {
            status: 500,
            headers: { "Content-Type": "application/json" },
        },
    );
}
