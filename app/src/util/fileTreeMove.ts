export interface IFileTreeMove {
    fromNotebook: string;
    fromPath: string;
    toNotebook: string;
    toPath: string;
    newPath: string;
}

export interface IDocumentTabDragData {
    rootId: string;
    tabId: string;
    title: string;
}

const BLOCK_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

export const parseDocumentTabDragData = (data: string) => {
    try {
        const result = JSON.parse(data) as IDocumentTabDragData;
        if (!BLOCK_ID_PATTERN.test(result.rootId) || typeof result.tabId !== "string" ||
            typeof result.title !== "string") {
            return;
        }
        return result;
    } catch (e) {
        console.warn("parse document tab drop data failed", e);
    }
};

const getDocumentIDFromPath = (path: string) => {
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    return fileName.endsWith(".sy") ? fileName.slice(0, -3) : fileName;
};

export const insertDocumentSortPath = (
    siblingPaths: string[],
    sourceID: string,
    newPath: string,
    targetPath: string,
    insertAfter: boolean
) => {
    const paths = siblingPaths.filter((path) => getDocumentIDFromPath(path) !== sourceID);
    const targetIndex = paths.indexOf(targetPath);
    if (targetIndex === -1) {
        return;
    }
    paths.splice(targetIndex + (insertAfter ? 1 : 0), 0, newPath);
    return paths;
};

export const findMovedFileTreeItem = (treeElement: Element, move: IFileTreeMove) => {
    const sourceElement = treeElement.querySelector<HTMLElement>(
        `ul[data-url="${move.fromNotebook}"] li[data-path="${move.fromPath}"]`
    );
    if (sourceElement) {
        return {
            element: sourceElement,
            isAtTarget: false,
        };
    }
    const targetElement = treeElement.querySelector<HTMLElement>(
        `ul[data-url="${move.toNotebook}"] li[data-path="${move.newPath}"]`
    );
    if (targetElement) {
        return {
            element: targetElement,
            isAtTarget: true,
        };
    }
};

export const getFileTreeChildList = (liElement: Element) => {
    const nextElement = liElement.nextElementSibling;
    return nextElement?.tagName === "UL" ? nextElement as HTMLElement : undefined;
};

export const collectExpandedDocIDs = (
    liElement: HTMLElement,
    childListElement: HTMLElement | undefined,
    expandedDocIDs: Set<string>
) => {
    if (liElement.dataset.nodeId && liElement.querySelector(".b3-list-item__arrow--open")) {
        expandedDocIDs.add(liElement.dataset.nodeId);
    }
    childListElement?.querySelectorAll(".b3-list-item__arrow--open").forEach((arrowElement) => {
        const childItemElement = arrowElement.closest("li[data-node-id]") as HTMLElement;
        if (childItemElement?.dataset.nodeId) {
            expandedDocIDs.add(childItemElement.dataset.nodeId);
        }
    });
};

export const restoreMovedExpandedDocItems = (
    listElement: Element,
    expandedDocIDs: Set<string>,
    expandItem: (item: HTMLElement) => void
) => {
    listElement.querySelectorAll<HTMLElement>(":scope > li[data-node-id]").forEach((item) => {
        const id = item.dataset.nodeId;
        if (!expandedDocIDs.has(id)) {
            return;
        }
        expandedDocIDs.delete(id);
        const childListElement = getFileTreeChildList(item);
        if (item.querySelector(".b3-list-item__arrow--open") && childListElement) {
            restoreMovedExpandedDocItems(childListElement, expandedDocIDs, expandItem);
        } else {
            expandItem(item);
        }
    });
};

export const remapMovedPath = (currentPath: string, fromPath: string, newPath: string) => {
    const fromPrefix = fromPath.endsWith(".sy") ? fromPath.slice(0, -3) : fromPath;
    const newPrefix = newPath.endsWith(".sy") ? newPath.slice(0, -3) : newPath;
    if (!currentPath.startsWith(fromPrefix + "/")) {
        return currentPath;
    }
    return newPrefix + currentPath.slice(fromPrefix.length);
};

const updateMovedItemPath = (item: HTMLElement, newPath: string) => {
    item.dataset.path = newPath;
    const paddingLeft = (newPath.split("/").length - 1) * 20;
    item.style.setProperty("--file-toggle-width", `${paddingLeft + 20}px`);
    const toggleElement = item.querySelector<HTMLElement>(":scope > .b3-list-item__toggle");
    if (toggleElement) {
        toggleElement.style.paddingLeft = `${paddingLeft}px`;
    }
};

export const updateMovedSubtree = (
    liElement: HTMLElement,
    childListElement: HTMLElement | undefined,
    fromPath: string,
    newPath: string
) => {
    updateMovedItemPath(liElement, newPath);
    childListElement?.querySelectorAll<HTMLElement>("li[data-path]").forEach((item) => {
        updateMovedItemPath(item, remapMovedPath(item.dataset.path, fromPath, newPath));
    });
};
