import {stopScrollAnimation} from "../boot/globalEvent/dragover";

const DRAG_THRESHOLD = 5;

interface TouchDragState {
    dataTransfer: DataTransfer | null;
    startX: number;
    startY: number;
    ghostElement: HTMLElement | null;
    isDragging: boolean;
    draggableElement: HTMLElement;
    editorElement: HTMLElement | null;
    requireLongPress: boolean;
    touchStartTime: number;
    longPressCancelled: boolean;
}

let dragState: TouchDragState | null = null;
let lastDragOverElement: Element | null = null;

let manualTouchActive = false;

const handleManualTouchStart = (e: TouchEvent) => {
    if (dragState) return;
    if (e.touches.length !== 1) return;

    const target = e.target as HTMLElement;
    // All areas with manual mousedown/mousemove/mouseup drag/resize operations
    if (!target.closest(".dock") &&
        !target.closest(".b3-dialog") &&
        !target.closest(".sy__outline") &&
        !target.closest(".layout__resize") &&
        !target.closest(".layout__resize--lr") &&
        !target.closest(".layout__dockresize") &&
        !target.closest(".layout__dockresize--lr") &&
        !target.closest(".search__drag") &&
        // Editor-internal resize handles (not native Drag API)
        !target.closest(".av__widthdrag") &&
        !target.closest(".av__drag-fill") &&
        !target.closest(".protyle-action__drag") &&
        !target.closest(".table__resize") &&
        !target.closest(".protyle-background__img") &&
        !target.closest(".b3-chip")) return;

    const touch = e.touches[0];
    const mouseEvent = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX:touch.clientX,
        clientY:touch.clientY,
        button: 0,
        view: window,
    });
    target.dispatchEvent(mouseEvent);
    manualTouchActive = true;
};

const handleManualTouchMove = (e: TouchEvent) => {
    if (dragState?.isDragging) return;
    if (!manualTouchActive) return;

    const touch = e.touches[0];
    if (document.onmousemove && typeof document.onmousemove === "function" && (touch.target as Element)?.nodeType === 1) {
        e.preventDefault();
        touch.target.dispatchEvent( new MouseEvent("mousemove", {
            clientX: touch.clientX,
            clientY: touch.clientY,
            cancelable: true,
            bubbles: true,
        }));
    }
};

const handleManualTouchEnd = (e: TouchEvent) => {
    if (dragState?.isDragging) return;
    if (!manualTouchActive) return;

    if (document.onmouseup) {
        if (typeof document.onmouseup !== "function") return;
        const target = e.changedTouches[0].target || document.body;
        target.dispatchEvent(new MouseEvent("mouseup", {
            clientX:e.changedTouches[0].clientX,
            clientY:e.changedTouches[0].clientY,
            bubbles: true,
        }));
    }
    manualTouchActive = false;
};

const getDraggableAncestor = (el: HTMLElement): HTMLElement | null => {
    let current: HTMLElement | null = el;
    while (current) {
        if (current.getAttribute?.("draggable") === "true") {
            return current;
        }
        if (current === document.body) break;
        current = current.parentElement;
    }
    return null;
};

const getElementUnderTouch = (clientX: number, clientY: number): Element | null => {
    if (dragState?.ghostElement) {
        dragState.ghostElement.style.display = "none";
    }
    const el = document.elementFromPoint(clientX, clientY);
    if (dragState?.ghostElement) {
        dragState.ghostElement.style.display = "";
    }
    return el;
};

const positionGhost = (clientX: number, clientY: number) => {
    if (dragState?.ghostElement) {
        // Offset ghost so it's visible beside the finger, not hidden under it
        dragState.ghostElement.style.left = `${clientX + 12}px`;
        dragState.ghostElement.style.top = `${clientY + 12}px`;
    }
};

const clearDragoverClasses = () => {
    document.querySelectorAll(".dragover__top, .dragover__bottom, .dragover__left, .dragover__right, .dragover").forEach((item) => {
        item.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right", "dragover");
    });
};

const startTouchDrag = (touch: Touch) => {
    const dt = new DataTransfer();
    dragState.dataTransfer = dt;
    dragState.isDragging = true;

    dragState.editorElement = dragState.draggableElement.closest(".protyle-wysiwyg") as HTMLElement;

    window.siyuan.touchDragActive = true;
    window.siyuan.touchDragGhost = null;

    const dragStartEvent = new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        dataTransfer: dt,
        view: window,
    });
    dragState.draggableElement.dispatchEvent(dragStartEvent);

    dragState.ghostElement = window.siyuan.touchDragGhost || null;
    if (dragState.ghostElement) {
        dragState.ghostElement.style.pointerEvents = "none";
        dragState.ghostElement.style.zIndex = (++window.siyuan.zIndex).toString();
        // Position first, then show — avoids flash at wrong position
        positionGhost(touch.clientX, touch.clientY);
        dragState.ghostElement.style.opacity = "0.6";
    }

    if (dragState.editorElement) {
        const dragEnterEvent = new DragEvent("dragenter", {
            bubbles: false,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            dataTransfer: dt,
            view: window,
        });
        dragState.editorElement.dispatchEvent(dragEnterEvent);
    }
};

const continueTouchDrag = (touch: Touch) => {
    if (!dragState.isDragging) return;

    const elementUnderTouch = getElementUnderTouch(touch.clientX, touch.clientY);

    // Track dragenter / dragleave across container-level elements.
    // Only dispatch when element's parent changes, to avoid flickering
    // when moving between siblings of the same parent.
    if (elementUnderTouch !== lastDragOverElement) {
        const prevContainer = lastDragOverElement?.parentElement;
        const currContainer = elementUnderTouch?.parentElement;
        if (prevContainer !== currContainer || (!prevContainer && currContainer) || (prevContainer && !currContainer)) {
            if (lastDragOverElement) {
                const dragLeaveEvent = new DragEvent("dragleave", {
                    bubbles: true,
                    cancelable: true,
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    dataTransfer: dragState.dataTransfer,
                    view: window,
                });
                lastDragOverElement.dispatchEvent(dragLeaveEvent);
            }
            if (elementUnderTouch) {
                const dragEnterEvent = new DragEvent("dragenter", {
                    bubbles: true,
                    cancelable: true,
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    dataTransfer: dragState.dataTransfer,
                    view: window,
                });
                elementUnderTouch.dispatchEvent(dragEnterEvent);
            }
        }
        lastDragOverElement = elementUnderTouch;
    }

    if (elementUnderTouch) {
        const dragOverEvent = new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            dataTransfer: dragState.dataTransfer,
            view: window,
        });
        elementUnderTouch.dispatchEvent(dragOverEvent);
    }

    positionGhost(touch.clientX, touch.clientY);
};

const endTouchDrag = (touch: Touch) => {
    if (!dragState.isDragging) return;

    const elementUnderTouch = getElementUnderTouch(touch.clientX, touch.clientY);
    if (elementUnderTouch) {
        const dropEvent = new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            dataTransfer: dragState.dataTransfer,
            view: window,
        });
        elementUnderTouch.dispatchEvent(dropEvent);
    }

    const dragEndEvent = new DragEvent("dragend", {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        dataTransfer: dragState.dataTransfer,
        view: window,
    });
    dragState.draggableElement.dispatchEvent(dragEndEvent);

    clearDragoverClasses();
};

const cleanupDrag = () => {
    stopScrollAnimation();
    clearDragoverClasses();

    if (dragState?.ghostElement) {
        dragState.ghostElement.remove();
    }

    window.siyuan.touchDragActive = false;
    window.siyuan.touchDragGhost = null;
    dragState = null;
    lastDragOverElement = null;
};

const handleDragStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;

    const target = e.target as HTMLElement;
    const draggable = getDraggableAncestor(target);
    if (!draggable) return;

    const touch = e.touches[0];
    dragState = {
        dataTransfer: null,
        startX: touch.clientX,
        startY: touch.clientY,
        ghostElement: null,
        isDragging: false,
        draggableElement: draggable,
        editorElement: null,
        // File tree needs long-press to avoid conflict with scroll
        requireLongPress: draggable.closest(".sy__file") !== null,
        touchStartTime: Date.now(),
        longPressCancelled: false,
    };
};

const handleDragMove = (e: TouchEvent) => {
    if (!dragState) return;

    const touch = e.touches[0];

    if (!dragState.isDragging) {
        const dx = touch.clientX - dragState.startX;
        const dy = touch.clientY - dragState.startY;

        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
            return;
        }

        // File tree items: must hold still for 300ms, then drag.
        // Moving before 300ms is a scroll — cancel drag entirely.
        if (dragState.requireLongPress) {
            if (dragState.longPressCancelled) {
                return;
            }
            if (Date.now() - dragState.touchStartTime < 300) {
                dragState.longPressCancelled = true;
                return;
            }
        }

        e.preventDefault();
        startTouchDrag(touch);
        return;
    }

    e.preventDefault();
    continueTouchDrag(touch);
};

const handleDragEnd = (e: TouchEvent) => {
    if (!dragState) return;

    if (dragState.isDragging) {
        e.preventDefault();
        endTouchDrag(e.changedTouches[0]);
    }

    cleanupDrag();
};

const handleCancel = () => {
    if (dragState?.isDragging) {
        cleanupDrag();
    }
    dragState = null;
    lastDragOverElement = null;
    manualTouchActive = false;
};

export const initTouchDragBridge = () => {
    // Native Drag API bridge (for [draggable="true"] elements)
    document.addEventListener("touchstart", handleDragStart, {passive: false});
    document.addEventListener("touchmove", handleDragMove, {passive: false});
    document.addEventListener("touchend", handleDragEnd);
    // Manual mousedown bridge (for dock / dialog / outline)
    document.addEventListener("touchstart", handleManualTouchStart, {passive: false});
    document.addEventListener("touchmove", handleManualTouchMove, {passive: false});
    document.addEventListener("touchend", handleManualTouchEnd);

    document.addEventListener("touchcancel", handleCancel);
};
