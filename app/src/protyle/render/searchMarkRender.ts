export const searchMarkRender = (protyle: IProtyle, matchElements: NodeListOf<Element>) => {
    if (matchElements.length === 0) {
        return;
    }
    protyle.highlight.markHL.clear();
    protyle.highlight.markHL.clear();
    protyle.highlight.ranges = [];
    matchElements.forEach((item, index) => {
        const range = new Range();
        if (item.getAttribute("data-type") === "search-mark") {
            const contentElement = item.firstChild;
            item.replaceWith(contentElement);
            range.selectNodeContents(contentElement);
        } else {
            item.setAttribute("data-type", item.getAttribute("data-type").replace(" search-mark", "").replace("search-mark ", ""));
            range.selectNodeContents(item);
        }
        if (index === protyle.highlight.rangeIndex && !protyle.options.backlinkData) {
            protyle.highlight.markHL.add(range);
        } else {
            protyle.highlight.mark.add(range);
        }
        protyle.highlight.ranges.push(range);
    });
    CSS.highlights.set("search-mark-" + protyle.highlight.styleElement.dataset.uuid, protyle.highlight.mark);
    if (!protyle.options.backlinkData) {
        CSS.highlights.set("search-mark-hl-" + protyle.highlight.styleElement.dataset.uuid, protyle.highlight.markHL);
    }
};
