// 远端内核文档的内联脚本识别与内容安全策略：从内核返回的 HTML 里取出事件处理器与内联脚本，
// 再用它们的散列生成 CSP，使未经授权的内联脚本无法执行。
import * as crypto from "node:crypto";

type HTMLAttribute = {name: string; value?: string};

type RemoteDocumentInlineScriptSources = {eventHandlers: string[]; inlineScripts: string[]};

const decodeHTMLAttributeValue = (value: string): string => value.replace(/&(#(?:x[\da-f]+|\d+)|amp|apos|gt|lt|quot);?/gi,
    (match: string, entity: string): string => {
        const normalizedEntity = entity.toLowerCase();
        if (normalizedEntity.startsWith("#x")) {
            const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
            return Number.isSafeInteger(codePoint) && codePoint <= 0x10FFFF
                ? String.fromCodePoint(codePoint)
                : match;
        }
        if (normalizedEntity.startsWith("#")) {
            const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
            return Number.isSafeInteger(codePoint) && codePoint <= 0x10FFFF
                ? String.fromCodePoint(codePoint)
                : match;
        }
        const entities: Record<string, string> = {
            amp: "&",
            apos: "'",
            gt: ">",
            lt: "<",
            quot: "\"",
        };
        return entities[normalizedEntity];
    });

const parseHTMLAttributes = (source: string): HTMLAttribute[] => {
    const attributes: HTMLAttribute[] = [];
    let offset = 0;
    while (offset < source.length) {
        while (/\s/.test(source[offset])) {
            offset++;
        }
        if (offset >= source.length || source[offset] === "/") {
            break;
        }
        const nameStart = offset;
        while (offset < source.length && !/[\s=/>]/.test(source[offset])) {
            offset++;
        }
        if (offset === nameStart) {
            offset++;
            continue;
        }
        const name = source.slice(nameStart, offset).toLowerCase();
        while (/\s/.test(source[offset])) {
            offset++;
        }
        let value;
        if (source[offset] === "=") {
            offset++;
            while (/\s/.test(source[offset])) {
                offset++;
            }
            const quote = source[offset] === "\"" || source[offset] === "'" ? source[offset++] : undefined;
            const valueStart = offset;
            if (quote) {
                while (offset < source.length && source[offset] !== quote) {
                    offset++;
                }
                value = source.slice(valueStart, offset);
                if (source[offset] === quote) {
                    offset++;
                }
            } else {
                while (offset < source.length && !/[\s>]/.test(source[offset])) {
                    offset++;
                }
                value = source.slice(valueStart, offset);
            }
        }
        attributes.push({name, value});
    }
    return attributes;
};

const findHTMLTagEnd = (html: string, start: number): number => {
    let quote: string | undefined;
    for (let offset = start; offset < html.length; offset++) {
        const character = html[offset];
        if (quote) {
            if (character === quote) {
                quote = undefined;
            }
        } else if (character === "\"" || character === "'") {
            quote = character;
        } else if (character === ">") {
            return offset;
        }
    }
    return -1;
};

const normalizeHTMLScriptSource = (source: string): string => source.replace(/\r\n?/g, "\n");

const getRemoteDocumentInlineScriptSources = (html: string): RemoteDocumentInlineScriptSources => {
    const inlineScripts: string[] = [];
    const eventHandlers: string[] = [];
    const lowerHTML = html.toLowerCase();
    const rawTextElements = new Set(["iframe", "noembed", "noframes", "noscript", "style", "textarea", "title", "xmp"]);
    let offset = 0;
    while (offset < html.length) {
        const tagStart = html.indexOf("<", offset);
        if (tagStart < 0) {
            break;
        }
        if (html.startsWith("<!--", tagStart)) {
            const commentEnd = html.indexOf("-->", tagStart + 4);
            offset = commentEnd < 0 ? html.length : commentEnd + 3;
            continue;
        }
        const tagEnd = findHTMLTagEnd(html, tagStart + 1);
        if (tagEnd < 0) {
            break;
        }
        const tagSource = html.slice(tagStart + 1, tagEnd);
        const tagMatch = /^\s*([a-z][\w:-]*)\b/i.exec(tagSource);
        if (!tagMatch) {
            offset = tagEnd + 1;
            continue;
        }
        const tagName = tagMatch[1].toLowerCase();
        const attributes = parseHTMLAttributes(tagSource.slice(tagMatch[0].length));
        for (const attribute of attributes) {
            if (attribute.name.startsWith("on") && attribute.name.length > 2 && attribute.value !== undefined) {
                eventHandlers.push(normalizeHTMLScriptSource(decodeHTMLAttributeValue(attribute.value)));
            }
        }
        if (tagName !== "script" && !rawTextElements.has(tagName)) {
            offset = tagEnd + 1;
            continue;
        }
        const closeTagStart = lowerHTML.indexOf("</" + tagName, tagEnd + 1);
        if (closeTagStart < 0) {
            offset = tagEnd + 1;
            continue;
        }
        if (tagName === "script" && !attributes.some((attribute) => attribute.name === "src")) {
            inlineScripts.push(normalizeHTMLScriptSource(html.slice(tagEnd + 1, closeTagStart)));
        }
        const closeTagEnd = html.indexOf(">", closeTagStart + tagName.length + 2);
        offset = closeTagEnd < 0 ? html.length : closeTagEnd + 1;
    }
    return {eventHandlers, inlineScripts};
};

const createRemoteDocumentContentSecurityPolicy = (html: string, origin: string,
    extensionScriptNonce?: string): string => {
    const {inlineScripts} = getRemoteDocumentInlineScriptSources(html);
    const hashes = [...new Set(inlineScripts.map((source) =>
        "'sha256-" + crypto.createHash("sha256").update(source, "utf8").digest("base64") + "'"))];
    const stageSource = new URL("/stage/", origin).href;
    const appearanceSource = new URL("/appearance/", origin).href;
    const defaultIconSource = new URL("/appearance/icons/litheness/icon.js", origin).href;
    const scriptSources = [stageSource, defaultIconSource, "blob:", "'wasm-unsafe-eval'", ...hashes];
    const extensionSources = ["/plugins/", "/appearance/themes/", "/appearance/icons/"]
        .map((pathname) => new URL(pathname, origin).href);
    if (extensionScriptNonce) {
        // 插件加载器需要动态求值，代码片段通过本地主进程提供的随机数授权。
        scriptSources.push(...extensionSources, "'unsafe-eval'", "'nonce-" + extensionScriptNonce + "'");
    }
    return [
        "base-uri " + new URL("/", origin).href,
        "child-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "script-src " + scriptSources.join(" "),
        "script-src-attr 'none'",
        "style-src 'unsafe-inline' " + stageSource + " " + appearanceSource +
            (extensionScriptNonce ? " " + new URL("/plugins/", origin).href : ""),
        "worker-src " + stageSource + (extensionScriptNonce ? " " + extensionSources.join(" ") : ""),
    ].join("; ");
};

export {createRemoteDocumentContentSecurityPolicy, getRemoteDocumentInlineScriptSources};
