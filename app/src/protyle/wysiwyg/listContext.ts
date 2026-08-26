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

export type TAppendListContext = {
    listElement?: HTMLElement,
    listItemElement?: HTMLElement,
};

export const ORDERED_LIST_MAX_NUMBER = 999999999;

const LIST_CONVERSION_TYPES: Record<TListSubtype, Partial<Record<TListSubtype, string>>> = {
    u: {o: "UL2OL", t: "UL2TL"},
    o: {u: "OL2UL", t: "OL2TL"},
    t: {u: "TL2UL", o: "TL2OL"},
};

export const getAppendListContext = (nodeElement: HTMLElement,
                                     editorElement: HTMLElement): TAppendListContext | undefined => {
    let currentElement: HTMLElement | null = nodeElement;
    while (currentElement && currentElement !== editorElement) {
        const type = currentElement.getAttribute("data-type");
        if (type === "NodeList") {
            return {listElement: currentElement};
        }
        if (type === "NodeListItem") {
            const parentElement = currentElement.parentElement;
            return {
                listElement: parentElement?.getAttribute("data-type") === "NodeList" ? parentElement : undefined,
                listItemElement: currentElement,
            };
        }
        currentElement = currentElement.parentElement;
    }
};

export const getLastListItemElement = (listElement: HTMLElement) => {
    return Array.from(listElement.children).reverse().find((item) =>
        item.getAttribute("data-type") === "NodeListItem") as HTMLElement | undefined;
};

export const getFirstListItemElement = (listElement: HTMLElement) => {
    return Array.from(listElement.children).find((item) =>
        item.getAttribute("data-type") === "NodeListItem") as HTMLElement | undefined;
};

export const getPreviousListItemID = (listElement: HTMLElement, listItemID: string) => {
    const listItemElements = Array.from(listElement.children).filter((item) =>
        item.getAttribute("data-type") === "NodeListItem");
    const index = listItemElements.findIndex((item) => item.getAttribute("data-node-id") === listItemID);
    return index > 0 ? listItemElements[index - 1].getAttribute("data-node-id") : undefined;
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

export const isEmptyListItemBlock = (textContent: string, hasImage: boolean) =>
    ["", "\n"].includes(textContent) && !hasImage;

export const shouldCreateListItemChildOnEnter = (isPrimaryBlock: boolean, isLastBlock: boolean,
                                                 isEmptyBlock: boolean) =>
    !isPrimaryBlock && isLastBlock && !isEmptyBlock;

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

export const getOrderedListMarkerUpdates = (markers: string[], startIndex?: number) => {
    if (markers.length === 0) {
        return [];
    }
    const parsedStartIndex = startIndex === undefined ? Number.parseInt(markers[0], 10) : startIndex;
    const normalizedStartIndex = Number.isFinite(parsedStartIndex) ? Math.trunc(parsedStartIndex) : 1;
    return markers.map((marker, index) => {
        const expectedMarker = `${normalizedStartIndex + index}.`;
        return marker === expectedMarker ? undefined : expectedMarker;
    });
};

export const getOrderedListMaxStart = (itemCount: number) => {
    if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > ORDERED_LIST_MAX_NUMBER) {
        return;
    }
    return ORDERED_LIST_MAX_NUMBER - itemCount + 1;
};

export const parseOrderedListStart = (value: string, itemCount: number) => {
    const maxStart = getOrderedListMaxStart(itemCount);
    if (maxStart === undefined || !/^\d{1,9}$/.test(value)) {
        return;
    }
    const start = Number(value);
    if (!Number.isSafeInteger(start) || start > maxStart) {
        return;
    }
    return start;
};

export const shouldIgnoreListShortcut = (hasBlockSelection: boolean, selectedType?: string) => {
    return hasBlockSelection && selectedType === "NodeListItem";
};

export const isListItemActionElement = (actionElement: Element | false) => {
    return !!actionElement && actionElement.parentElement?.getAttribute("data-type") === "NodeListItem";
};

export const shouldOpenListItemAttr = (shiftKey: boolean, disabled: boolean,
                                       actionElement: Element | false) => {
    return shiftKey && !disabled && isListItemActionElement(actionElement);
};

export const getListConversionType = (sourceSubtype: TListSubtype, targetSubtype: TListSubtype) => {
    if (sourceSubtype === targetSubtype) {
        return;
    }
    return LIST_CONVERSION_TYPES[sourceSubtype][targetSubtype];
};
