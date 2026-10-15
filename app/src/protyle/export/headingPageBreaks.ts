export const normalizeHeadingPageBreakLevels = (levels: unknown): number[] => {
    return Array.isArray(levels) ? [1, 2, 3, 4, 5, 6].filter(level => levels.includes(level)) : [];
};

export const applyExportHeadingPageBreaks = (root: HTMLElement, levels: unknown, enabled = true) => {
    root.querySelectorAll("[data-export-heading-page-break]").forEach(element => {
        element.removeAttribute("data-export-heading-page-break");
    });
    const selected = normalizeHeadingPageBreakLevels(levels);
    if (!enabled || selected.length === 0) {
        return;
    }

    let hasContent = false;
    let previousHeading = false;
    const visit = (element: Element) => {
        if (element.matches("script, style, .protyle-attr, .protyle-action, [hidden], .fn__none") ||
            getComputedStyle(element).display === "none") {
            return;
        }
        const type = element.getAttribute("data-type");
        const heading = type === "NodeHeading" || /^H[1-6]$/.test(element.tagName);
        if (heading) {
            const level = Number(type === "NodeHeading" ? element.getAttribute("data-subtype")?.slice(1) :
                element.tagName.slice(1));
            // 首个内容块和连续标题不强制分页，避免空白首页和只有标题的页面。
            if (hasContent && !previousHeading && selected.includes(level)) {
                element.setAttribute("data-export-heading-page-break", "true");
            }
            hasContent = true;
            previousHeading = true;
            return;
        }
        if (type === "NodeParagraph" || element.tagName === "P") {
            if (!element.textContent.replace(/[\s\u200B-\u200D\uFEFF]/g, "") &&
                !element.querySelector("img, svg, canvas, audio, video, iframe, input")) {
                return;
            }
        } else if (!type || ["NodeSuperBlock", "NodeBlockquote", "NodeList", "NodeListItem", "NodeCallout",
            "NodeBlockQueryEmbed"].includes(type)) {
            // 按阅读顺序遍历容器，保留超级块、列表和引述中的标题与正文关系。
            element.childNodes.forEach(child => {
                if (child instanceof Element) {
                    visit(child);
                } else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
                    hasContent = true;
                    previousHeading = false;
                }
            });
            if (!element.matches("img, svg, canvas, audio, video, iframe, hr, input")) {
                return;
            }
        }
        hasContent = true;
        previousHeading = false;
    };
    Array.from(root.children).forEach(visit);
};
