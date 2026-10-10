/**
 * Minimal ANSI SGR parser for build-log rendering.
 *
 * Handles the escape sequences most build tools emit (colors, bold, dim,
 * italic, underline) and ignores cursor/erase sequences. Unknown/incomplete
 * sequences are passed through as literal text so logs are never corrupted.
 */

export interface AnsiSegment {
    text: string;
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
}

/** xterm 16-color palette tuned for dark terminals. */
const ANSI_COLORS = [
    "#7f8489", // 0 black
    "#f97066", // 1 red
    "#3ddc84", // 2 green
    "#f5c542", // 3 yellow
    "#5e9cff", // 4 blue
    "#c792ea", // 5 magenta
    "#4fd6be", // 6 cyan
    "#e4e4e7", // 7 white
    "#9ca3af", // 8 bright black
    "#ff8378", // 9 bright red
    "#6ee7a0", // 10 bright green
    "#f8d66d", // 11 bright yellow
    "#7eb3ff", // 12 bright blue
    "#d8b4fe", // 13 bright magenta
    "#6ee7dd", // 14 bright cyan
    "#ffffff", // 15 bright white
];

/** Truecolor RGB levels for the 216-color cube. */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function cubeColor(n: number): string {
    const r = CUBE_LEVELS[Math.floor(n / 36) % 6] ?? 0;
    const g = CUBE_LEVELS[Math.floor(n / 6) % 6] ?? 0;
    const b = CUBE_LEVELS[n % 6] ?? 0;
    return `rgb(${r},${g},${b})`;
}

/** Map a 256-color index to an rgb() string. */
export function ansi256ToRgb(index: number): string {
    if (index < 16) return ANSI_COLORS[index] ?? "#e4e4e7";
    if (index >= 232) {
        const v = 8 + (index - 232) * 10;
        return `rgb(${v},${v},${v})`;
    }
    return cubeColor(index - 16);
}

/**
 * Parse a string containing ANSI SGR escape sequences into styled segments.
 * Non-SGR CSI sequences (cursor moves, erase) are dropped.
 */
export function parseAnsi(text: string): AnsiSegment[] {
    if (!text.includes("\x1b")) return [{ text }];

    const segments: AnsiSegment[] = [];
    let current: AnsiSegment = { text: "" };

    const flush = () => {
        if (current.text) segments.push(current);
        current = { ...current, text: "" };
    };

    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "\x1b") {
            // CSI sequences: ESC [ params final
            if (text[i + 1] === "[") {
                const match = /^\[([0-9;?]*)([A-Za-z])/.exec(text.slice(i + 1));
                if (match) {
                    const [, params, final] = match;
                    if (final === "m") {
                        flush();
                        applySgr(current, params);
                    }
                    // else: cursor/erase/etc — drop the whole sequence
                    i += 2 + match[0].length;
                    continue;
                }
            }
            // Unrecognized escape: keep the ESC literally so nothing is lost.
            current.text += ch;
            i++;
            continue;
        }
        current.text += ch;
        i++;
    }
    flush();
    return segments;
}

function applySgr(segment: AnsiSegment, params: string): void {
    if (params === "" || params === "0") {
        segment.fg = undefined;
        segment.bg = undefined;
        segment.bold = undefined;
        segment.dim = undefined;
        segment.italic = undefined;
        segment.underline = undefined;
        return;
    }

    const codes = params.split(";").map(Number);
    for (let n = 0; n < codes.length; n++) {
        const code = codes[n];
        if (code === undefined) continue;
        switch (code) {
            case 0:
                segment.fg = undefined;
                segment.bg = undefined;
                segment.bold = undefined;
                segment.dim = undefined;
                segment.italic = undefined;
                segment.underline = undefined;
                break;
            case 1:
                segment.bold = true;
                break;
            case 2:
                segment.dim = true;
                break;
            case 3:
                segment.italic = true;
                break;
            case 4:
                segment.underline = true;
                break;
            case 22:
                segment.bold = undefined;
                segment.dim = undefined;
                break;
            case 23:
                segment.italic = undefined;
                break;
            case 24:
                segment.underline = undefined;
                break;
            case 39:
                segment.fg = undefined;
                break;
            case 49:
                segment.bg = undefined;
                break;
            case 38:
            case 48: {
                // Extended color: 38;5;n / 38;2;r;g;b
                const mode = codes[n + 1];
                if (mode === 5) {
                    const color = ansi256ToRgb(codes[n + 2] ?? 0);
                    if (code === 38) segment.fg = color;
                    else segment.bg = color;
                    n += 2;
                } else if (mode === 2) {
                    const r = codes[n + 2] ?? 0;
                    const g = codes[n + 3] ?? 0;
                    const b = codes[n + 4] ?? 0;
                    const color = `rgb(${r},${g},${b})`;
                    if (code === 38) segment.fg = color;
                    else segment.bg = color;
                    n += 4;
                }
                break;
            }
            default:
                if (code >= 30 && code <= 37)
                    segment.fg = ANSI_COLORS[code - 30];
                else if (code >= 40 && code <= 47)
                    segment.bg = ANSI_COLORS[code - 40];
                else if (code >= 90 && code <= 97)
                    segment.fg = ANSI_COLORS[code - 90 + 8];
                else if (code >= 100 && code <= 107)
                    segment.bg = ANSI_COLORS[code - 100 + 8];
                break;
        }
    }
}
