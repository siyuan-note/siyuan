export const BLOCK_SELECTION_MODE_CLASS = "protyle-wysiwyg--select-mode";
export const BLOCK_SELECTION_CLASS = "protyle-wysiwyg--select";

type TAdjacentBlock = (element: Element) => Element | false | null | undefined;

export interface IBlockSelectionModeState {
    activeID?: string;
    selections: Array<{
        id: string;
        selectStart?: string;
        selectEnd?: string;
    }>;
}

const getNextBlockSibling = (element: Element) => {
    let nextElement = element.nextElementSibling;
    while (nextElement && !nextElement.getAttribute("data-node-id")) {
        nextElement = nextElement.nextElementSibling;
    }
    return nextElement;
};

const clearSelectionState = (element: Element) => {
    element.classList.remove(BLOCK_SELECTION_CLASS);
    element.removeAttribute("select-start");
    element.removeAttribute("select-end");
};

export const getBlockSelectionModeElement = (editorElement: Element) =>
    editorElement.querySelector<HTMLElement>(`.${BLOCK_SELECTION_MODE_CLASS}`) || undefined;

export const setBlockSelectionModeElement = (editorElement: Element, targetElement: Element) => {
    if (!editorElement.contains(targetElement) || !targetElement.getAttribute("data-node-id")) {
        return undefined;
    }
    editorElement.querySelectorAll(`.${BLOCK_SELECTION_MODE_CLASS}`).forEach(item => {
        if (item !== targetElement) {
            item.classList.remove(BLOCK_SELECTION_MODE_CLASS);
        }
    });
    targetElement.classList.add(BLOCK_SELECTION_MODE_CLASS);
    return targetElement as HTMLElement;
};

export const clearBlockSelection = (editorElement: Element) => {
    editorElement.querySelectorAll(`.${BLOCK_SELECTION_CLASS}`).forEach(clearSelectionState);
};

export const clearBlockSelectionMode = (editorElement: Element, clearMarks = false) => {
    editorElement.querySelectorAll(`.${BLOCK_SELECTION_MODE_CLASS}`).forEach(item => {
        item.classList.remove(BLOCK_SELECTION_MODE_CLASS);
    });
    if (clearMarks) {
        clearBlockSelection(editorElement);
    }
};

export const captureBlockSelectionModeState = (rootElement: Element): IBlockSelectionModeState => {
    const elements = [rootElement, ...Array.from(rootElement.querySelectorAll("[data-node-id]"))];
    const selectionModeElement = elements.find(item => item.classList.contains(BLOCK_SELECTION_MODE_CLASS));
    return {
        activeID: selectionModeElement?.getAttribute("data-node-id") || undefined,
        selections: elements.filter(item => item.classList.contains(BLOCK_SELECTION_CLASS)).flatMap(item => {
            const id = item.getAttribute("data-node-id");
            return id ? [{
                id,
                selectStart: item.getAttribute("select-start") || undefined,
                selectEnd: item.getAttribute("select-end") || undefined,
            }] : [];
        }),
    };
};

export const restoreBlockSelectionModeState = (editorElement: Element, rootElement: Element,
                                            state: IBlockSelectionModeState) => {
    const elements = [rootElement, ...Array.from(rootElement.querySelectorAll("[data-node-id]"))];
    const findElement = (id: string) => elements.find(item => item.getAttribute("data-node-id") === id);
    state.selections.forEach(selection => {
        const element = findElement(selection.id);
        if (!element) {
            return;
        }
        element.classList.add(BLOCK_SELECTION_CLASS);
        if (selection.selectStart) {
            element.setAttribute("select-start", selection.selectStart);
        }
        if (selection.selectEnd) {
            element.setAttribute("select-end", selection.selectEnd);
        }
    });
    if (state.activeID) {
        const selectionModeElement = findElement(state.activeID);
        if (selectionModeElement) {
            setBlockSelectionModeElement(editorElement, selectionModeElement);
            return selectionModeElement as HTMLElement;
        }
    }
    return undefined;
};

export const cleanBlockSelectionModeHTML = (html: string) => {
    if (!html.includes(BLOCK_SELECTION_MODE_CLASS)) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    const selectionModeElements = template.content.querySelectorAll(`.${BLOCK_SELECTION_MODE_CLASS}`);
    if (selectionModeElements.length === 0) {
        return html;
    }
    selectionModeElements.forEach(item => item.classList.remove(BLOCK_SELECTION_MODE_CLASS));
    return template.innerHTML;
};

export const getBlockSelectionToggle = (selectedElements: Element[], targetElement: Element) => {
    if (selectedElements.includes(targetElement)) {
        return selectedElements.filter(item => item !== targetElement);
    }
    return selectedElements.filter(item => !item.contains(targetElement) && !targetElement.contains(item))
        .concat(targetElement);
};

export const toggleBlockSelection = (editorElement: Element, targetElement: Element) => {
    const selectedElements = Array.from(editorElement.querySelectorAll(`.${BLOCK_SELECTION_CLASS}`));
    const nextSelection = getBlockSelectionToggle(selectedElements, targetElement);
    const nextSelectionSet = new Set(nextSelection);
    selectedElements.forEach(item => {
        if (!nextSelectionSet.has(item)) {
            clearSelectionState(item);
        }
    });
    if (!targetElement.classList.contains(BLOCK_SELECTION_CLASS) && nextSelectionSet.has(targetElement)) {
        targetElement.classList.add(BLOCK_SELECTION_CLASS);
    }
    nextSelection.forEach(item => {
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
    });
    return Array.from(editorElement.querySelectorAll<HTMLElement>(`.${BLOCK_SELECTION_CLASS}`));
};

export const getBlockOperationElements = (editorElement: Element, currentElement?: Element) => {
    const markedElements = Array.from(editorElement.querySelectorAll<HTMLElement>(`.${BLOCK_SELECTION_CLASS}`));
    if (markedElements.length > 0) {
        return markedElements;
    }
    return currentElement ? [currentElement as HTMLElement] : [];
};

export const getBlockSelectionStatusIDs = (editorElement: Element) => {
    const operationElements = getBlockOperationElements(editorElement, getBlockSelectionModeElement(editorElement));
    return operationElements.map(item => item.getAttribute("data-node-id")).filter(Boolean);
};

export const isContinuousBlockSelection = (elements: Element[], getNext: TAdjacentBlock = getNextBlockSibling) => {
    const uniqueElements = Array.from(new Set(elements));
    if (uniqueElements.length === 0) {
        return false;
    }
    const parentElement = uniqueElements[0].parentElement;
    if (!parentElement || uniqueElements.some(item => item.parentElement !== parentElement)) {
        return false;
    }
    return uniqueElements.every((item, index) => index === uniqueElements.length - 1 ||
        getNext(item) === uniqueElements[index + 1]);
};

export const getDeleteSelectionCandidate = (elements: Element[], type: "Delete" | "Backspace" | "remove",
                                             getPrevious: TAdjacentBlock, getNext: TAdjacentBlock) => {
    const targets = Array.from(new Set(elements));
    if (targets.length === 0) {
        return undefined;
    }
    const isDeleted = (element: Element) => targets.some(target => target === element || target.contains(element));
    const findCandidate = (startElement: Element, getAdjacent: TAdjacentBlock) => {
        const visited = new Set<Element>();
        let candidate = getAdjacent(startElement);
        while (candidate && (isDeleted(candidate) || visited.has(candidate))) {
            if (visited.has(candidate)) {
                return undefined;
            }
            visited.add(candidate);
            candidate = getAdjacent(candidate);
        }
        return candidate || undefined;
    };
    const firstElement = targets[0];
    const lastElement = targets[targets.length - 1];
    if (type === "Backspace") {
        const previousElement = findCandidate(firstElement, getPrevious);
        if (previousElement) {
            return {element: previousElement, side: "before" as const};
        }
        const nextElement = findCandidate(lastElement, getNext);
        return nextElement ? {element: nextElement, side: "after" as const} : undefined;
    }
    const nextElement = findCandidate(lastElement, getNext);
    if (nextElement) {
        return {element: nextElement, side: "after" as const};
    }
    const previousElement = findCandidate(firstElement, getPrevious);
    return previousElement ? {element: previousElement, side: "before" as const} : undefined;
};
