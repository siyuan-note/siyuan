interface NativeDragGuard {
    draggableElement: Pick<HTMLElement, "setAttribute">;
    restoreDraggable?: boolean;
}

interface DragCompletionCallbacks {
    drop: () => void;
    dragEnd: () => void;
    cleanup: () => void;
}

interface DragRelayMimeTypes {
    block: string;
    documents: string;
    file: string;
    gutterPrefix: string;
}

export const getDragRelayTypes = (types: readonly string[], mimeTypes: DragRelayMimeTypes) => {
    return types.filter(type => type === mimeTypes.block || type === mimeTypes.file ||
        type === mimeTypes.documents || type.startsWith(mimeTypes.gutterPrefix));
};

export const isDragRelaySource = (types: readonly string[], mimeTypes: DragRelayMimeTypes) => {
    return types.includes(mimeTypes.file) ||
        (types.includes(mimeTypes.block) && types.some(type => type.startsWith(mimeTypes.gutterPrefix)));
};

export const hasActiveTouchGesture = (states: readonly ({isMouse: boolean} | null | undefined)[]) => {
    return states.some(state => !!state && !state.isMouse);
};

export const shouldRequireLongPress = (isLongPressTarget: boolean, isMouse: boolean, isAndroid: boolean) => {
    return isLongPressTarget && (!isMouse || isAndroid);
};

export const shouldCancelPointerDragOnBlur = (isAndroid: boolean, isDragging: boolean, hasRelay: boolean) => {
    return isAndroid || !isDragging || !hasRelay;
};

export const getWheelScrollDelta = (delta: number, deltaMode: number, lineSize: number, pageSize: number) => {
    if (deltaMode === 1) {
        return delta * lineSize;
    }
    if (deltaMode === 2) {
        return delta * pageSize;
    }
    return delta;
};

export const createDragRefreshQueue = (
    refresh: () => void,
    requestFrame: (callback: FrameRequestCallback) => number,
    cancelFrame: (handle: number) => void,
) => {
    let scheduled = false;
    let frameHandle = 0;
    let generation = 0;

    return {
        schedule: () => {
            if (scheduled) {
                return;
            }
            scheduled = true;
            const currentGeneration = ++generation;
            const handle = requestFrame(() => {
                if (!scheduled || generation !== currentGeneration) {
                    return;
                }
                scheduled = false;
                refresh();
            });
            if (scheduled && generation === currentGeneration) {
                frameHandle = handle;
            }
        },
        cancel: () => {
            if (!scheduled) {
                return;
            }
            scheduled = false;
            generation++;
            cancelFrame(frameHandle);
        },
    };
};

export const suspendNativeDrag = (state: NativeDragGuard) => {
    state.draggableElement.setAttribute("draggable", "false");
    state.restoreDraggable = true;
};

export const dispatchWithNativeDragEnabled = (state: NativeDragGuard, dispatch: () => void) => {
    if (!state.restoreDraggable) {
        dispatch();
        return;
    }
    state.draggableElement.setAttribute("draggable", "true");
    try {
        dispatch();
    } finally {
        state.draggableElement.setAttribute("draggable", "false");
    }
};

export const restoreNativeDrag = (state: NativeDragGuard | null) => {
    if (state?.restoreDraggable) {
        state.draggableElement.setAttribute("draggable", "true");
    }
};

export const completeDrag = (isDragging: boolean, canceled: boolean, callbacks: DragCompletionCallbacks) => {
    if (isDragging) {
        if (!canceled) {
            callbacks.drop();
        }
        callbacks.dragEnd();
    }
    callbacks.cleanup();
};

export const shouldSuppressNativeContextMenu = (isTrusted: boolean, hasActiveGesture: boolean) => {
    return isTrusted && hasActiveGesture;
};
