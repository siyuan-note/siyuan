import {escapeHtml} from "../../../util/escape";
import {highlightRender} from "../highlightRender";
import {getAgentLute} from "../setLute";
import {mathRender} from "../mathRender";
import {
    createAVRichTextStyleBackslashEncoding,
    createAVRichTextStyleEntityReplacer,
    configureAVRichTextLute,
    getAVRichTextSafeURL,
    isAVRichTextExecutableCodeLanguage,
    projectAVRichTextPlainBlocks,
    protectAVRichTextKramdownStyleEntities,
    sanitizeAVRichTextInlineMemoContent,
    sanitizeAVRichTextInlineStyle,
    AV_RICH_TEXT_PREVIEW_SANITIZE_OPTIONS,
    AV_RICH_TEXT_PREVIEW_TEXT_ONLY_TAGS,
    AV_RICH_TEXT_EDITOR_ALLOWED_ATTRIBUTES,
    AV_RICH_TEXT_EDITOR_ALLOWED_TAGS,
} from "./richTextValue";
import type {AVRichTextStyleEntityProtection} from "./richTextValue";

export {
    AV_RICH_TEXT_FORMAT,
    AV_RICH_TEXT_EDITOR_ALLOWED_ATTRIBUTES,
    AV_RICH_TEXT_EDITOR_ALLOWED_TAGS,
    AV_RICH_TEXT_PREVIEW_ALLOWED_ATTRIBUTES,
    AV_RICH_TEXT_PREVIEW_ALLOWED_TAGS,
    AV_RICH_TEXT_PREVIEW_SANITIZE_OPTIONS,
    AV_RICH_TEXT_PREVIEW_TEXT_ONLY_TAGS,
    AV_RICH_TEXT_SPEC,
    configureAVRichTextLute,
    createAVPlainTextValue,
    createAVPlainTextEditValue,
    createAVRichTextStyleBackslashEncoding,
    createAVRichTextValue,
    getAVTextCopyContent,
    getAVTextPlainContent,
    getAVTextSource,
    getAVRichTextSafeURL,
    isAVRichTextExecutableCodeLanguage,
    projectAVRichTextPlainBlocks,
    protectAVRichTextKramdownStyleEntities,
    restoreAVRichTextStyleEntities,
    sanitizeAVRichTextInlineMemoContent,
    sanitizeAVRichTextInlineStyle,
} from "./richTextValue";
export type {AVTextSource} from "./richTextValue";
export const AV_RICH_TEXT_CLASS = "av__celltext--rich";

const ALLOWED_BLOCK_TYPES = new Set([
    "NodeParagraph",
    "NodeHeading",
    "NodeList",
    "NodeListItem",
    "NodeBlockquote",
    "NodeCodeBlock",
    "NodeMathBlock",
]);
const ALLOWED_INLINE_TYPES = new Set([
    "a",
    "block-ref",
    "code",
    "em",
    "file-annotation-ref",
    "inline-math",
    "inline-memo",
    "kbd",
    "mark",
    "s",
    "strong",
    "sub",
    "sup",
    "tag",
    "text",
    "u",
]);
const ALLOWED_EDITOR_TAGS = new Set(AV_RICH_TEXT_EDITOR_ALLOWED_TAGS.map((tag) => tag.toUpperCase()));
const previewCache = new Map<string, string>();
const PREVIEW_CACHE_LIMIT = 256;
let richTextLute: Lute | undefined;

// 数据库存储的是稳定的 Kramdown 片段，解析不能跟随用户的 Markdown 语法开关变化。
export const getAVRichTextLute = () => {
    if (!richTextLute) {
        richTextLute = getAgentLute({
            emojiSite: "/emojis",
            emojis: {},
            headingAnchor: false,
            listStyle: false,
            paragraphBeginningSpace: true,
            sanitize: true,
        });
        configureAVRichTextLute(richTextLute);
    }
    return richTextLute;
};

const replaceWithText = (element: Element) => {
    element.replaceWith(document.createTextNode(element.textContent || ""));
};

const removeUnsupportedBlockAttributes = (element: HTMLElement) => {
    Array.from(element.attributes).forEach((attribute) => {
        if (attribute.name.startsWith("custom-") || attribute.name === "bookmark" ||
            attribute.name === "memo" || attribute.name === "name" || attribute.name === "style") {
            element.removeAttribute(attribute.name);
        }
    });
};

export const sanitizeAVRichTextBlockDOM = (blockDOM: string) => {
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    template.content.querySelectorAll<HTMLElement>('[data-type^="Node"]').forEach((element) => {
        const type = element.dataset.type;
        if (type === "NodeCodeBlock" && (element.classList.contains("render-node") ||
            isAVRichTextExecutableCodeLanguage(element.dataset.subtype || ""))) {
            element.remove();
            return;
        }
        if (type === "NodeHeading") {
            const subtype = element.dataset.subtype || "";
            if (!/^h[1-6]$/.test(subtype)) {
                element.remove();
                return;
            }
            element.className = subtype;
        }
        if (ALLOWED_BLOCK_TYPES.has(type)) {
            removeUnsupportedBlockAttributes(element);
            return;
        }
        element.remove();
    });
    template.content.querySelectorAll(
        ".img, img, iframe, audio, video, object, embed, script, style, link, meta, form, input, button, textarea, select"
    ).forEach((element) => {
        element.remove();
    });
    template.content.querySelectorAll<HTMLElement>("*").forEach((element) => {
        if (!ALLOWED_EDITOR_TAGS.has(element.tagName)) {
            replaceWithText(element);
        }
    });
    template.content.querySelectorAll<HTMLElement>("span[data-type]").forEach((element) => {
        const types = (element.dataset.type || "").split(" ").filter(Boolean);
        if (types.some((type) => !ALLOWED_INLINE_TYPES.has(type))) {
            replaceWithText(element);
            return;
        }
        const style = types.includes("text") ? sanitizeAVRichTextInlineStyle(element.getAttribute("style")) : "";
        if (style) {
            element.setAttribute("style", style);
        } else {
            element.removeAttribute("style");
        }
        if (types.includes("inline-memo")) {
            element.dataset.inlineMemoContent = sanitizeAVRichTextInlineMemoContent(
                element.dataset.inlineMemoContent || "");
        }
    });
    template.content.querySelectorAll<HTMLElement>("*").forEach((element) => {
        Array.from(element.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            if (!AV_RICH_TEXT_EDITOR_ALLOWED_ATTRIBUTES.includes(name) ||
                name === "xlink:href" && !attribute.value.startsWith("#icon")) {
                element.removeAttribute(attribute.name);
            }
        });
    });
    template.content.querySelectorAll<HTMLElement>('[data-type~="a"][data-href]').forEach((element) => {
        const href = getAVRichTextSafeURL(element.dataset.href);
        if (href) {
            element.dataset.href = href;
        } else {
            element.removeAttribute("data-href");
        }
    });
    template.content.querySelectorAll<HTMLElement>('[data-type~="file-annotation-ref"][data-id]')
        .forEach((element) => {
            if (!getAVRichTextSafeURL(element.dataset.id)) {
                element.removeAttribute("data-id");
            }
        });
    template.content.querySelectorAll<HTMLElement>('[data-type~="block-ref"][data-id]').forEach((element) => {
        if (!/^\d{14}-[a-z0-9]{7}$/.test(element.dataset.id || "")) {
            element.removeAttribute("data-id");
        }
    });
    template.content.querySelectorAll<HTMLElement>("[style]:not(span[data-type])")
        .forEach((element) => element.removeAttribute("style"));
    return (template.innerHTML || "").trim();
};

const cleanAVRichTextBlockDOMStructure = (blockDOM: string) => {
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    template.content.querySelectorAll(".protyle-attr, .protyle-icons").forEach((element) => element.remove());
    template.content.querySelectorAll<HTMLElement>("*").forEach((element) => {
        ["data-node-id", "data-node-index", "updated"].forEach((attribute) => {
            element.removeAttribute(attribute);
        });
    });
    return (template.innerHTML || "").trim();
};

const protectAVRichTextStyleBackslashes = (
    blockDOM: string,
    encoding: ReturnType<typeof createAVRichTextStyleBackslashEncoding>,
) => {
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    template.content.querySelectorAll<HTMLElement>('span[data-type~="text"][style]').forEach((element) => {
        element.setAttribute("style", encoding.protectStyle(element.getAttribute("style") || ""));
    });
    return (template.innerHTML || "").trim();
};

const restoreAVRichTextBlockDOMStyleEntities = (
    blockDOM: string,
    protections: AVRichTextStyleEntityProtection[],
) => {
    if (protections.length === 0) {
        return blockDOM;
    }
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const restored = new Set<string>();
    const replaceProtections = createAVRichTextStyleEntityReplacer(protections);
    template.content.querySelectorAll<HTMLElement>('span[data-type~="text"][style]').forEach((element) => {
        const style = element.getAttribute("style") || "";
        element.setAttribute("style", replaceProtections(style, true, restored));
    });
    const restoreLiteralText = (element: Element) => {
        const visit = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                node.nodeValue = replaceProtections(node.nodeValue || "", false, restored);
                return;
            }
            node.childNodes.forEach(visit);
        };
        visit(element);
    };
    template.content.querySelectorAll('[data-type="NodeCodeBlock"], span[data-type~="code"]')
        .forEach(restoreLiteralText);
    template.content.querySelectorAll<HTMLElement>(
        '[data-type="NodeMathBlock"][data-content], [data-type="NodeMathBlock"] [data-content], ' +
        'span[data-type~="inline-math"][data-content]'
    ).forEach((element) => {
        element.setAttribute("data-content",
            replaceProtections(element.getAttribute("data-content") || "", false, restored));
    });
    if (protections.some((protection) => !restored.has(protection.token))) {
        throw new Error("Invalid attribute view rich text style entity");
    }
    return (template.innerHTML || "").trim();
};

const parseAVRichTextKramdown = (markdown: string, lute = getAVRichTextLute()) => {
    const protectedStyle = protectAVRichTextKramdownStyleEntities(markdown);
    return restoreAVRichTextBlockDOMStyleEntities(lute.Md2BlockDOM(protectedStyle.content),
        protectedStyle.protections);
};

const getAVRichTextPlainContent = (blockDOM: string, lute: Lute) => {
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const blocks = Array.from(template.content.querySelectorAll<HTMLElement>(
        '[data-type="NodeParagraph"], [data-type="NodeHeading"], [data-type="NodeCodeBlock"], ' +
        '[data-type="NodeMathBlock"]'
    )).map((element) => lute.BlockDOM2Content(element.outerHTML));
    return projectAVRichTextPlainBlocks(blocks, lute.BlockDOM2Content(blockDOM));
};

export const serializeAVRichTextBlockDOM = (blockDOM: string, lute = getAVRichTextLute()) => {
    const sanitizedBlockDOM = sanitizeAVRichTextBlockDOM(blockDOM);
    const cleanBlockDOM = cleanAVRichTextBlockDOMStructure(sanitizedBlockDOM);
    const styleBackslashEncoding = createAVRichTextStyleBackslashEncoding(cleanBlockDOM);
    const protectedBlockDOM = protectAVRichTextStyleBackslashes(cleanBlockDOM, styleBackslashEncoding);
    const markdown = protectedBlockDOM ?
        styleBackslashEncoding.encodeMarkdown(lute.BlockDOM2Md(protectedBlockDOM).trim()) : "";
    const normalizedBlockDOM = markdown ? sanitizeAVRichTextBlockDOM(parseAVRichTextKramdown(markdown, lute)) : "";
    return {
        blockDOM: normalizedBlockDOM,
        markdown,
        plainText: normalizedBlockDOM ? getAVRichTextPlainContent(normalizedBlockDOM, lute) : "",
    };
};

export const getAVRichTextBlockDOM = (markdown: string) => markdown ?
    sanitizeAVRichTextBlockDOM(parseAVRichTextKramdown(markdown)) : "";

const getAVRichTextPreviewBlockDOM = (blockDOM: string) => {
    const template = document.createElement("template");
    template.innerHTML = cleanAVRichTextBlockDOMStructure(blockDOM);
    template.content.querySelectorAll(".protyle-action").forEach((element) => element.remove());
    return (template.innerHTML || "").trim();
};

const prepareAVRichTextPreviewHTML = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = window.DOMPurify.sanitize(html, AV_RICH_TEXT_PREVIEW_SANITIZE_OPTIONS);
    template.content.querySelectorAll<HTMLElement>(AV_RICH_TEXT_PREVIEW_TEXT_ONLY_TAGS.join(","))
        .forEach((element) => {
        // BlockDOM2HTML 使用 sup 输出备注内容；这里只保留文本，避免备注伪造可交互标记。
            element.textContent = element.textContent || "";
        });
    template.content.querySelectorAll<HTMLElement>("div.language-math").forEach((element) => {
        const content = element.textContent || "";
        element.className = "render-node";
        element.dataset.subtype = "math";
        element.dataset.content = content;
        element.textContent = "";
    });
    template.content.querySelectorAll<HTMLElement>("pre > code").forEach((element) => {
        const languageClass = Array.from(element.classList).find((className) => className.startsWith("language-"));
        element.parentElement.className = "code-block";
        element.parentElement.dataset.language = languageClass?.slice("language-".length) || "plaintext";
    });
    template.content.querySelectorAll<HTMLElement>("*").forEach((element) => {
        ["id", "data-node-id", "data-node-index", "updated", "contenteditable", "spellcheck", "draggable"]
            .forEach((attribute) => element.removeAttribute(attribute));
        const types = (element.dataset.type || "").split(" ").filter(Boolean);
        const style = element.tagName === "SPAN" && types.includes("text") ?
            sanitizeAVRichTextInlineStyle(element.getAttribute("style")) : "";
        if (style) {
            element.setAttribute("style", style);
        } else {
            element.removeAttribute("style");
        }
    });
    template.content.querySelectorAll<HTMLInputElement>("input").forEach((element) => {
        if (element.type !== "checkbox") {
            element.remove();
            return;
        }
        element.disabled = true;
    });
    template.content.querySelectorAll<HTMLElement>("[data-href], a[href]").forEach((element) => {
        const href = getAVRichTextSafeURL(element.getAttribute("href") || element.dataset.href);
        if (!href) {
            element.removeAttribute("href");
            element.removeAttribute("data-href");
            return;
        }
        element.setAttribute("href", href);
        element.dataset.href = href;
    });
    template.content.querySelectorAll<HTMLElement>('[data-type~="file-annotation-ref"][data-id]')
        .forEach((element) => {
            if (!getAVRichTextSafeURL(element.dataset.id)) {
                element.removeAttribute("data-id");
            }
        });
    template.content.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((element) => {
        const types = new Set((element.dataset.type || "").split(" ").filter(Boolean));
        types.add("a");
        element.dataset.type = Array.from(types).join(" ");
    });
    return template.innerHTML;
};

export const getAVRichTextPreviewHTML = (markdown: string) => {
    if (!markdown) {
        return "";
    }
    const cached = previewCache.get(markdown);
    if (typeof cached === "string") {
        previewCache.delete(markdown);
        previewCache.set(markdown, cached);
        return cached;
    }
    try {
        const lute = getAVRichTextLute();
        const blockDOM = getAVRichTextBlockDOM(markdown);
        const previewBlockDOM = getAVRichTextPreviewBlockDOM(blockDOM);
        const html = previewBlockDOM ? prepareAVRichTextPreviewHTML(lute.BlockDOM2HTML(previewBlockDOM)) : "";
        previewCache.set(markdown, html);
        if (previewCache.size > PREVIEW_CACHE_LIMIT) {
            const oldestKey = previewCache.keys().next().value;
            if (oldestKey) {
                previewCache.delete(oldestKey);
            }
        }
        return html;
    } catch (error) {
        console.error(error);
        return escapeHtml(markdown);
    }
};

export const renderAVRichTextElements = (root: Element) => {
    const selector = `.${AV_RICH_TEXT_CLASS}:not([data-rich-rendered="true"])`;
    const elements: HTMLElement[] = [];
    if (root.matches(selector)) {
        elements.push(root as HTMLElement);
    }
    elements.push(...root.querySelectorAll<HTMLElement>(selector));
    if (elements.length === 0) {
        return;
    }
    elements.forEach((element) => {
        element.dataset.richRendered = "true";
    });
    elements.forEach((element) => {
        mathRender(element);
        highlightRender(element);
    });
};
