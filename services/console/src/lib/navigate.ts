/**
 * Hard-navigate helpers for static-export + Caddy.
 * Dynamic (and some nested) routes need a full page load so Caddy can serve
 * the prerendered shell; client-side Next routing would 404 missing HTML.
 */

const PROJECT_ID_RE = /^\/projects\/([^/]+)/;

/** SSG placeholder from generateStaticParams — never a real project id. */
const SSG_PLACEHOLDER = "_";

/** Fired so TopLoader can show a full-page spinner during navigation. */
export const PAGE_LOADING_EVENT = "cloudisy:page-loading";

export function startPageLoading() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(PAGE_LOADING_EVENT));
}

/**
 * Read the real project id from the browser URL.
 * Caddy rewrites `/projects/:id/...` to the `_` shell HTML, so Next.js
 * `useParams().projectId` is often `"_"` after a full page load.
 */
export function getProjectIdFromPathname(
    pathname: string = typeof window !== "undefined"
        ? window.location.pathname
        : "",
): string {
    const match = pathname.match(PROJECT_ID_RE);
    const id = match?.[1] ?? "";
    return id && id !== SSG_PLACEHOLDER ? id : "";
}

export function navigateToProjectOverview(projectId: string) {
    startPageLoading();
    window.location.assign(`/projects/${projectId}/overview/`);
}

export function navigateToDeviceApprove(userCode: string) {
    startPageLoading();
    const code = encodeURIComponent(userCode.replace(/-/g, "").toUpperCase());
    window.location.assign(`/device/approve/?user_code=${code}`);
}

export function navigateHome() {
    startPageLoading();
    window.location.assign("/");
}
