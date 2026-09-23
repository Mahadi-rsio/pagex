/**
 * Format a byte count into a short human-readable string.
 * Used when the API does not provide a *Human field.
 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) {
        const kb = bytes / 1024;
        return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        const mb = bytes / (1024 * 1024);
        return `${mb < 10 ? mb.toFixed(1) : mb.toFixed(1)} MB`;
    }
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
}
