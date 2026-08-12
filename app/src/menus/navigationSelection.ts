export type TDocTreeMenuType = "doc" | "docs" | "notebook" | "notebooks" | "items";

export const getDocTreeMenuType = (elements: Element[]): TDocTreeMenuType => {
    const docCount = elements.filter((item) => item.getAttribute("data-type") === "navigation-file").length;
    const notebookCount = elements.filter((item) => item.getAttribute("data-type") === "navigation-root").length;
    if (docCount === elements.length) {
        return docCount === 1 ? "doc" : "docs";
    }
    if (notebookCount === elements.length) {
        return notebookCount === 1 ? "notebook" : "notebooks";
    }
    return "items";
};

export const getDocTreeMenuItems = (elements: Element[]) => elements.map((item) => ({
    id: item.getAttribute("data-type") === "navigation-root" ?
        item.closest("ul[data-url]")?.getAttribute("data-url") : item.getAttribute("data-node-id"),
    path: item.getAttribute("data-path"),
})).filter((item): item is { id: string, path: string } => Boolean(item.id && item.path));

export const getDocTreeDeleteTargets = (elements: Element[]) => {
    const items = getDocTreeMenuItems(elements);
    return {
        notebookIds: items.filter((item) => item.path === "/").map((item) => item.id),
        paths: items.filter((item) => item.path !== "/").map((item) => item.path),
    };
};
