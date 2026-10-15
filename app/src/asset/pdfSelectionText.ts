export const getPdfSelectionText = (range: Range) => {
    const parts: string[] = [];
    const append = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.textContent || "");
            return;
        }
        if (node instanceof HTMLElement) {
            if (node.classList.contains("endOfContent") || node.classList.contains("pdf__rects")) {
                return;
            }
            if (node.tagName === "BR") {
                parts.push("\n");
                return;
            }
        }
        node.childNodes.forEach(append);
    };
    // 保留嵌套文字层和搜索高亮中的换行，再合并跨行单词，不修改原始选区。
    append(range.cloneContents());
    return parts.join("")
        .replace(/\r\n?/g, "\n")
        .replace(/([A-Za-z])[-\u00ad]\n(?=[A-Za-z])/g, "$1")
        .replace(/([A-Za-z])\n(?=[A-Za-z])/g, "$1 ")
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00\n]/g, "");
};
