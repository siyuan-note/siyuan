export const isFoldedHeading = (element?: Element) =>
    element?.getAttribute("data-type") === "NodeHeading" && element.getAttribute("fold") === "1";

const getHeadingLevel = (element: Element) => {
    const subtype = element.getAttribute("data-subtype");
    if (!subtype?.startsWith("h")) {
        return NaN;
    }
    return Number.parseInt(subtype.substring(1));
};

export const shouldUnfoldMovedHeading = (heading: Element, nextBlock?: Element) => {
    if (!isFoldedHeading(heading) || !nextBlock) {
        return false;
    }
    if (nextBlock.getAttribute("data-type") !== "NodeHeading") {
        return true;
    }
    const headingLevel = getHeadingLevel(heading);
    const nextLevel = getHeadingLevel(nextBlock);
    return Number.isNaN(headingLevel) || Number.isNaN(nextLevel) || nextLevel > headingLevel;
};
