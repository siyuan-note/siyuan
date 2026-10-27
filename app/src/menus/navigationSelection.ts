export type TDocTreeMenuType = "doc" | "docs" | "notebook" | "notebooks" | "items";

export const getDocTreeActionItems = <T extends {id: string, notebookId: string}>(items: readonly T[]): T[] =>
    Array.from(new Map(items.map(item => [JSON.stringify([item.notebookId, item.id]), item])).values());

export const getDocTreeTopPaths = (items: readonly {notebookId: string, path: string, kind: string}[]) => {
    const sorted = items.filter(item => item.kind === "document").slice().sort((a, b) =>
        a.notebookId.localeCompare(b.notebookId) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const retained = new Set<string>();
    let previous: typeof sorted[number];
    for (const item of sorted) {
        if (previous?.notebookId === item.notebookId &&
            (previous.path === item.path || item.path.startsWith(previous.path.replace(/\.sy$/, "") + "/"))) {
            continue;
        }
        retained.add(JSON.stringify([item.notebookId, item.path]));
        previous = item;
    }
    const result: string[] = [];
    for (const item of items) {
        if (item.kind === "document" && retained.delete(JSON.stringify([item.notebookId, item.path]))) {
            result.push(item.path);
        }
    }
    return result;
};

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

export const isDocTreeDragSelectionAllowed = (elements: Element[]) => getDocTreeMenuType(elements) !== "items";

export const getDocTreeMenuItems = (elements: Element[]) => elements.map((item) => {
    const notebookId = item.getAttribute("data-notebook-id") || item.getAttribute("data-notebook") ||
        item.closest("ul[data-url]")?.getAttribute("data-url");
    return {
        id: item.getAttribute("data-type") === "navigation-root" ? notebookId : item.getAttribute("data-node-id"),
        path: item.getAttribute("data-path"),
        notebookId,
    };
}).filter((item): item is { id: string, path: string, notebookId: string } =>
    Boolean(item.id && item.path && item.notebookId));

export const getDocTreeDeleteTargets = (elements: Element[]) => {
    const items = getDocTreeMenuItems(elements);
    return {
        notebookIds: Array.from(new Set(items.filter((item) => item.path === "/").map((item) => item.id))),
        paths: Array.from(new Set(items.filter((item) => item.path !== "/").map((item) => item.path))),
    };
};
