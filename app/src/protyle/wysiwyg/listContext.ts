export type TListSubtype = "u" | "o" | "t";

export type TListShortcutAction = "cancelList" | "convertList" | "convertChildToList" | "insertListItem" |
    "insertChildList";

export type TListContext = {
    listElement?: HTMLElement,
    listItemElement: HTMLElement,
    childElement: HTMLElement,
    childElements: HTMLElement[],
    listItemElements: HTMLElement[],
    subtype: TListSubtype,
};

const LIST_CONVERSION_TYPES: Record<TListSubtype, Partial<Record<TListSubtype, string>>> = {
    u: {o: "UL2OL", t: "UL2TL"},
    o: {u: "OL2UL", t: "OL2TL"},
    t: {u: "TL2UL", o: "TL2OL"},
};

export const getListContext = (nodeElement: HTMLElement, editorElement: HTMLElement): TListContext | undefined => {
    let listItemElement: HTMLElement | null = nodeElement;
    while (listItemElement && listItemElement !== editorElement &&
        listItemElement.getAttribute("data-type") !== "NodeListItem") {
        listItemElement = listItemElement.parentElement;
    }
    if (!listItemElement || listItemElement === editorElement) {
        return;
    }

    let childElement = nodeElement;
    while (childElement.parentElement && childElement.parentElement !== listItemElement) {
        childElement = childElement.parentElement;
    }
    if (childElement.parentElement !== listItemElement) {
        return;
    }

    const parentElement = listItemElement.parentElement;
    const listElement = parentElement?.getAttribute("data-type") === "NodeList" ? parentElement : undefined;
    const subtype = (listElement?.getAttribute("data-subtype") ||
        listItemElement.getAttribute("data-subtype")) as TListSubtype;
    if (!["u", "o", "t"].includes(subtype)) {
        return;
    }

    return {
        listElement,
        listItemElement,
        childElement,
        childElements: Array.from(listItemElement.children).filter((item) =>
            item.hasAttribute("data-node-id")) as HTMLElement[],
        listItemElements: listElement ? Array.from(listElement.children).filter((item) =>
            item.getAttribute("data-type") === "NodeListItem") as HTMLElement[] : [listItemElement],
        subtype,
    };
};

export const getListShortcutAction = (context: TListContext, targetSubtype: TListSubtype,
                                      isEmptyChild: boolean, isListItemFocused: boolean): TListShortcutAction => {
    const isSameSubtype = context.subtype === targetSubtype;
    const hasFoldedHeading = context.childElements.some((item) =>
        item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1");
    if (context.listElement && context.listItemElements.length === 1 && context.childElements.length === 1 &&
        isEmptyChild && !isListItemFocused) {
        return isSameSubtype ? "cancelList" : "convertList";
    }
    if (context.childElements.length === 1 && isSameSubtype && !hasFoldedHeading) {
        return "insertListItem";
    }
    if (context.childElements.length > 1 && isEmptyChild) {
        return "convertChildToList";
    }
    return "insertChildList";
};

export const getFollowingOrderedListMarkerUpdates = (currentMarker: string, followingMarkers: string[]) => {
    const currentIndex = Number.parseInt(currentMarker, 10);
    if (Number.isNaN(currentIndex)) {
        return followingMarkers.map(() => undefined);
    }
    return followingMarkers.map((marker, index) => {
        const expectedMarker = `${currentIndex + index + 2}.`;
        return marker === expectedMarker ? undefined : expectedMarker;
    });
};

export const shouldIgnoreListShortcut = (hasBlockSelection: boolean, selectedType?: string) => {
    return hasBlockSelection && selectedType === "NodeListItem";
};

export const getListConversionType = (sourceSubtype: TListSubtype, targetSubtype: TListSubtype) => {
    if (sourceSubtype === targetSubtype) {
        return;
    }
    return LIST_CONVERSION_TYPES[sourceSubtype][targetSubtype];
};
