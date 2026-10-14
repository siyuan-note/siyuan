export const getSuperBlockCommand = (layout: "col" | "row") => `superblock:${layout}`;

export const getSuperBlockCommandLayout = (value: string): "col" | "row" | undefined => {
    if (value === getSuperBlockCommand("col")) {
        return "col";
    }
    if (value === getSuperBlockCommand("row")) {
        return "row";
    }
};

// 末尾新段落位于这些标题的范围内，展开其中折叠的标题后才能持续显示。
export const getSuperBlockTailHeadings = (element: Element) => {
    const headings: Element[] = [];
    Array.from(element.children).forEach(child => {
        if (child.getAttribute("data-type") !== "NodeHeading") {
            return;
        }
        const level = Number(child.getAttribute("data-subtype")?.substring(1));
        while (headings.length > 0 && Number(headings[headings.length - 1].getAttribute("data-subtype")?.substring(1)) >= level) {
            headings.pop();
        }
        headings.push(child);
    });
    return headings.filter(heading => heading.getAttribute("fold") === "1");
};

export const getHorizontalSuperBlockChild = (blockElement?: Element | null, boundaryElement?: Element) => {
    let currentElement = blockElement;
    while (currentElement?.parentElement && currentElement !== boundaryElement) {
        const parentElement = currentElement.parentElement;
        if (parentElement.getAttribute("data-type") === "NodeSuperBlock" &&
            parentElement.getAttribute("data-sb-layout") === "col") {
            return currentElement.hasAttribute("data-node-id") ? currentElement : undefined;
        }
        currentElement = parentElement;
    }
};
