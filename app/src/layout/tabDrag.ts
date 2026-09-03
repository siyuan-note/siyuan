export type TDocumentTabMovePosition = "sibling" | "child";

export const getDocumentTabMovePosition = (clientX: number, left: number, width: number): TDocumentTabMovePosition =>
    clientX < left + width / 2 ? "sibling" : "child";

export const clearDocumentTabMovePreview = (tabHeadersElement?: ParentNode) => {
    const root = tabHeadersElement || document;
    root.querySelectorAll(".item__document-drop").forEach((item) => item.remove());
    if (root instanceof HTMLElement) {
        root.classList.remove("layout-tab-bars--document-drop");
    }
    root.querySelectorAll<HTMLElement>(".layout-tab-bars--document-drop").forEach((item) => {
        item.classList.remove("layout-tab-bars--document-drop");
    });
    root.querySelectorAll<HTMLElement>(".item--document-drop").forEach((item) => {
        item.classList.remove("item--document-drop");
        delete item.dataset.documentDropPosition;
    });
};

export const clearTabDragPreview = (tabHeadersElement?: HTMLElement) => {
    clearDocumentTabMovePreview(tabHeadersElement);
    if (tabHeadersElement) {
        tabHeadersElement.classList.remove("layout-tab-bars--drag");
        tabHeadersElement.querySelectorAll(".layout-tab-bar li[data-clone='true']").forEach((item) => {
            item.remove();
        });
    } else {
        document.querySelectorAll(".layout-tab-bars--drag").forEach((item) => {
            item.classList.remove("layout-tab-bars--drag");
        });
        document.querySelectorAll(".layout-tab-bar li[data-clone='true']").forEach((item) => {
            item.remove();
        });
    }
    if (!tabHeadersElement || window.siyuan.currentDragOverTabHeadersElement === tabHeadersElement) {
        window.siyuan.currentDragOverTabHeadersElement = undefined;
    }
};

export const reorderTabItems = <T extends { id: string }>(items: T[], item: T, nextId?: string) => {
    const currentIndex = items.indexOf(item);
    if (currentIndex === -1) {
        return false;
    }
    items.splice(currentIndex, 1);
    const nextIndex = nextId ? items.findIndex((currentItem) => currentItem.id === nextId) : -1;
    if (nextIndex === -1) {
        items.push(item);
    } else {
        items.splice(nextIndex, 0, item);
    }
    return true;
};

export const findNextTabId = <T extends { id: string }>(items: T[], candidateIds: string[]) => {
    const existingIds = new Set(items.map((item) => item.id));
    return candidateIds.find((id) => existingIds.has(id));
};

export const findDefaultTabNextId = <T extends { id: string, pin: boolean }>(items: T[], pin: boolean) => {
    if (!pin) {
        return undefined;
    }
    return items.find((item) => !item.pin)?.id;
};

type TTabHoverScheduler = (callback: () => void, delay: number) => () => void;

let tabHoverId: string;
let cancelTabHover: () => void;
let tabHoverGeneration = 0;

const defaultTabHoverScheduler: TTabHoverScheduler = (callback, delay) => {
    const timeoutId = setTimeout(callback, delay);
    return () => clearTimeout(timeoutId);
};

export const clearTabHoverSwitch = () => {
    tabHoverGeneration++;
    cancelTabHover?.();
    cancelTabHover = undefined;
    tabHoverId = undefined;
};

export const scheduleTabHoverSwitch = (tabId: string, callback: () => void, delay: number,
                                        scheduler = defaultTabHoverScheduler) => {
    if (tabHoverId === tabId) {
        return;
    }
    clearTabHoverSwitch();
    tabHoverId = tabId;
    const generation = tabHoverGeneration;
    cancelTabHover = scheduler(() => {
        if (generation !== tabHoverGeneration || tabHoverId !== tabId) {
            return;
        }
        cancelTabHover = undefined;
        callback();
    }, delay);
};
