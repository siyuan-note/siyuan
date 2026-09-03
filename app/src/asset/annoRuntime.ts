const pdfInstances = new WeakMap<HTMLElement, any>();
const annoCleanups = new WeakMap<HTMLElement, () => void>();

export const registerPdfInstance = (element: HTMLElement, pdf: any) => {
    pdfInstances.set(element, pdf);
};

export const unregisterPdfInstance = (element: HTMLElement) => {
    pdfInstances.delete(element);
};

export const registerAnnoCleanup = (element: HTMLElement, cleanup: () => void) => {
    annoCleanups.set(element, cleanup);
};

export const destroyAnno = (element: HTMLElement) => {
    const cleanup = annoCleanups.get(element);
    annoCleanups.delete(element);
    try {
        cleanup?.();
    } finally {
        unregisterPdfInstance(element);
    }
};

export const getRegisteredPdfInstance = (element: HTMLElement) => {
    let currentElement: HTMLElement | null = element;
    while (currentElement) {
        const registeredInstance = pdfInstances.get(currentElement);
        if (registeredInstance) {
            return registeredInstance;
        }
        currentElement = currentElement.parentElement;
    }
};

export const bindPdfAnnotationPointerDrag = (
    target: Document,
    pointerId: number,
    pointermove: (event: PointerEvent) => void,
    pointerup: (event: PointerEvent) => void,
    pointercancel: () => void,
) => {
    let active = true;
    const move = (event: PointerEvent) => {
        if (event.pointerId === pointerId) {
            pointermove(event);
        }
    };
    const cleanup = () => {
        if (!active) {
            return false;
        }
        active = false;
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        target.removeEventListener("pointercancel", canceled);
        return true;
    };
    const up = (event: PointerEvent) => {
        if (event.pointerId !== pointerId || !cleanup()) {
            return;
        }
        pointerup(event);
    };
    const cancel = () => {
        if (cleanup()) {
            pointercancel();
        }
    };
    const canceled = (event: PointerEvent) => {
        if (event.pointerId === pointerId) {
            cancel();
        }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", canceled);
    return cancel;
};
