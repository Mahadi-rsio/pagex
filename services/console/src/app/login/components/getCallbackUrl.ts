export function getCallbackUrl() {
    if (typeof window !== "undefined") {
        const hostname = window.location.hostname;
        if (hostname === "localhost" || hostname === "127.0.0.1") {
            return window.location.origin;
        }
    }
    return (
        process.env.PUBLIC_URL ||
        (typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost:3000")
    );
}
