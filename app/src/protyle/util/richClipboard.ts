import {Constants} from "../../constants";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

interface IRichClipboardSource {
    element: HTMLImageElement;
    index: number;
    path: string;
    box: string;
}

interface IRichClipboardPrepared {
    batch: string;
    groups: string[];
    assets: {
        index: number;
        path: string;
    }[];
}

interface IRichClipboardOptions {
    marker?: string;
    removeMarker?: boolean;
}

const richClipboardImageExts = new Set([
    "apng",
    "avif",
    "bmp",
    "cur",
    "gif",
    "ico",
    "jfif",
    "jpe",
    "jpeg",
    "jpg",
    "pjp",
    "pjpeg",
    "png",
    "webp",
]);

const richClipboardAttributes = new Set([
    "align",
    "alt",
    "checked",
    "colspan",
    "controls",
    "height",
    "href",
    "poster",
    "rowspan",
    "src",
    "start",
    "style",
    "target",
    "title",
    "type",
    "width",
]);

const richClipboardLineTags = new Set([
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "P",
    "PRE",
]);

const richClipboardTextMarkTags = new Map([
    ["a", "a"],
    ["code", "code"],
    ["em", "em"],
    ["kbd", "kbd"],
    ["mark", "mark"],
    ["s", "s"],
    ["strong", "strong"],
    ["sub", "sub"],
    ["sup", "sup"],
    ["u", "u"],
]);

const convertRichClipboardTextMarks = (template: HTMLTemplateElement) => {
    template.content.querySelectorAll<HTMLElement>("span[data-type]").forEach(element => {
        const tags = element.dataset.type.split(/\s+/)
            .map(type => richClipboardTextMarkTags.get(type))
            .filter((tag): tag is string => Boolean(tag));
        if (tags.length === 0) {
            return;
        }

        const replacement = document.createElement(tags[0]);
        let current = replacement;
        tags.slice(1).forEach(tag => {
            const tagElement = document.createElement(tag);
            current.append(tagElement);
            current = tagElement;
        });
        const linkElement = replacement.matches("a") ? replacement : replacement.querySelector("a");
        if (linkElement) {
            linkElement.setAttribute("href", element.dataset.href || element.getAttribute("href") || "");
            const title = element.dataset.title || element.getAttribute("title");
            if (title) {
                linkElement.setAttribute("title", title);
            }
        }
        current.append(...Array.from(element.childNodes));
        const style = element.getAttribute("style");
        if (style) {
            replacement.setAttribute("style", style);
        }
        element.replaceWith(replacement);
    });
};

const getTableSourceLines = (tableElement: HTMLTableElement) => {
    const lines: string[] = [];
    tableElement.querySelectorAll("tr").forEach(rowElement => {
        const cells = Array.from(rowElement.children).filter(item =>
            item.tagName === "TH" || item.tagName === "TD") as HTMLElement[];
        if (cells.length > 0) {
            lines.push(cells.map(item => item.innerHTML.trim()).join("\t"));
        }
    });
    return lines;
};

const getListItemSourceLines = (listItemElement: HTMLLIElement) => {
    const lines: string[] = [];
    const inlineElement = document.createElement("div");
    listItemElement.childNodes.forEach(item => {
        if (item.nodeType === Node.ELEMENT_NODE &&
            ["OL", "UL"].includes((item as HTMLElement).tagName)) {
            return;
        }
        if (item.nodeType === Node.ELEMENT_NODE &&
            richClipboardLineTags.has((item as HTMLElement).tagName)) {
            if (inlineElement.innerHTML.trim()) {
                lines.push(inlineElement.innerHTML.trim());
                inlineElement.replaceChildren();
            }
            lines.push((item as HTMLElement).innerHTML.trim());
        } else {
            inlineElement.append(item.cloneNode(true));
        }
    });
    if (inlineElement.innerHTML.trim()) {
        lines.push(inlineElement.innerHTML.trim());
    }
    listItemElement.querySelectorAll(":scope > ul, :scope > ol").forEach(item => {
        lines.push(...getRichClipboardSourceLines(item));
    });
    return lines;
};

const getRichClipboardSourceLines = (parent: ParentNode) => {
    const lines: string[] = [];
    parent.childNodes.forEach(item => {
        if (item.nodeType === Node.TEXT_NODE) {
            if (item.textContent.trim()) {
                const textElement = document.createElement("div");
                textElement.textContent = item.textContent;
                lines.push(textElement.innerHTML);
            }
            return;
        }
        if (item.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        const element = item as HTMLElement;
        if (richClipboardLineTags.has(element.tagName)) {
            lines.push(element.innerHTML.trim());
        } else if (element.tagName === "TABLE") {
            lines.push(...getTableSourceLines(element as HTMLTableElement));
        } else if (element.tagName === "LI") {
            lines.push(...getListItemSourceLines(element as HTMLLIElement));
        } else if (element.children.length > 0) {
            lines.push(...getRichClipboardSourceLines(element));
        } else if (element.outerHTML.trim()) {
            lines.push(element.outerHTML.trim());
        }
    });
    return lines.filter(line => line);
};

export const prepareRichClipboardHTML = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    convertRichClipboardTextMarks(template);
    template.content.querySelectorAll("*").forEach(element => {
        Array.from(element.attributes).forEach(attribute => {
            if (!richClipboardAttributes.has(attribute.name) &&
                !(attribute.name === "class" && attribute.value.split(/\s+/).every(item => item.startsWith("language-")))) {
                element.removeAttribute(attribute.name);
            }
        });
    });
    return {
        html: template.innerHTML.trim(),
        source: getRichClipboardSourceLines(template.content).join("\n"),
    };
};

const postRichClipboard = async (url: string, data: Record<string, unknown>) => {
    const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(data),
    });
    return response.json() as Promise<IWebSocketData>;
};

const cleanupRichClipboard = async (prepared: IRichClipboardPrepared) => {
    try {
        await postRichClipboard("/api/clipboard/cleanupRichText", {
            batch: prepared.batch,
            groups: prepared.groups,
        });
    } catch (e) {
        console.warn("Cleanup rich clipboard error:", e);
    }
};

const getRichClipboardSources = (template: HTMLTemplateElement, notebookID: string) => {
    const sources: IRichClipboardSource[] = [];
    template.content.querySelectorAll("img[src]").forEach((element: HTMLImageElement) => {
        const src = element.getAttribute("src")?.trim();
        if (!src) {
            return;
        }

        let assetPath: string;
        if (src.startsWith("assets/")) {
            assetPath = src;
        } else if (src.startsWith("./assets/")) {
            assetPath = src.substring(2);
        } else if (src.startsWith("/assets/")) {
            assetPath = src.substring(1);
        } else {
            try {
                const url = new URL(src, window.location.href);
                if (url.origin !== window.location.origin || !url.pathname.startsWith("/assets/")) {
                    return;
                }
                assetPath = url.pathname.substring(1) + url.search;
            } catch {
                return;
            }
        }
        const hashStart = assetPath.indexOf("#");
        if (hashStart > -1) {
            assetPath = assetPath.substring(0, hashStart);
        }

        const pathWithoutQuery = assetPath.split("?", 1)[0];
        const ext = pathWithoutQuery.substring(pathWithoutQuery.lastIndexOf(".") + 1).toLowerCase();
        if (!richClipboardImageExts.has(ext)) {
            return;
        }

        const queryStart = assetPath.indexOf("?");
        const queryEnd = assetPath.indexOf("#", queryStart);
        const query = queryStart > -1 ? assetPath.substring(queryStart + 1, queryEnd > -1 ? queryEnd : undefined) : "";
        sources.push({
            element,
            index: sources.length,
            path: assetPath,
            box: new URLSearchParams(query).get("box") || notebookID,
        });
    });
    return sources;
};

export const hasRichClipboardImages = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return getRichClipboardSources(template, "").length > 0;
};

export const enhanceRichClipboard = (text: string, html: string, notebookID: string, options: IRichClipboardOptions = {}) => {
    /// #if !BROWSER
    window.setTimeout(async () => {
        const template = document.createElement("template");
        template.innerHTML = html;
        const sources = getRichClipboardSources(template, notebookID);
        if (sources.length === 0 || 1024 < sources.length) {
            return;
        }

        const marker = options.marker || html.match(/<!--data-siyuan='[^']+'-->/)?.[0];
        if (!marker) {
            return;
        }

        let token: string;
        try {
            token = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "beginRichClipboard",
                text,
                marker,
            });
        } catch (e) {
            console.warn("Begin rich clipboard error:", e);
            return;
        }
        if (!token) {
            return;
        }

        let prepared: IRichClipboardPrepared | undefined;
        try {
            const response = await postRichClipboard("/api/clipboard/prepareRichText", {
                assets: sources.map((source) => ({
                    index: source.index,
                    path: source.path,
                    box: source.box,
                })),
            });
            prepared = response.code === 0 ? response.data as IRichClipboardPrepared : undefined;
            if (!prepared?.batch || !Array.isArray(prepared.groups) || !Array.isArray(prepared.assets)) {
                await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                    cmd: "cancelRichClipboard",
                    token,
                });
                return;
            }
        } catch (e) {
            await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "cancelRichClipboard",
                token,
            });
            console.warn("Prepare rich clipboard error:", e);
            return;
        }

        const replacements: { placeholder: string; path: string }[] = [];
        const preparedIndexes = new Set<number>();
        for (const asset of prepared.assets) {
            const source = sources[asset.index];
            if (!source || preparedIndexes.has(asset.index) || typeof asset.path !== "string" || !asset.path) {
                await cleanupRichClipboard(prepared);
                await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                    cmd: "cancelRichClipboard",
                    token,
                });
                return;
            }
            preparedIndexes.add(asset.index);
            const placeholder = `siyuan-rich-clipboard-${prepared.batch}-${asset.index}`;
            source.element.setAttribute("src", placeholder);
            replacements.push({
                placeholder,
                path: asset.path,
            });
        }
        if (preparedIndexes.size !== sources.length) {
            await cleanupRichClipboard(prepared);
            await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "cancelRichClipboard",
                token,
            });
            return;
        }

        try {
            let clipboardHTML = template.innerHTML;
            if (options.removeMarker) {
                clipboardHTML = clipboardHTML.replace(marker, "");
            }
            const written = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "completeRichClipboard",
                token,
                text,
                html: clipboardHTML,
                replacements,
            });
            if (!written) {
                await cleanupRichClipboard(prepared);
            }
        } catch (e) {
            await cleanupRichClipboard(prepared);
            console.warn("Complete rich clipboard error:", e);
        }
    }, 0);
    /// #endif
};
