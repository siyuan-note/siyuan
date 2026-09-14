export const removeFoldHeading = (nodeElement: Element) => {
    const nodeH = parseInt(nodeElement.getAttribute("data-subtype").substr(1));
    let nextElement = nodeElement.nextElementSibling;
    while (nextElement) {
        const currentH = parseInt(nextElement.getAttribute("data-subtype")?.substr(1));
        if (!nextElement.classList.contains("protyle-attr") && // 超级块末尾为属性
            (isNaN(currentH) || currentH > nodeH)) {
            const tempElement = nextElement;
            nextElement = nextElement.nextElementSibling;
            tempElement.remove();
        } else {
            break;
        }
    }
};

export const getFocusedHeadingChildren = (content: DocumentFragment, id: string) => {
    const heading = content.firstElementChild;
    if (heading?.getAttribute("data-node-id") !== id || heading.getAttribute("data-type") !== "NodeHeading") {
        return;
    }
    const folded = heading.getAttribute("fold") === "1";
    // 聚焦标题自身不参与筛选，子标题仍按普通编辑器的折叠规则省略下方内容。
    heading.remove();
    Array.from(content.querySelectorAll('[data-type="NodeHeading"][fold="1"]')).reverse().forEach(removeFoldHeading);
    return {folded, children: Array.from(content.children)};
};
