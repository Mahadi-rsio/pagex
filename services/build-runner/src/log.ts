/**
 * Log redaction + chunking for the runner. The console redacts again on append
 * (defence in depth), but a build can echo a token into its own output, so we
 * scrub before it ever leaves the machine.
 */

const REDACTIONS: Array<[RegExp, string]> = [
    [/\bpxb\.[0-9a-fA-F-]+\.[a-f0-9]+/g, "pxb.***.***"],
    [/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, "$1***"],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "***"],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "***"],
    [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "***"],
    [
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        "***REDACTED PRIVATE KEY***",
    ],
    [
        /((?:token|secret|password|passwd|api[_-]?key|access[_-]?key|auth)["'\s:=]+)([^\s"',]+)/gi,
        "$1***",
    ],
];

export function redactSecrets(text: string): string {
    let out = text;
    for (const [re, replacement] of REDACTIONS) out = out.replace(re, replacement);
    return out;
}

/**
 * Split a stream buffer into pieces no larger than `chunkBytes` UTF-8 bytes,
 * preferring newline boundaries and never splitting a code point. A single
 * pathological line (e.g. minified output) is hard-split so it can't exceed the
 * console's per-chunk limit.
 */
export function chunkLog(text: string, chunkBytes: number): string[] {
    if (!text) return [];

    const byteLen = (s: string) => Buffer.byteLength(s, "utf8");
    if (byteLen(text) <= chunkBytes) return [text];

    const chunks: string[] = [];
    let buf = "";
    let bufBytes = 0;
    const flush = () => {
        if (buf) chunks.push(buf);
        buf = "";
        bufBytes = 0;
    };

    for (const line of text.split(/(?<=\n)/)) {
        const lineBytes = byteLen(line);

        if (lineBytes <= chunkBytes) {
            if (bufBytes > 0 && bufBytes + lineBytes > chunkBytes) flush();
            buf += line;
            bufBytes += lineBytes;
            continue;
        }

        // Line alone exceeds the cap: flush, then hard-split by code point.
        flush();
        let cur = "";
        let curBytes = 0;
        for (const ch of line) {
            const cb = byteLen(ch);
            if (curBytes + cb > chunkBytes) {
                chunks.push(cur);
                cur = "";
                curBytes = 0;
            }
            cur += ch;
            curBytes += cb;
        }
        buf = cur;
        bufBytes = curBytes;
    }

    flush();
    return chunks;
}
