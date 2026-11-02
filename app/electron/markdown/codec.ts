import type {MarkdownFormat} from "../../src/markdown/contracts";

const normalizeNewlines = (content: string): string => content.replace(/\r\n|\r/g, "\n");

const decodeMarkdown = (bytes: Uint8Array): {content: string; format: MarkdownFormat} => {
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("Markdown input must be bytes");
    }
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const text = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bom ? bytes.subarray(3) : bytes);
    const counts = new Map<string, number>();
    for (const match of text.matchAll(/\r\n|\r|\n/g)) {
        counts.set(match[0], (counts.get(match[0]) || 0) + 1);
    }
    let newline: MarkdownFormat["newline"] = "\n";
    let maximum = 0;
    for (const [kind, count] of counts) {
        if (count > maximum) {
            newline = kind as MarkdownFormat["newline"];
            maximum = count;
        }
    }
    return {content: normalizeNewlines(text), format: {bom, newline}};
};

const encodeMarkdown = (content: string, format: MarkdownFormat): Uint8Array => {
    if (typeof content !== "string" || typeof format?.bom !== "boolean" ||
        !["\n", "\r\n", "\r"].includes(format.newline)) {
        throw new TypeError("Invalid Markdown content or format");
    }
    // TextEncoder 会静默替换孤立代理项，必须在编码前拒绝这种内容损失。
    for (let index = 0; index < content.length; index++) {
        const code = content.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = content.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("Invalid Markdown Unicode content");
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            throw new TypeError("Invalid Markdown Unicode content");
        }
    }
    return new TextEncoder().encode((format.bom ? "\uFEFF" : "") +
        normalizeNewlines(content).replace(/\n/g, format.newline));
};

export {decodeMarkdown, encodeMarkdown};
