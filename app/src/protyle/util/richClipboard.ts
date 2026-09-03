import {Constants} from "../../constants";
import {looseJsonParse} from "../../util/functions";
import {getHostCapabilities} from "../../util/hostCapabilities";
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
    "cellpadding",
    "cellspacing",
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

const getRichClipboardImageURL = (imageElement: HTMLImageElement) => {
    const src = imageElement.getAttribute("src")?.trim();
    if (!src) {
        return "";
    }
    try {
        return new URL(src, window.location.href).href;
    } catch {
        return src;
    }
};

const getRichClipboardPixelWidth = (width: string | null | undefined) => {
    if (!width || (!/^\d+(?:\.\d+)?(?:px)?$/i.test(width.trim()))) {
        return 0;
    }
    return parseFloat(width);
};

const normalizeRichClipboardImages = (template: HTMLTemplateElement) => {
    const sourceImages = new Map<string, HTMLImageElement[]>();
    Array.from(document.images).forEach(imageElement => {
        const rect = imageElement.getBoundingClientRect();
        const url = getRichClipboardImageURL(imageElement);
        if (!url || rect.width <= 0 || rect.height <= 0) {
            return;
        }
        const images = sourceImages.get(url) || [];
        images.push(imageElement);
        sourceImages.set(url, images);
    });

    let normalized = false;
    template.content.querySelectorAll<HTMLImageElement>("img[src]:not(.emoji)").forEach(imageElement => {
        const parentWidth = imageElement.parentElement?.style.width || "";
        let width = getRichClipboardPixelWidth(imageElement.style.width) ||
            getRichClipboardPixelWidth(imageElement.getAttribute("width")) ||
            getRichClipboardPixelWidth(parentWidth);
        if (!width) {
            const candidates = sourceImages.get(getRichClipboardImageURL(imageElement)) || [];
            const sourceImage = candidates.find(candidate => candidate.parentElement?.style.width === parentWidth) ||
                candidates[0];
            width = sourceImage?.getBoundingClientRect().width || 0;
        }

        imageElement.style.maxWidth = "600px";
        imageElement.style.height = "auto";
        imageElement.removeAttribute("height");
        if (width > 0) {
            const normalizedWidth = Math.min(600, Math.round(width));
            imageElement.style.width = `${normalizedWidth}px`;
            imageElement.setAttribute("width", normalizedWidth.toString());
        }
        normalized = true;
    });
    return normalized;
};

const getRichClipboardTableColumnCount = (tableElement: HTMLTableElement) => {
    const firstRow = tableElement.rows[0];
    if (!firstRow) {
        return 0;
    }
    return Array.from(firstRow.cells).reduce((count, cell) => {
        return count + Math.max(1, parseInt(cell.getAttribute("colspan") || "1"));
    }, 0);
};

const normalizeRichClipboardTableSize = (tableElement: HTMLTableElement) => {
    const columnCount = getRichClipboardTableColumnCount(tableElement);
    if (columnCount === 0) {
        return;
    }

    let colgroupElement = tableElement.querySelector<HTMLTableColElement>(":scope > colgroup");
    if (!colgroupElement) {
        colgroupElement = document.createElement("colgroup");
        tableElement.prepend(colgroupElement);
    }
    const columnElements = Array.from(colgroupElement.querySelectorAll<HTMLTableColElement>(":scope > col"));
    while (columnElements.length < columnCount) {
        const columnElement = document.createElement("col");
        colgroupElement.append(columnElement);
        columnElements.push(columnElement);
    }

    const columnWidths = columnElements.slice(0, columnCount).map(columnElement => {
        const width = parseFloat(columnElement.style.width || columnElement.style.minWidth ||
            columnElement.getAttribute("width") || "");
        return Math.max(80, Number.isFinite(width) ? width : 80);
    });
    const sourceWidth = columnWidths.reduce((width, columnWidth) => width + columnWidth, 0);
    const targetWidth = Math.min(540, Math.max(360, sourceWidth));
    const scale = targetWidth / sourceWidth;
    const normalizedWidths = columnWidths.map(columnWidth => Math.round(columnWidth * scale));

    columnElements.slice(0, columnCount).forEach((columnElement, index) => {
        const width = normalizedWidths[index];
        columnElement.style.width = `${width}px`;
        columnElement.style.minWidth = "";
        columnElement.setAttribute("width", width.toString());
    });
    let columnIndex = 0;
    Array.from(tableElement.rows[0].cells).forEach(cellElement => {
        const colspan = Math.max(1, parseInt(cellElement.getAttribute("colspan") || "1"));
        const width = normalizedWidths.slice(columnIndex, columnIndex + colspan)
            .reduce((cellWidth, columnWidth) => cellWidth + columnWidth, 0);
        cellElement.style.width = `${width}px`;
        cellElement.setAttribute("width", width.toString());
        columnIndex += colspan;
    });

    tableElement.setAttribute("width", "100%");
    tableElement.setAttribute("cellpadding", "0");
    tableElement.setAttribute("cellspacing", "0");
    tableElement.style.tableLayout = "fixed";
    tableElement.style.fontSize = "14px";
    tableElement.style.lineHeight = "1.5";
};

const normalizeRichClipboardTableBorders = (template: HTMLTemplateElement) => {
    let normalized = false;
    template.content.querySelectorAll<HTMLTableElement>("table").forEach(tableElement => {
        normalizeRichClipboardTableSize(tableElement);
        tableElement.setAttribute("border", "1");
        tableElement.style.borderCollapse = "collapse";
        tableElement.style.border = "1px solid #000";
        tableElement.querySelectorAll<HTMLElement>("th, td").forEach(cellElement => {
            cellElement.style.border = "1px solid #000";
            cellElement.style.boxSizing = "border-box";
            cellElement.style.height = "28px";
            cellElement.style.padding = "4px 8px";
            cellElement.style.verticalAlign = "middle";
        });
        normalized = true;
    });
    return normalized;
};

const normalizeRichClipboardFontColors = (template: HTMLTemplateElement) => {
    const elements = Array.from(template.content.querySelectorAll<HTMLElement>("[style]"))
        .filter(element => element.style.color.includes("var("));
    if (elements.length === 0 || !document.body) {
        return false;
    }

    const probeElement = document.createElement("span");
    probeElement.style.position = "fixed";
    probeElement.style.visibility = "hidden";
    probeElement.style.pointerEvents = "none";
    document.body.append(probeElement);
    elements.forEach(element => {
        probeElement.style.color = "";
        probeElement.style.color = element.style.color;
        const color = getComputedStyle(probeElement).color;
        if (color) {
            element.style.color = color;
        }
    });
    probeElement.remove();
    return true;
};

const convertRichClipboardMath = (template: HTMLTemplateElement) => {
    if (typeof window.katex?.renderToString !== "function") {
        return false;
    }

    let macros = {};
    try {
        macros = looseJsonParse(window.siyuan.config.editor.katexMacros || "{}");
    } catch (e) {
        console.warn("KaTex macros is not JSON", e);
    }

    let converted = false;
    template.content.querySelectorAll<HTMLElement>(
        '[data-subtype="math"][data-content], span.language-math, div.language-math'
    ).forEach(element => {
        if (!template.content.contains(element)) {
            return;
        }
        const math = element.getAttribute("data-content") || element.textContent;
        if (!math) {
            return;
        }
        const displayMode = element.tagName === "DIV";
        try {
            const mathTemplate = document.createElement("template");
            mathTemplate.innerHTML = window.katex.renderToString(math, {
                displayMode,
                output: "mathml",
                macros,
                trust: true,
                strict: (errorCode) => errorCode === "unicodeTextInMathMode" ? "ignore" : "warn",
            });
            const mathElement = mathTemplate.content.querySelector("math");
            if (!mathElement) {
                return;
            }
            const semanticsElement = mathElement.firstElementChild;
            if (semanticsElement?.localName === "semantics" && semanticsElement.firstElementChild) {
                semanticsElement.replaceWith(semanticsElement.firstElementChild);
            }
            if (displayMode) {
                mathElement.setAttribute("display", "block");
            }
            element.replaceWith(mathElement);
            converted = true;
        } catch (e) {
            console.warn("Convert rich clipboard math error:", e);
        }
    });
    return converted;
};

export const prepareExternalClipboardHTML = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const textMarksConverted = convertRichClipboardTextMarks(template);
    const mathConverted = convertRichClipboardMath(template);
    const imagesNormalized = normalizeRichClipboardImages(template);
    const tableBordersNormalized = normalizeRichClipboardTableBorders(template);
    const fontColorsNormalized = normalizeRichClipboardFontColors(template);
    return textMarksConverted || mathConverted || imagesNormalized || tableBordersNormalized || fontColorsNormalized ?
        template.innerHTML : html;
};

export const hasRichClipboardMath = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return Boolean(template.content.querySelector(
        '[data-subtype="math"][data-content], span.language-math, div.language-math'
    ));
};

export const hasRichClipboardTables = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return Boolean(template.content.querySelector("table"));
};

const convertRichClipboardTextMarks = (template: HTMLTemplateElement) => {
    let converted = false;
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
        converted = true;
    });
    return converted;
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
    normalizeRichClipboardImages(template);
    const source = getRichClipboardSourceLines(template.content).join("\n");
    convertRichClipboardMath(template);
    template.content.querySelectorAll("*").forEach(element => {
        if (element.closest("math")) {
            return;
        }
        Array.from(element.attributes).forEach(attribute => {
            if (!richClipboardAttributes.has(attribute.name) &&
                !(attribute.name === "class" && attribute.value.split(/\s+/).every(item => item.startsWith("language-")))) {
                element.removeAttribute(attribute.name);
            }
        });
    });
    normalizeRichClipboardTableBorders(template);
    normalizeRichClipboardFontColors(template);
    return {
        html: template.innerHTML.trim(),
        source,
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
    if (!getHostCapabilities().localFileSystem) {
        return;
    }
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
