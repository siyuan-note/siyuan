export const isListHeadingContainer = (element: Element) =>
    ["NodeList", "NodeListItem"].includes(element.getAttribute("data-type"));

export const getHeadingConversionElements = (elements: Element[]) => {
    const targets = new Set<Element>();
    const addListItem = (item: Element) => {
        // 只转换列表项的直接首块，保留后续段落及子列表。
        const firstBlock = Array.from(item.children).find(child => child.hasAttribute("data-node-id"));
        if (firstBlock && ["NodeParagraph", "NodeHeading"].includes(firstBlock.getAttribute("data-type"))) {
            targets.add(firstBlock);
        }
    };
    elements.forEach(element => {
        const type = element.getAttribute("data-type");
        if (type === "NodeList") {
            Array.from(element.children).forEach(child => {
                if (child.getAttribute("data-type") === "NodeListItem") {
                    addListItem(child);
                }
            });
        } else if (type === "NodeListItem") {
            addListItem(element);
        } else {
            targets.add(element);
        }
    });
    const result = Array.from(targets);
    return result.filter(target => !result.some(parent =>
        parent !== target && parent.contains(target)));
};
