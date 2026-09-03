import {Constants} from "../constants";

export type TTopBarDropSide = "before" | "after";

const TOP_BAR_WORKSPACE_ID = "barWorkspace";
const TOP_BAR_DRAG_ID = "drag";
const TOP_BAR_MORE_ID = "barMore";
const TOP_BAR_WINDOW_CONTROLS_ID = "windowControls";

export const getTopBarOrder = (toolbarElement: HTMLElement) => {
    const order: string[] = [];
    Array.from(toolbarElement.children).forEach((item: HTMLElement) => {
        if (item.id === TOP_BAR_DRAG_ID) {
            order.push(TOP_BAR_DRAG_ID);
            return;
        }
        const key = item.getAttribute("data-topbar-entry");
        if (key !== null) {
            order.push(key);
        }
    });
    return order;
};

export const resolveTopBarDropSide = (
    targetId: string,
    clientX: number,
    rect: Pick<DOMRect, "left" | "width">,
): TTopBarDropSide | undefined => {
    if (targetId === TOP_BAR_WINDOW_CONTROLS_ID) {
        return;
    }
    if (targetId === TOP_BAR_WORKSPACE_ID) {
        return "after";
    }
    if (targetId === TOP_BAR_MORE_ID) {
        return "before";
    }
    return clientX < rect.left + rect.width / 2 ? "before" : "after";
};

export const isTopBarDropNoop = (
    sourceIndex: number,
    targetIndex: number,
    side: TTopBarDropSide,
) => sourceIndex === targetIndex ||
    (side === "before" && sourceIndex + 1 === targetIndex) ||
    (side === "after" && targetIndex + 1 === sourceIndex);

const getDirectChild = (toolbarElement: HTMLElement, target: EventTarget | null) => {
    if (!target || typeof target !== "object" || !("parentElement" in target)) {
        return;
    }
    let element = target as Element;
    while (element && element.parentElement !== toolbarElement) {
        if (element === toolbarElement) {
            return;
        }
        element = element.parentElement;
    }
    return element as HTMLElement | undefined;
};

const isDraggableEntry = (element?: HTMLElement) => element &&
    element.parentElement &&
    element.hasAttribute("data-topbar-entry") &&
    element.id !== TOP_BAR_WORKSPACE_ID &&
    element.id !== TOP_BAR_MORE_ID &&
    element.id !== TOP_BAR_DRAG_ID &&
    element.id !== TOP_BAR_WINDOW_CONTROLS_ID;

const isDropTarget = (element?: HTMLElement) => element &&
    (element.hasAttribute("data-topbar-entry") ||
        element.id === TOP_BAR_WORKSPACE_ID ||
        element.id === TOP_BAR_DRAG_ID ||
        element.id === TOP_BAR_MORE_ID) &&
    element.id !== TOP_BAR_WINDOW_CONTROLS_ID;

export const bindTopBarDrag = (
    toolbarElement: HTMLElement,
    onOrderChange: (order: string[]) => void,
) => {
    const documentSelf = toolbarElement.ownerDocument;
    const view = documentSelf.defaultView || window;
    let cancelCurrentDrag: (() => void) | undefined;
    let suppressClick = false;
    let suppressClickTimer: number | undefined;

    const clearClickSuppression = () => {
        suppressClick = false;
        if (typeof suppressClickTimer === "number") {
            view.clearTimeout(suppressClickTimer);
            suppressClickTimer = undefined;
        }
    };

    const suppressNextClick = () => {
        clearClickSuppression();
        suppressClick = true;
        suppressClickTimer = view.setTimeout(() => {
            suppressClick = false;
            suppressClickTimer = undefined;
        });
    };

    const onClick = (event: MouseEvent) => {
        if (!suppressClick) {
            return;
        }
        clearClickSuppression();
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    const onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0 || cancelCurrentDrag || view.siyuan.config.readonly) {
            return;
        }
        const sourceElement = getDirectChild(toolbarElement, event.target);
        if (!isDraggableEntry(sourceElement)) {
            return;
        }
        const dragElement = Array.from(toolbarElement.children).find((item) => item.id === TOP_BAR_DRAG_ID);
        dragElement?.setAttribute("data-topbar-reordering", "true");

        const startX = event.clientX;
        const startY = event.clientY;
        const sourceRect = sourceElement.getBoundingClientRect();
        const sourceOpacity = sourceElement.style.opacity;
        let dragging = false;
        let ghostElement: HTMLElement | undefined;
        let placeholderElement: HTMLElement | undefined;
        let selectedElement: HTMLElement | undefined;

        const preventNativeDrag = (dragEvent: DragEvent) => {
            dragEvent.preventDefault();
        };

        const cleanup = () => {
            documentSelf.removeEventListener("mousemove", onMouseMove);
            documentSelf.removeEventListener("mouseup", onMouseUp);
            documentSelf.removeEventListener("dragstart", preventNativeDrag);
            sourceElement.style.opacity = sourceOpacity;
            dragElement?.removeAttribute("data-topbar-reordering");
            ghostElement?.remove();
            placeholderElement?.remove();
            if (cancelCurrentDrag === cleanup) {
                cancelCurrentDrag = undefined;
            }
        };

        const beginDrag = () => {
            dragging = true;
            sourceElement.style.opacity = "0.38";

            ghostElement = sourceElement.cloneNode(true) as HTMLElement;
            ghostElement.removeAttribute("id");
            ghostElement.removeAttribute("data-topbar-entry");
            ghostElement.removeAttribute("aria-label");
            ghostElement.setAttribute("aria-hidden", "true");
            ghostElement.setAttribute("data-topbar-drag-ghost", "true");
            ghostElement.style.backgroundColor = "var(--b3-theme-background-light)";
            ghostElement.style.boxSizing = "border-box";
            ghostElement.style.height = `${sourceRect.height}px`;
            ghostElement.style.margin = "0";
            ghostElement.style.pointerEvents = "none";
            ghostElement.style.position = "fixed";
            ghostElement.style.transition = "none";
            ghostElement.style.width = `${sourceRect.width}px`;
            ghostElement.style.zIndex = "999997";
            documentSelf.body.appendChild(ghostElement);

            placeholderElement = documentSelf.createElement("span");
            placeholderElement.className = "toolbar__item fn__none";
            placeholderElement.setAttribute("aria-hidden", "true");
            placeholderElement.setAttribute("data-topbar-drag-placeholder", "true");
            placeholderElement.style.background = "var(--b3-theme-primary-light)";
            placeholderElement.style.flex = `0 0 ${sourceRect.width}px`;
            placeholderElement.style.height = `${sourceRect.height}px`;
            placeholderElement.style.pointerEvents = "none";
            placeholderElement.style.width = `${sourceRect.width}px`;
            placeholderElement.innerHTML = "<svg></svg>";
        };

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (!dragging) {
                if (view.siyuan.config.readonly ||
                    Math.abs(moveEvent.clientX - startX) < Constants.SIZE_DRAG_THRESHOLD &&
                    Math.abs(moveEvent.clientY - startY) < Constants.SIZE_DRAG_THRESHOLD) {
                    return;
                }
                beginDrag();
            }

            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            ghostElement.style.left = `${moveEvent.clientX - sourceRect.width / 2}px`;
            ghostElement.style.top = `${moveEvent.clientY - sourceRect.height / 2}px`;

            const targetElement = getDirectChild(toolbarElement, moveEvent.target);
            if (targetElement && selectedElement && targetElement === selectedElement) {
                const side = resolveTopBarDropSide(
                    selectedElement.id,
                    moveEvent.clientX,
                    selectedElement.getBoundingClientRect(),
                );
                if (!side) {
                    return;
                }
                const children = Array.from(toolbarElement.children).filter((item) => item !== placeholderElement);
                if (isTopBarDropNoop(
                    children.indexOf(sourceElement),
                    children.indexOf(selectedElement),
                    side,
                )) {
                    placeholderElement.classList.add("fn__none");
                } else {
                    placeholderElement.classList.remove("fn__none");
                    if (side === "before") {
                        selectedElement.before(placeholderElement);
                    } else {
                        selectedElement.after(placeholderElement);
                    }
                }
                return;
            }
            if (!isDropTarget(targetElement) || targetElement === sourceElement) {
                if (targetElement === sourceElement) {
                    placeholderElement.classList.add("fn__none");
                }
                return;
            }
            selectedElement = targetElement;
        };

        const onMouseUp = () => {
            let changedOrder: string[] | undefined;
            if (dragging && !view.siyuan.config.readonly && !placeholderElement.classList.contains("fn__none") &&
                placeholderElement.parentElement === toolbarElement &&
                sourceElement.parentElement === toolbarElement) {
                const previousOrder = getTopBarOrder(toolbarElement);
                placeholderElement.replaceWith(sourceElement);
                const currentOrder = getTopBarOrder(toolbarElement);
                if (previousOrder.some((item, index) => item !== currentOrder[index])) {
                    changedOrder = currentOrder;
                }
            }
            cleanup();
            if (dragging) {
                suppressNextClick();
            }
            if (changedOrder) {
                onOrderChange(changedOrder);
            }
        };

        cancelCurrentDrag = cleanup;
        documentSelf.addEventListener("mousemove", onMouseMove);
        documentSelf.addEventListener("mouseup", onMouseUp);
        documentSelf.addEventListener("dragstart", preventNativeDrag);
    };

    toolbarElement.addEventListener("mousedown", onMouseDown);
    toolbarElement.addEventListener("click", onClick, true);

    return () => {
        cancelCurrentDrag?.();
        clearClickSuppression();
        toolbarElement.removeEventListener("mousedown", onMouseDown);
        toolbarElement.removeEventListener("click", onClick, true);
    };
};
