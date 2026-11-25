export const isDirectCalloutStructureClick = (mouseDownTarget: EventTarget | null,
                                               clickTarget: EventTarget | null,
                                               pointerTarget: Element | null) =>
    mouseDownTarget === clickTarget && pointerTarget === clickTarget;

export const isBelowCalloutContent = (callout: Element, clientY: number) => {
    const blocks = callout.querySelectorAll(":scope > .callout-content > [data-node-id]");
    for (let i = blocks.length - 1; i >= 0; i--) {
        const rect = blocks[i].getBoundingClientRect();
        if (rect.height > 0) {
            return clientY >= rect.bottom;
        }
    }
    return false;
};
