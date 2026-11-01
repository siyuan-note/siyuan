import {createMarkdownInstanceId} from "./identity";

export type MarkdownResourceResolver = (reference: string) => string | undefined | Promise<string | undefined>;

interface PreservedMarkup {
    scope: string;
    html?: string;
    attributes?: Array<{name: string; original: string; displayed: string | null}>;
}

const preservationAttribute = "data-markdown-preserved";
const blockedElements = new Set(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "STYLE",
    "FORM", "SVG", "AUDIO", "VIDEO", "SOURCE", "TRACK"]);
const resourceAttributes = new Set(["src", "srcset", "href", "xlink:href", "action", "formaction", "poster", "data",
    "background", "codebase", "manifest", "ping"]);
const diagramLanguages = /\blanguage-(?:abc|mermaid|smiles|markmap|flowchart|echarts|mindmap|plantuml|graphviz|wavedrom)\b/g;
const hasControlCharacter = (value: string) => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export const isRelativeMarkdownResource = (reference: string): boolean => Boolean(reference) &&
    !/^[\/\\#]|^[a-z][a-z\d+.-]*:/i.test(reference) && !hasControlCharacter(reference);

export const isMarkdownDisplayResource = (reference: string, pageURL: string, sessionId?: string): boolean => {
    if (hasControlCharacter(reference)) return false;
    if (reference.startsWith("blob:")) return true;
    try {
        const resource = new URL(reference);
        const page = new URL(pageURL);
        if (resource.protocol !== page.protocol || resource.host !== page.host || resource.username || resource.password ||
            resource.search || resource.hash) return false;
        if (resource.protocol === "siyuan-markdown:") return /^\/resource\/[\w-]+$/.test(resource.pathname);
        // Android 和 Harmony 通过固定 HTTPS 来源在宿主内部响应，必须再次限定当前会话。
        return page.origin === "https://siyuan-markdown.local" && Boolean(sessionId) &&
            /^[\w-]+$/.test(sessionId) && resource.pathname.startsWith(`/resource/${sessionId}/`) &&
            /^\/resource\/[\w-]+\/[\w-]+$/.test(resource.pathname);
    } catch {
        return false;
    }
};

export const isExternalMarkdownLink = (reference: string): boolean =>
    /^(?:https?:\/\/|mailto:)/i.test(reference) && !hasControlCharacter(reference);

// 显示替换只存在于该编辑器实例；转换回 Markdown 前在惰性副本中还原原属性。
export const createMarkdownResourcePolicy = (document: Document, resolveResource?: MarkdownResourceResolver,
    onUnavailable?: () => void, sessionId?: string) => {
    const scope = createMarkdownInstanceId();
    let generation = 0;
    let disposed = false;
    const resources = new Map<string, Promise<string | undefined>>();
    const preservedValues = new Map<string, string>();
    const preservedTokens = new Map<string, string>();
    let preservedBytes = 0;
    const preserve = (element: Element, value: PreservedMarkup) => {
        const serialized = JSON.stringify(value);
        let token = preservedTokens.get(serialized);
        // Do not duplicate long URLs/HTML in every rendered node and parser input.
        // Retain old mappings for editor undo; the bounded fallback remains lossless.
        if (!token && preservedValues.size < 4096 && preservedBytes + serialized.length * 2 <= 8 * 1024 * 1024) {
            token = `${scope}:${preservedValues.size}`;
            preservedValues.set(token, serialized);
            preservedTokens.set(serialized, token);
            preservedBytes += serialized.length * 2;
        }
        element.setAttribute(preservationAttribute, token ?? serialized);
    };

    const readPreserved = (element: Element): PreservedMarkup | undefined => {
        try {
            const attribute = element.getAttribute(preservationAttribute) ?? "null";
            const data = JSON.parse(preservedValues.get(attribute) ?? attribute) as PreservedMarkup;
            if (!data || data.scope !== scope || (data.html !== undefined && typeof data.html !== "string")) return;
            if (data.attributes && (!Array.isArray(data.attributes) || data.attributes.some(attribute =>
                typeof attribute.name !== "string" || typeof attribute.original !== "string" ||
                (attribute.displayed !== null && typeof attribute.displayed !== "string")))) return;
            return data;
        } catch {
            return;
        }
    };

    const restore = (html: string): string => {
        if (!html.includes(preservationAttribute)) return html;
        const template = document.createElement("template");
        template.innerHTML = html;
        template.content.querySelectorAll(`[${preservationAttribute}]`).forEach(element => {
            const preserved = readPreserved(element);
            if (!preserved) return;
            if (preserved.html !== undefined) {
                const original = document.createElement("template");
                original.innerHTML = preserved.html;
                element.replaceWith(original.content);
                return;
            }
            preserved.attributes?.forEach(attribute => {
                // 图片地址被用户改过时，保留新输入，不能拿显示映射覆盖用户修改。
                if (element.getAttribute(attribute.name) === attribute.displayed) {
                    element.setAttribute(attribute.name, attribute.original);
                } else if (attribute.name === "class" && attribute.displayed) {
                    const actual = (element.getAttribute("class") ?? "").split(/\s+/);
                    const displayed = attribute.displayed.split(/\s+/);
                    if (displayed.every(value => actual.includes(value))) {
                        element.setAttribute("class", [attribute.original, ...actual.filter(value => !displayed.includes(value))].join(" "));
                    }
                }
            });
            element.removeAttribute(preservationAttribute);
        });
        return template.innerHTML;
    };

    const sanitize = (html: string): string => {
        const template = document.createElement("template");
        template.innerHTML = restore(html);
        const elements = Array.from(template.content.querySelectorAll("*"));
        elements.forEach(element => {
            if (!template.content.contains(element)) return;
            if (blockedElements.has(element.tagName) ||
                (element.tagName === "INPUT" && element.getAttribute("type") !== "checkbox")) {
                const replacement = document.createElement("span");
                replacement.textContent = element.outerHTML;
                replacement.setAttribute("contenteditable", "false");
                preserve(replacement, {scope, html: element.outerHTML});
                element.replaceWith(replacement);
                return;
            }
            const attributes: PreservedMarkup["attributes"] = [];
            for (const attribute of Array.from(element.attributes)) {
                const name = attribute.name.toLowerCase();
                if (resourceAttributes.has(name) || name.startsWith("on") || name === "srcdoc" ||
                    (name === "style" && /url\s*\(|@import|expression|behavior|\\/i.test(attribute.value))) {
                    attributes.push({name, original: attribute.value, displayed: null});
                    element.removeAttribute(attribute.name);
                }
            }
            const className = element.getAttribute("class");
            if (className) {
                const safeClassName = className.replace(diagramLanguages, "language-text");
                if (className !== safeClassName) {
                    attributes.push({name: "class", original: className, displayed: safeClassName});
                    element.setAttribute("class", safeClassName);
                }
            }
            if (attributes.length) preserve(element, {scope, attributes});
        });
        return template.innerHTML;
    };

    const hydrate = (root: HTMLElement): void => {
        if (!resolveResource || disposed) return;
        const expectedGeneration = generation;
        root.querySelectorAll<HTMLImageElement>(`img[${preservationAttribute}]`).forEach(element => {
            const preserved = readPreserved(element);
            const source = preserved?.attributes?.find(attribute => attribute.name === "src");
            if (!source || !isRelativeMarkdownResource(source.original) || element.getAttribute("src") !== source.displayed) return;
            if (source.displayed !== null) return;
            let pending = resources.get(source.original);
            if (!pending) {
                pending = Promise.resolve().then(() => resolveResource(source.original)).then(url =>
                    url && isMarkdownDisplayResource(url, document.location.href, sessionId) ? url : undefined).catch((): undefined => undefined);
                void pending.then(url => { if (!url && !disposed && generation === expectedGeneration) onUnavailable?.(); });
                resources.set(source.original, pending);
            }
            void pending.then(url => {
                if (!url || disposed || generation !== expectedGeneration || !root.contains(element)) return;
                const current = readPreserved(element);
                const attribute = current?.attributes?.find(value => value.name === "src");
                if (!attribute || attribute.original !== source.original || element.getAttribute("src") !== attribute.displayed) return;
                attribute.displayed = url;
                preserve(element, current);
                element.setAttribute("src", url);
            });
        });
    };

    return {
        sanitize,
        restore,
        hydrate,
        originalAttribute(element: Element, name: string): string | null {
            const attribute = readPreserved(element)?.attributes?.find(value => value.name === name);
            if (attribute && element.getAttribute(name) === attribute.displayed) return attribute.original;
            return element.getAttribute(name);
        },
        reset(): void {
            generation++;
            resources.clear();
            preservedValues.clear();
            preservedTokens.clear();
            preservedBytes = 0;
        },
        refresh(root: HTMLElement): void {
            generation++;
            resources.clear();
            root.querySelectorAll<HTMLImageElement>(`img[${preservationAttribute}]`).forEach(element => {
                const preserved = readPreserved(element);
                const source = preserved?.attributes?.find(attribute => attribute.name === "src");
                if (!source || element.getAttribute("src") !== source.displayed) return;
                source.displayed = null;
                element.removeAttribute("src");
                preserve(element, preserved);
            });
            hydrate(root);
        },
        destroy(): void {
            disposed = true;
            generation++;
            resources.clear();
            preservedValues.clear();
            preservedTokens.clear();
        },
    };
};
