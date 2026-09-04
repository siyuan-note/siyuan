import {getInlineFontFamilyName, getInlineFontFamilyStyle} from "../../toolbar/fontFamilyCore";

export const AV_RICH_TEXT_SPEC = 1 as const;
export const AV_RICH_TEXT_FORMAT = "kramdown" as const;
export const AV_RICH_TEXT_PREVIEW_ALLOWED_TAGS = [
    "a", "blockquote", "br", "code", "div", "em", "input", "kbd", "li", "mark", "ol", "p", "pre",
    "s", "span", "strong", "sub", "sup", "u", "ul",
];
export const AV_RICH_TEXT_PREVIEW_ALLOWED_ATTRIBUTES = [
    "checked", "class", "data-content", "data-href", "data-id", "data-language", "data-subtype", "data-type",
    "disabled", "href", "style", "title", "type",
];
export const AV_RICH_TEXT_PREVIEW_TEXT_ONLY_TAGS = ["sup"];
export const AV_RICH_TEXT_EDITOR_ALLOWED_TAGS = ["br", "div", "span", "svg", "use", "wbr"];
export const AV_RICH_TEXT_EDITOR_ALLOWED_ATTRIBUTES = [
    "aria-label", "class", "contenteditable", "data-content", "data-href", "data-id", "data-inline-memo-content",
    "data-marker", "data-node-id", "data-node-index", "data-position", "data-subtype", "data-type", "draggable",
    "spellcheck", "spin", "style", "updated", "xlink:href",
];
export const AV_RICH_TEXT_PREVIEW_SANITIZE_OPTIONS = {
    ALLOWED_TAGS: AV_RICH_TEXT_PREVIEW_ALLOWED_TAGS,
    ALLOWED_ATTR: AV_RICH_TEXT_PREVIEW_ALLOWED_ATTRIBUTES,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|siyuan|tel|web\+siyuan):|[#/?]|\.\.?\/|[^a-z]|[a-z0-9._~-]+(?:[/?#]|$))/i,
};
const BUILTIN_INLINE_COLOR_COUNT = 13;
const MAX_INLINE_FONT_FAMILY_LENGTH = 256;
type AVRichTextStyleProperty = "color" | "background-color";

const HOLLOW_STROKE = "0.2px var(--b3-theme-on-background)";
const HOLLOW_FILL = "transparent";
const TEXT_SHADOW = "1px 1px var(--b3-theme-surface-lighter), " +
    "2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), " +
    "4px 4px var(--b3-theme-surface-lighter)";
const FONT_FAMILY_PATTERN = /^var\(--b3-font-family-emoji-reset\)\s*,\s*(?:'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*")\s*,\s*var\(--b3-font-family-editor\)\s*,\s*var\(--b3-font-family\)$/;

const EXECUTABLE_CODE_LANGUAGES = new Set([
    "abc",
    "echarts",
    "flowchart",
    "graphviz",
    "infographic",
    "mermaid",
    "mindmap",
    "plantuml",
]);

export type AVTextSource = {
    kind: "plain" | "rich";
    content: string;
};

export interface AVRichTextStyleEntityProtection {
    token: string;
    encoded: string;
    decoded: string;
}

const AV_RICH_TEXT_FORMAT_CHARACTER = /\p{Cf}/u;

const isAVRichTextControlOrFormatCharacter = (character: string) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1F || 0x7F <= codePoint && codePoint <= 0x9F ||
        AV_RICH_TEXT_FORMAT_CHARACTER.test(character);
};

const hasUnsafeAVRichTextURLCharacter = (value: string) => Array.from(value).some((character) =>
    character === "\\" || isAVRichTextControlOrFormatCharacter(character));

const hasValidAVRichTextUnicode = (value: string) => {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (0xD800 <= code && code <= 0xDBFF) {
            if (index + 1 >= value.length) {
                return false;
            }
            const next = value.charCodeAt(++index);
            if (next < 0xDC00 || 0xDFFF < next) {
                return false;
            }
        } else if (0xDC00 <= code && code <= 0xDFFF) {
            return false;
        }
    }
    return true;
};

const unescapeAVRichTextHTML = (value: string) => {
    if (typeof Lute !== "undefined") {
        return Lute.UnEscapeHTMLStr(value);
    }
    return value.replace(/&(?:amp|apos|colon|gt|lt|newline|quot|rlm|tab|zerowidthspace|zwj|zwnj|#(?:x[0-9a-f]+|\d+));/gi,
        (entity) => {
        const named: Record<string, string> = {
            "&amp;": "&", "&colon;": ":", "&gt;": ">", "&lt;": "<", "&quot;": '"', "&apos;": "'",
            "&newline;": "\n", "&rlm;": "\u200F", "&tab;": "\t", "&zerowidthspace;": "\u200B",
            "&zwj;": "\u200D", "&zwnj;": "\u200C",
        };
        const normalized = entity.toLowerCase();
        if (named[normalized]) {
            return named[normalized];
        }
        const numeric = normalized.match(/^&#(x[0-9a-f]+|\d+);$/);
        const codePoint = numeric?.[1].startsWith("x") ? Number.parseInt(numeric[1].slice(1), 16) :
            Number.parseInt(numeric?.[1] || "", 10);
        return Number.isInteger(codePoint) && 0 < codePoint && codePoint <= 0x10FFFF ?
            String.fromCodePoint(codePoint) : entity;
        });
};

const decodeAVRichTextHTMLEntities = (value: string) => {
    let decoded = value;
    for (let depth = 0; depth < 8; depth++) {
        const next = unescapeAVRichTextHTML(decoded);
        if (next === decoded) {
            return decoded;
        }
        decoded = next;
    }
    return unescapeAVRichTextHTML(decoded) === decoded ? decoded : undefined;
};

export const sanitizeAVRichTextInlineMemoContent = (value: string) => {
    const hasDisallowedControl = (candidate: string) => Array.from(candidate).some((character) => {
        const codePoint = character.codePointAt(0) || 0;
        return (codePoint <= 0x1F || 0x7F <= codePoint && codePoint <= 0x9F) &&
            codePoint !== 0x09 && codePoint !== 0x0A && codePoint !== 0x0D;
    });
    if (!hasValidAVRichTextUnicode(value) || hasDisallowedControl(value)) {
        return "";
    }

    let decoded = value;
    let stable = false;
    for (let depth = 0; depth < 8; depth++) {
        const next = unescapeAVRichTextHTML(decoded);
        if (!hasValidAVRichTextUnicode(next) || hasDisallowedControl(next)) {
            return "";
        }
        if (next === decoded) {
            stable = true;
            break;
        }
        decoded = next;
    }
    if (!stable) {
        return "";
    }

    for (let start = decoded.indexOf("<"); start >= 0; start = decoded.indexOf("<", start + 1)) {
        let index = start + 1;
        if (decoded[index] === "/") {
            index++;
            if (/[A-Za-z]/.test(decoded[index] || "")) {
                return "";
            }
            continue;
        }
        if (/[A-Za-z!?]/.test(decoded[index] || "")) {
            return "";
        }
    }
    return value;
};

const isCleanAVRichTextAssetPath = (value: string) => {
    const path = value.split(/[?#]/, 1)[0];
    const relativePath = path.startsWith("/") ? path.slice(1) : path;
    if (!relativePath.startsWith("assets/")) {
        return true;
    }
    const segments = path.split("/");
    const cleanSegments: string[] = [];
    segments.forEach((segment) => {
        if (!segment || segment === ".") {
            return;
        }
        if (segment === "..") {
            cleanSegments.pop();
        } else {
            cleanSegments.push(segment);
        }
    });
    const cleanPath = `${path.startsWith("/") ? "/" : ""}${cleanSegments.join("/")}` || ".";
    return cleanPath === path;
};

export const getAVRichTextSafeURL = (value?: string | null) => {
    const original = value || "";
    if (!original) {
        return "";
    }
    if (original.trim() !== original || !hasValidAVRichTextUnicode(original)) {
        return "";
    }
    const url = decodeAVRichTextHTMLEntities(original);
    if (typeof url !== "string" || hasUnsafeAVRichTextURLCharacter(url)) {
        return "";
    }
    let percentDecoded: string;
    try {
        percentDecoded = decodeURIComponent(url);
    } catch {
        return "";
    }
    if (!hasValidAVRichTextUnicode(percentDecoded) || hasUnsafeAVRichTextURLCharacter(percentDecoded)) {
        return "";
    }
    const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
    if (scheme) {
        if (scheme === "mailto" || scheme === "tel") {
            const opaque = url.slice(scheme.length + 1);
            return opaque && !opaque.startsWith("/") ? url : "";
        }
        if (scheme !== "http" && scheme !== "https" && scheme !== "siyuan" && scheme !== "web+siyuan") {
            return "";
        }
        if (!url.toLowerCase().startsWith(`${scheme}://`)) {
            return "";
        }
        const authority = url.slice(scheme.length + 3).split(/[/?#]/, 1)[0];
        if (!authority) {
            return "";
        }
        try {
            const parsed = new URL(url);
            return parsed.host && parsed.protocol === `${scheme}:` ? url : "";
        } catch {
            return "";
        }
    }
    if (url.startsWith("//")) {
        const authority = url.slice(2).split(/[/?#]/, 1)[0];
        if (!authority) {
            return "";
        }
        try {
            if (!new URL(`https:${url}`).host) {
                return "";
            }
        } catch {
            return "";
        }
    } else {
        const firstPathSegment = percentDecoded.replace(/^\/+/, "").split(/[/?#]/, 1)[0];
        if (firstPathSegment.includes(":")) {
            return "";
        }
    }
    return isCleanAVRichTextAssetPath(percentDecoded) ? url : "";
};

export const configureAVRichTextLute = (lute: Lute) => {
    const fixedLute = lute as Lute & {
        SetEmoji: (enabled: boolean) => void;
        SetGitConflict: (enabled: boolean) => void;
    };
    fixedLute.SetEmoji(false);
    fixedLute.SetCustomBlock(true);
    fixedLute.SetGitConflict(true);
    fixedLute.SetInlineAsterisk(true);
    fixedLute.SetInlineUnderscore(true);
    fixedLute.SetGFMStrikethrough1(false);
    fixedLute.SetGFMStrikethrough(true);
    fixedLute.SetSup(true);
    fixedLute.SetSub(true);
    fixedLute.SetTag(true);
    fixedLute.SetInlineMath(true);
    fixedLute.SetMark(true);
    fixedLute.SetFullWidthStrikethrough(true);
    fixedLute.SetExportNormalizeTaskListMarker(false);
    return lute;
};

const escapeAVRichTextRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createAVRichTextStyleSentinel = (source: string) => {
    const used = new Set<string>();
    const sentinelPattern = /\uE000av-rich-text-style-([0-9a-z]+)\uF8FF/g;
    for (let match = sentinelPattern.exec(source); match; match = sentinelPattern.exec(source)) {
        used.add(match[1]);
    }
    let index = 0;
    while (used.has(index.toString(36))) {
        index++;
    }
    return `\uE000av-rich-text-style-${index.toString(36)}\uF8FF`;
};

export const createAVRichTextStyleBackslashEncoding = (source: string) => {
    const sentinel = createAVRichTextStyleSentinel(source);
    const backslashSentinel = `${sentinel}\uE003`;
    const backtickSentinel = `${sentinel}\uE004`;
    return {
        sentinel,
        protectStyle: (style: string) => style.replace(/[\\`]/g,
            (character) => character === "\\" ? backslashSentinel : backtickSentinel),
        encodeMarkdown: (markdown: string) => markdown
            .replaceAll(backslashSentinel, "&#92;")
            .replaceAll(backtickSentinel, "&#96;"),
    };
};

const findAVRichTextQuotedEnd = (content: string, start: number, end: number, terminator: string) => {
    let quote = "";
    let escaped = false;
    for (let index = start; index < end; index++) {
        const character = content[index];
        if (escaped) {
            escaped = false;
        } else if (character === "\\") {
            escaped = true;
        } else if (quote) {
            if (character === quote) {
                quote = "";
            }
        } else if (character === "'" || character === '"') {
            quote = character;
        } else if (character === terminator) {
            return index;
        }
    }
    return -1;
};

const getAVRichTextQuotedAttribute = (content: string, start: number, end: number, expected: string) => {
    let index = start;
    while (index < end) {
        while (index < end && /\s/.test(content[index])) {
            index++;
        }
        if (content[index] === "." || content[index] === "#") {
            while (index < end && !/\s/.test(content[index])) {
                index++;
            }
            continue;
        }
        const nameStart = index;
        while (index < end && /[-:\w]/.test(content[index])) {
            index++;
        }
        if (nameStart === index) {
            index++;
            continue;
        }
        const name = content.slice(nameStart, index);
        while (index < end && /\s/.test(content[index])) {
            index++;
        }
        if (content[index] !== "=") {
            continue;
        }
        index++;
        while (index < end && /\s/.test(content[index])) {
            index++;
        }
        const quote = content[index];
        if (quote !== "'" && quote !== '"') {
            while (index < end && !/\s/.test(content[index])) {
                index++;
            }
            continue;
        }
        const valueStart = ++index;
        let escaped = false;
        while (index < end) {
            const character = content[index];
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === quote) {
                break;
            }
            index++;
        }
        if (index >= end) {
            return;
        }
        if (name === expected) {
            return {start: valueStart, end: index, value: content.slice(valueStart, index)};
        }
        index++;
    }
};

const getAVRichTextMarkdownContainerContent = (line: string) => {
    let index = 0;
    while (index < line.length) {
        while (index < line.length && (line[index] === " " || line[index] === "\t")) {
            index++;
        }
        if (line[index] === ">") {
            index++;
            if (line[index] === " " || line[index] === "\t") {
                index++;
            }
            continue;
        }
        const list = line.slice(index).match(/^(?:[-+*]|\d+[.)])[ \t]+/);
        if (list) {
            index += list[0].length;
            continue;
        }
        break;
    }
    return line.slice(index);
};

const getAVRichTextDelimiterRun = (content: string, index: number, character: string) => {
    let end = index;
    while (content[end] === character) {
        end++;
    }
    return end - index;
};

interface AVRichTextLiteralRange {
    start: number;
    end: number;
}

const getAVRichTextLiteralBlockRanges = (markdown: string) => {
    const ranges: AVRichTextLiteralRange[] = [];
    let open: {start: number, character: string, length: number, math: boolean} | undefined;
    for (let lineStart = 0; lineStart <= markdown.length;) {
        let lineEnd = markdown.indexOf("\n", lineStart);
        if (lineEnd < 0) {
            lineEnd = markdown.length;
        }
        const contentEnd = lineEnd > lineStart && markdown[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
        const structuralContent = getAVRichTextMarkdownContainerContent(markdown.slice(lineStart, contentEnd));
        const nextLine = lineEnd < markdown.length ? lineEnd + 1 : markdown.length;
        if (open?.math) {
            if (structuralContent.trim() === "$$") {
                ranges.push({start: open.start, end: nextLine});
                open = undefined;
            }
        } else if (open) {
            const closingRun = getAVRichTextDelimiterRun(structuralContent, 0, open.character);
            if (closingRun >= open.length && structuralContent.slice(closingRun).trim() === "") {
                ranges.push({start: open.start, end: nextLine});
                open = undefined;
            }
        } else {
            const fence = structuralContent.match(/^(`{3,}|~{3,})/);
            if (fence && (fence[1][0] !== "`" || !structuralContent.slice(fence[1].length).includes("`"))) {
                open = {start: lineStart, character: fence[1][0], length: fence[1].length, math: false};
            } else if (structuralContent.trim() === "$$") {
                open = {start: lineStart, character: "$", length: 2, math: true};
            }
        }
        if (lineEnd === markdown.length) {
            break;
        }
        lineStart = nextLine;
    }
    if (open) {
        ranges.push({start: open.start, end: markdown.length});
    }
    return ranges;
};

const getAVRichTextLiteralRanges = (markdown: string) => {
    const blockRanges = getAVRichTextLiteralBlockRanges(markdown);
    const ranges = [...blockRanges];
    const escaped = new Uint8Array(markdown.length);
    let backslashes = 0;
    for (let index = 0; index < markdown.length; index++) {
        escaped[index] = backslashes % 2;
        backslashes = markdown[index] === "\\" ? backslashes + 1 : 0;
    }
    const paragraphBreaks: AVRichTextLiteralRange[] = [];
    const paragraphBreakPattern = /\r?\n[ \t]*(?:\r?\n|$)/g;
    for (let match = paragraphBreakPattern.exec(markdown); match; match = paragraphBreakPattern.exec(markdown)) {
        paragraphBreaks.push({start: match.index, end: match.index + match[0].length});
    }
    let runs: {start: number, end: number, length: number}[] = [];
    const flushRuns = () => {
        const nextByLength = new Map<number, number>();
        const nextSame = new Array<number>(runs.length).fill(-1);
        for (let index = runs.length - 1; index >= 0; index--) {
            nextSame[index] = nextByLength.get(runs[index].length) ?? -1;
            nextByLength.set(runs[index].length, index);
        }
        for (let index = 0; index < runs.length;) {
            const closing = nextSame[index];
            if (closing < 0) {
                index++;
                continue;
            }
            ranges.push({start: runs[index].start, end: runs[closing].end});
            index = closing + 1;
        }
        runs = [];
    };
    let blockIndex = 0;
    let breakIndex = 0;
    for (let index = 0; index < markdown.length;) {
        while (blockIndex < blockRanges.length && blockRanges[blockIndex].end <= index) {
            blockIndex++;
        }
        const block = blockRanges[blockIndex];
        if (block && block.start <= index) {
            flushRuns();
            index = block.end;
            continue;
        }
        while (breakIndex < paragraphBreaks.length && paragraphBreaks[breakIndex].end <= index) {
            breakIndex++;
        }
        const paragraphBreak = paragraphBreaks[breakIndex];
        if (paragraphBreak && paragraphBreak.start <= index) {
            flushRuns();
            index = paragraphBreak.end;
            continue;
        }
        if (markdown[index] === "<") {
            const tagEnd = findAVRichTextQuotedEnd(markdown, index + 1,
                Math.min(block?.start ?? markdown.length, paragraphBreak?.start ?? markdown.length), ">");
            if (tagEnd >= 0) {
                index = tagEnd + 1;
                continue;
            }
        } else if (markdown.startsWith("{:", index)) {
            const ialEnd = findAVRichTextQuotedEnd(markdown, index + 2,
                Math.min(block?.start ?? markdown.length, paragraphBreak?.start ?? markdown.length), "}");
            if (ialEnd >= 0) {
                index = ialEnd + 1;
                continue;
            }
        }
        if (markdown[index] !== "`" || escaped[index]) {
            index++;
            continue;
        }
        const run = getAVRichTextDelimiterRun(markdown, index, "`");
        runs.push({start: index, end: index + run, length: run});
        index += run;
    }
    flushRuns();
    return ranges.sort((left, right) => left.start - right.start);
};

const decodeAVRichTextStyleEntity = (entity: string) => {
    const named: Record<string, string> = {
        "&amp;": "&",
        "&apos;": "'",
        "&gt;": ">",
        "&lt;": "<",
        "&quot;": '"',
    };
    if (typeof named[entity] === "string") {
        return named[entity];
    }
    const numeric = entity.match(/^&#(x[0-9a-f]+|\d+);$/i);
    if (!numeric) {
        return;
    }
    const codePoint = numeric[1][0].toLowerCase() === "x" ?
        Number.parseInt(numeric[1].slice(1), 16) : Number.parseInt(numeric[1], 10);
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10FFFF ||
        0xD800 <= codePoint && codePoint <= 0xDFFF) {
        return;
    }
    return String.fromCodePoint(codePoint);
};

export const createAVRichTextStyleEntityReplacer = (protections: AVRichTextStyleEntityProtection[]) => {
    const entities = new Map(protections.map((protection) => [protection.token, protection]));
    const sentinelEnd = protections[0]?.token.indexOf("\uF8FF") ?? -1;
    const sentinel = sentinelEnd < 0 ? "" : protections[0].token.slice(0, sentinelEnd + 1);
    const tokenPattern = sentinel ? new RegExp(`${escapeAVRichTextRegExp(sentinel)}[0-9a-z]+\uE002`, "g") : undefined;
    return (
        value: string,
        useDecodedValue: boolean,
        restored?: Set<string>,
    ) => {
        if (!tokenPattern) {
            return value;
        }
        tokenPattern.lastIndex = 0;
        return value.replace(tokenPattern, (token) => {
            const entity = entities.get(token);
            if (!entity) {
                return token;
            }
            restored?.add(token);
            return useDecodedValue ? entity.decoded : entity.encoded;
        });
    };
};

export const restoreAVRichTextStyleEntities = (
    value: string,
    protections: AVRichTextStyleEntityProtection[],
) => createAVRichTextStyleEntityReplacer(protections)(value, true);

export const projectAVRichTextPlainBlocks = (blocks: string[], fallback = "") => blocks.length === 0 ? fallback :
    blocks.map((block) => block.replace(/\n+$/, "")).join("\n").replace(/\n+$/, "");

export const protectAVRichTextKramdownStyleEntities = (markdown: string) => {
    const sentinel = createAVRichTextStyleSentinel(markdown);
    const protections: AVRichTextStyleEntityProtection[] = [];
    const replacements: {start: number, end: number, value: string}[] = [];
    const spanStack: {text: boolean, literal: boolean}[] = [];
    const literalRanges = getAVRichTextLiteralRanges(markdown);
    let literalIndex = 0;
    for (let index = 0; index < markdown.length;) {
        while (literalIndex < literalRanges.length && literalRanges[literalIndex].end <= index) {
            literalIndex++;
        }
        const literalRange = literalRanges[literalIndex];
        if (literalRange && literalRange.start <= index) {
            index = literalRange.end;
            continue;
        }
        if (markdown[index] !== "<") {
            index++;
            continue;
        }
        if (markdown.startsWith("<span", index) && /[\s/>]/.test(markdown[index + 5] || "")) {
            const tagEnd = findAVRichTextQuotedEnd(markdown, index + 5, markdown.length, ">");
            if (tagEnd < 0) {
                index++;
                continue;
            }
            const dataType = getAVRichTextQuotedAttribute(markdown, index + 5, tagEnd, "data-type");
            if (markdown[tagEnd - 1] !== "/") {
                const types = dataType?.value.split(/\s+/) || [];
                spanStack.push({
                    text: types.includes("text"),
                    literal: types.includes("code") || spanStack.at(-1)?.literal === true,
                });
            }
            index = tagEnd + 1;
            continue;
        }
        if (!markdown.startsWith("</span", index) || !/[\s>]/.test(markdown[index + 6] || "")) {
            index++;
            continue;
        }
        const tagEnd = findAVRichTextQuotedEnd(markdown, index + 6, markdown.length, ">");
        if (tagEnd < 0) {
            index++;
            continue;
        }
        const span = spanStack.pop();
        const isText = span?.text === true && !span.literal;
        const ialStart = tagEnd + 1;
        if (!isText || !markdown.startsWith("{:", ialStart)) {
            index = tagEnd + 1;
            continue;
        }
        const ialEnd = findAVRichTextQuotedEnd(markdown, ialStart + 2, markdown.length, "}");
        if (ialEnd < 0) {
            index = tagEnd + 1;
            continue;
        }
        const style = getAVRichTextQuotedAttribute(markdown, ialStart + 2, ialEnd, "style");
        if (style) {
            for (let entityStart = style.start; entityStart < style.end;) {
                if (markdown[entityStart] === "`") {
                    const token = `${sentinel}${protections.length.toString(36)}\uE002`;
                    protections.push({token, encoded: "`", decoded: "`"});
                    replacements.push({start: entityStart, end: entityStart + 1, value: token});
                    entityStart++;
                    continue;
                }
                if (markdown[entityStart] !== "&") {
                    entityStart++;
                    continue;
                }
                const semicolon = markdown.indexOf(";", entityStart + 1);
                if (semicolon < 0 || semicolon >= style.end) {
                    entityStart++;
                    continue;
                }
                const encoded = markdown.slice(entityStart, semicolon + 1);
                const decoded = decodeAVRichTextStyleEntity(encoded);
                if (typeof decoded !== "string") {
                    entityStart++;
                    continue;
                }
                const token = `${sentinel}${protections.length.toString(36)}\uE002`;
                protections.push({token, encoded, decoded});
                replacements.push({start: entityStart, end: semicolon + 1, value: token});
                entityStart = semicolon + 1;
            }
        }
        index = ialEnd + 1;
    }
    if (replacements.length === 0) {
        return {content: markdown, protections};
    }
    let content = "";
    let start = 0;
    replacements.forEach((replacement) => {
        content += markdown.slice(start, replacement.start) + replacement.value;
        start = replacement.end;
    });
    return {content: content + markdown.slice(start), protections};
};

export const isAVRichTextExecutableCodeLanguage = (info: string) =>
    EXECUTABLE_CODE_LANGUAGES.has(info.trim().split(/\s+/, 1)[0].toLowerCase());

const normalizeAVRichTextInlineStyleValue = (property: AVRichTextStyleProperty, value: string) => {
    const builtinColor = value.match(/^var\(--b3-font-(color|background)(\d+)\)$/);
    if (builtinColor) {
        const index = Number(builtinColor[2]);
        if (Number.isInteger(index) && 1 <= index && index <= BUILTIN_INLINE_COLOR_COUNT &&
            (property === "color" && builtinColor[1] === "color" ||
                property === "background-color" && builtinColor[1] === "background")) {
            return `var(--b3-font-${builtinColor[1]}${index})`;
        }
        return "";
    }

    const builtinStyle = value.match(
        /^var\(--b3-inline-builtin-(error|warning|info|success)-(color|background-color),\s*var\(--b3-card-(error|warning|info|success)-(color|background)\)\)$/
    );
    if (builtinStyle) {
        const expectedStyleProperty = property === "color" ? "color" : "background-color";
        const expectedLegacyProperty = property === "color" ? "color" : "background";
        if (builtinStyle[1] === builtinStyle[3] && builtinStyle[2] === expectedStyleProperty &&
            builtinStyle[4] === expectedLegacyProperty) {
            return `var(--b3-inline-builtin-${builtinStyle[1]}-${expectedStyleProperty}, ` +
                `var(--b3-card-${builtinStyle[1]}-${expectedLegacyProperty}))`;
        }
        return "";
    }

    const customStyle = value.match(
        /^var\(--b3-inline-style-([0-9]{14}-[a-z0-9]{7})-(color|background-color),\s*(#[0-9A-Fa-f]{6})\)$/
    );
    const expectedCustomProperty = property === "color" ? "color" : "background-color";
    if (customStyle && customStyle[2] === expectedCustomProperty) {
        return `var(--b3-inline-style-${customStyle[1]}-${expectedCustomProperty}, ${customStyle[3].toLowerCase()})`;
    }
    return "";
};

const splitAVRichTextStyleDeclarations = (style: string) => {
    const declarations: string[] = [];
    let start = 0;
    let quote = "";
    let escaped = false;
    let parentheses = 0;
    for (let index = 0; index < style.length; index++) {
        const character = style[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === "\\") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (character === quote) {
                quote = "";
            }
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
        } else if (character === "(") {
            parentheses++;
        } else if (character === ")") {
            if (parentheses === 0) {
                return [];
            }
            parentheses--;
        } else if (character === ";" && parentheses === 0) {
            declarations.push(style.slice(start, index));
            start = index + 1;
        }
    }
    if (escaped || quote || parentheses !== 0) {
        return [];
    }
    declarations.push(style.slice(start));
    return declarations;
};

const normalizeAVRichTextFontSize = (value: string) => {
    const match = value.match(/^(\d+)(?:\.0{1,2})?px$/);
    if (match) {
        const size = Number(match[1]);
        return 9 <= size && size <= 72 ? `${size}px` : "";
    }
    const emMatch = value.match(/^(?:(\d+)(?:\.(\d{1,2}))?|\.(\d{1,2}))em$/);
    if (!emMatch) {
        return "";
    }
    const size = Number(value.slice(0, -2));
    return 0.56 <= size && size <= 4.5 ? `${size}em` : "";
};

const normalizeAVRichTextFontFamily = (value: string) => {
    if (value.length > 2048 || !FONT_FAMILY_PATTERN.test(value)) {
        return "";
    }
    const family = getInlineFontFamilyName(value);
    if (!family || Array.from(family).length > MAX_INLINE_FONT_FAMILY_LENGTH) {
        return "";
    }
    return getInlineFontFamilyStyle(family);
};

export const sanitizeAVRichTextInlineStyle = (style: unknown) => {
    if (typeof style !== "string") {
        return "";
    }
    const values = new Map<string, string>();
    splitAVRichTextStyleDeclarations(style).forEach((declaration) => {
        const match = declaration.match(/^\s*([-a-z]+)\s*:\s*([\s\S]*?)\s*$/);
        if (!match) {
            return;
        }
        const property = match[1];
        const value = match[2];
        if (property === "color" || property === "background-color") {
            const normalized = normalizeAVRichTextInlineStyleValue(property, value);
            if (normalized) {
                values.set(property, normalized);
            }
        } else if (property === "font-size") {
            const normalized = normalizeAVRichTextFontSize(value);
            if (normalized) {
                values.set(property, normalized);
            }
        } else if (property === "font-family") {
            const normalized = normalizeAVRichTextFontFamily(value);
            if (normalized) {
                values.set(property, normalized);
            }
        } else if (property === "-webkit-text-stroke" && value === HOLLOW_STROKE ||
            property === "-webkit-text-fill-color" && value === HOLLOW_FILL ||
            property === "text-shadow" && value === TEXT_SHADOW ||
            property === "direction" && (value === "ltr" || value === "rtl") ||
            property === "unicode-bidi" && value === "isolate") {
            values.set(property, value);
        }
    });
    if (!values.has("-webkit-text-stroke") || !values.has("-webkit-text-fill-color")) {
        values.delete("-webkit-text-stroke");
        values.delete("-webkit-text-fill-color");
    }
    if (!values.has("direction") || !values.has("unicode-bidi")) {
        values.delete("direction");
        values.delete("unicode-bidi");
    }
    return [
        "color",
        "background-color",
        "font-size",
        "font-family",
        "-webkit-text-stroke",
        "-webkit-text-fill-color",
        "text-shadow",
        "direction",
        "unicode-bidi",
    ].map((property) => values.has(property) ? `${property}: ${values.get(property)};` : "")
        .filter(Boolean).join(" ");
};

export const getAVTextSource = (value?: IAVCellValue): AVTextSource => {
    const rich = value?.type === "text" ? value.text?.rich : undefined;
    if (rich && rich.spec === AV_RICH_TEXT_SPEC && rich.format === AV_RICH_TEXT_FORMAT &&
        typeof rich.content === "string") {
        return {kind: "rich", content: rich.content};
    }
    return {kind: "plain", content: value?.type === "text" && typeof value.text?.content === "string" ?
        value.text.content : ""};
};

export const getAVTextPlainContent = (value?: IAVCellValue) =>
    value?.type === "text" && typeof value.text?.content === "string" ? value.text.content : "";

export const getAVTextCopyContent = (value?: IAVCellValue) => getAVTextPlainContent(value).trim();

export const createAVRichTextValue = (markdown: string, plainText: string,
                                      sourceValue?: IAVCellValue): IAVCellValue => ({
    ...sourceValue,
    type: "text",
    text: {
        content: plainText,
        rich: {
            spec: AV_RICH_TEXT_SPEC,
            format: AV_RICH_TEXT_FORMAT,
            content: markdown,
        },
    },
});

export const createAVPlainTextValue = (content: string, sourceValue?: IAVCellValue,
                                      clearRich = false): IAVCellValue => ({
    ...sourceValue,
    type: "text",
    text: clearRich ? {content, rich: null} : {content},
});

export const createAVPlainTextEditValue = (content: string, sourceValue?: IAVCellValue): IAVCellValue => {
    const sourceText = sourceValue?.type === "text" ? sourceValue.text : undefined;
    let rich: IAVCellValue["text"]["rich"] | undefined;
    if (sourceText && sourceText.content === content) {
        rich = sourceText.rich;
    } else if (sourceText?.rich !== undefined) {
        rich = null;
    }
    return {
        type: "text",
        text: typeof rich === "undefined" ? {content} : {
            content,
            rich: rich && {...rich},
        },
    };
};
