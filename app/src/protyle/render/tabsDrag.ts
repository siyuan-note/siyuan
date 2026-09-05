interface ITabsDragOptions {
    tabs: HTMLElement;
    readonly: () => boolean;
    move: (source: HTMLElement, target: HTMLElement, after: boolean) => void;
    render: () => void;
}

interface ITabsDrag {
    item: HTMLElement;
    button: HTMLElement;
    list: HTMLElement;
    next: Element;
    width: string;
    options: ITabsDragOptions;
    renders: Set<() => void>;
}

let dragging: ITabsDrag;

export const isDraggingTabs = (root: Element) => !!dragging &&
    (root.contains(dragging.item) || root.contains(dragging.button));

const restorePosition = (state: ITabsDrag) => {
    state.list.insertBefore(state.button, state.next?.parentElement === state.list ? state.next : null);
};

export const cancelTabsDrag = (root?: Element) => {
    if (!dragging || (root && !root.contains(dragging.item) && !root.contains(dragging.button))) {
        return;
    }
    const state = dragging;
    dragging = undefined;
    restorePosition(state);
    state.button.classList.remove("tabs-tab--dragging");
    state.button.style.width = state.width;
    state.renders.forEach(render => render());
};

// 拖动期间只调整导航按钮，正文顺序在落下时由一次事务更新。
export const bindTabsDrag = (list: HTMLElement, options: ITabsDragOptions) => {
    const canDrop = () => dragging && dragging.item.isConnected && !options.readonly() &&
        !dragging.options.readonly() && !dragging.item.contains(options.tabs);
    list.addEventListener("dragstart", (event: DragEvent) => {
        const button = (event.target as Element).closest<HTMLElement>(".tabs-tab");
        if (!button || button.parentElement !== list || options.readonly()) {
            event.preventDefault();
            return;
        }
        cancelTabsDrag();
        const item = Array.from(options.tabs.children).find(child =>
            child.getAttribute("data-node-id") === button.dataset.tabId) as HTMLElement;
        if (!item) {
            event.preventDefault();
            return;
        }
        dragging = {item, button, list, next: button.nextElementSibling, width: button.style.width,
            options, renders: new Set([options.render])};
        button.style.width = button.getBoundingClientRect().width + "px";
        button.classList.add("tabs-tab--dragging");
        event.dataTransfer.setData("application/x-siyuan-tab", button.dataset.tabId);
        event.dataTransfer.effectAllowed = "move";
        event.stopPropagation();
    });
    list.addEventListener("dragover", (event: DragEvent) => {
        if (!canDrop()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        const vertical = options.tabs.getAttribute("data-tabs-orientation") === "vertical";
        const bounds = list.getBoundingClientRect();
        const position = vertical ? event.clientY : event.clientX;
        const start = vertical ? bounds.top : bounds.left;
        const end = vertical ? bounds.bottom : bounds.right;
        const scroll = position < start + 24 ? -16 : position > end - 24 ? 16 : 0;
        if (vertical) {
            list.scrollTop += scroll;
        } else {
            list.scrollLeft += scroll;
        }
        const next = Array.from(list.children).find(child => {
            if (child === dragging.button) {
                return false;
            }
            const rect = child.getBoundingClientRect();
            return vertical ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2;
        });
        dragging.renders.add(options.render);
        if (dragging.button.parentElement !== list || dragging.button.nextElementSibling !== (next || null)) {
            list.insertBefore(dragging.button, next || null);
        }
    });
    list.addEventListener("dragenter", event => {
        if (canDrop()) {
            event.preventDefault();
            event.stopPropagation();
        }
    });
    list.addEventListener("dragleave", (event: DragEvent) => {
        if (dragging && !list.contains(event.relatedTarget as Node)) {
            restorePosition(dragging);
            event.stopPropagation();
        }
    });
    list.addEventListener("drop", (event: DragEvent) => {
        if (!canDrop() || dragging.button.parentElement !== list) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const state = dragging;
        const next = state.button.nextElementSibling;
        const adjacent = next || state.button.previousElementSibling;
        const target = Array.from(options.tabs.children).find(child =>
            child.getAttribute("data-node-id") === (adjacent as HTMLElement)?.dataset.tabId) as HTMLElement;
        const changed = list !== state.list || next !== state.next;
        cancelTabsDrag();
        if (changed && target) {
            options.move(state.item, target, !next);
        }
    });
    // 跨组移动后 dragend 会在目标导航栏冒泡，两个入口都执行同一清理。
    list.addEventListener("dragend", event => {
        event.stopPropagation();
        cancelTabsDrag();
    });
};
