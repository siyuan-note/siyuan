export const isDirectCalloutStructureClick = (mouseDownTarget: EventTarget | null,
                                               clickTarget: EventTarget | null,
                                               pointerTarget: Element | null) =>
    mouseDownTarget === clickTarget && pointerTarget === clickTarget;
