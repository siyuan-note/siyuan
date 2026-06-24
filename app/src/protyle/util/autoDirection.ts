const RTL_RE = /[\u0590-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
const LTR_RE = /[A-Za-z]/u;

const AUTO_SKIP_TYPES = new Set([
    "NodeCodeBlock", "NodeMathBlock", "NodeHTMLBlock", "NodeIFrame",
    "NodeWidget", "NodeVideo", "NodeAudio", "NodeThematicBreak",
    "NodeBlockQueryEmbed", "NodeAttributeView", "NodeTable", "NodeDocument",
    "NodeList", "NodeSuperBlock", "NodeBlockquote", "NodeListItem",
]);

export const detectTextDirection = (text: string): "rtl" | "ltr" | undefined => {
    const normalized = (text || "")
        .normalize("NFKC")
        .replace(/[\p{Number}\p{White_Space}\p{Punctuation}\p{Symbol}]+/gu, "")
        .replace(/[\u200C\u200F\u202A-\u202E]/g, "");

    for (const char of normalized) {
        if (RTL_RE.test(char)) return "rtl";
        if (LTR_RE.test(char)) return "ltr";
    }

    return undefined;
};

export const shouldSkipAutoDirection = (block: HTMLElement): boolean => {
    const type = block.getAttribute("data-type");
    if (!type) return true;
    return AUTO_SKIP_TYPES.has(type);
};

export const autoDirRender = (protyle: IProtyle): void => {
    if (!window.siyuan?.config?.editor?.autoTextDirection) return;
    protyle.wysiwyg.element.querySelectorAll("[data-node-id]").forEach((block: HTMLElement) => {
        applyAutoDirection(block);
    });
};

export const clearAutoDirectionMarker = (block: HTMLElement): void => {
    delete block.dataset.autoTextDirection;
};

export const clearAutoDirectionStyle = (block: HTMLElement): void => {
    delete block.dataset.autoTextDirection;
    block.removeAttribute("dir");
    block.style.direction = "";
    block.style.textAlign = "";
    block.style.unicodeBidi = "";
};

export const clearManualOverride = (block: HTMLElement): void => {
    delete block.dataset.manualTextDirection;
    clearAutoDirectionStyle(block);
};

export const applyAutoDirection = (block: HTMLElement): void => {
    if (!window.siyuan?.config?.editor?.autoTextDirection) return;
    if (shouldSkipAutoDirection(block)) return;

    if (block.dataset.manualTextDirection === "true") return;

    if ((block.style.direction || block.style.textAlign) && !block.dataset.autoTextDirection) {
        return;
    }

    const dir = detectTextDirection(block.textContent || "");

    if (!dir) {
        if (block.dataset.autoTextDirection) {
            clearAutoDirectionStyle(block);
        }
        return;
    }

    if (block.dataset.autoTextDirection === dir && block.style.direction === dir) {
        return;
    }

    block.setAttribute("dir", dir);
    block.style.direction = dir;
    block.style.textAlign = dir === "rtl" ? "right" : "left";
    block.style.unicodeBidi = "isolate";
    block.dataset.autoTextDirection = dir;
};
