import {escapeHtmlTextAndAttr, escapeLessThans} from "../../util/escape";

const htmlTags = new Map<string, boolean>();

const isHTMLTag = (name: string) => {
    const tag = name.toLowerCase();
    const cached = htmlTags.get(tag);
    if (cached !== undefined) {
        return cached;
    }
    let supported = !tag.includes("-") && !(document.createElement(tag) instanceof HTMLUnknownElement);
    if (!supported) {
        // SVG、MathML 和兼容标签交由净化器识别，避免把泛型参数当作标签。
        const candidate = `<${tag}></${tag}>`;
        const sanitized = window.DOMPurify.sanitize(`${candidate}<svg>${candidate}</svg><math>${candidate}</math>`);
        supported = new RegExp(`<${tag}(?:\\s|/?>)`, "i").test(sanitized);
    }
    if (htmlTags.size < 256) {
        htmlTags.set(tag, supported);
    }
    return supported;
};

const getMemoHTMLTags = (content: string) => {
    const tags: Array<{index: number, content: string}> = [];
    const tagName = /<\/?([a-z][a-z0-9:-]*)(?=[\s/>])/iy;
    let offset = 0;
    while (offset < content.length) {
        const start = content.indexOf("<", offset);
        if (start < 0) {
            break;
        }
        if (content.startsWith("<!--", start)) {
            const end = content.indexOf("-->", start + 4);
            if (end < 0) {
                break;
            }
            offset = end + 3;
            continue;
        }
        tagName.lastIndex = start;
        const match = tagName.exec(content);
        if (!match || match.index !== start) {
            offset = start + 1;
            continue;
        }
        let cursor = tagName.lastIndex;
        let quote = "";
        for (; cursor < content.length; cursor++) {
            const character = content[cursor];
            if (quote) {
                if (character === quote) {
                    quote = "";
                }
            } else if (character === "\"" || character === "'") {
                quote = character;
            } else if (character === "<" || character === ">") {
                break;
            }
        }
        if (cursor === content.length) {
            break;
        }
        if (content[cursor] === ">" && isHTMLTag(match[1])) {
            tags.push({index: start, content: content.slice(start, cursor + 1)});
        }
        offset = cursor + (content[cursor] === ">" ? 1 : 0);
    }
    return tags;
};

const protectMemoText = (content: string, tags: Array<{index: number, content: string}>,
                         escapeText: (text: string) => string) => {
    // 完整标签保留原有 HTML 语义，未闭合标签和未知标签按普通文字显示。
    let result = "";
    let offset = 0;
    for (const match of tags) {
        result += escapeText(content.slice(offset, match.index)) + match.content;
        offset = match.index + match.content.length;
    }
    return result + escapeText(content.slice(offset));
};

// HTML 备注编辑源码，普通备注编辑原文，避免实体在反复编辑时改变含义。
export const encodeInlineMemoContent = (content: string) => {
    const tags = getMemoHTMLTags(content);
    return window.DOMPurify.sanitize(protectMemoText(content, tags,
        tags.length > 0 ? escapeLessThans : escapeHtmlTextAndAttr));
};

// 已保存的实体保持编码层级，兼容历史备注中的未转义文本和 HTML。
export const sanitizeInlineMemoContent = (content: string) =>
    window.DOMPurify.sanitize(protectMemoText(content, getMemoHTMLTags(content), escapeLessThans));

export const decodeInlineMemoContent = (content: string) => {
    const sanitized = sanitizeInlineMemoContent(content);
    return getMemoHTMLTags(sanitized).length > 0 ? sanitized : Lute.UnEscapeHTMLStr(sanitized);
};
