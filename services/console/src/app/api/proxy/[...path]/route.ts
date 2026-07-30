import { NextRequest, NextResponse } from "next/server";

const EXPRESS_URL = process.env.EXPRESS_URL;

async function handler(request: NextRequest) {
  if (!EXPRESS_URL) {
    return NextResponse.json(
      { error: "EXPRESS_URL not configured" },
      { status: 500 }
    );
  }

  const path = request.nextUrl.pathname.replace("/api/proxy", "");
  const targetUrl = `${EXPRESS_URL}${path}${request.nextUrl.search}`;

  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    const skip = ["host", "connection", "transfer-encoding"];
    if (!skip.includes(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      ...(!["GET", "HEAD"].includes(request.method) && {
        body: await request.arrayBuffer(),
      }),
    });

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    }

    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    console.error("[Proxy Error]", err);
    return NextResponse.json(
      { error: "Express server unreachable" },
      { status: 502 }
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
