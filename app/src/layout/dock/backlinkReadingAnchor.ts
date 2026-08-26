export type TBacklinkReadingPane = "backlink" | "backmention";

export interface IBacklinkReadingAnchor {
    pane: TBacklinkReadingPane,
    rootID: string,
    occurrenceID: string,
    blockID: string,
    offset: number,
    previousBlockID?: string,
    nextBlockID?: string,
    queryKey: string,
}

export interface ICaptureBacklinkReadingAnchorOptions {
    scopeElement: HTMLElement,
    scrollElement: HTMLElement,
    pane: TBacklinkReadingPane,
    queryKey: string,
}

export interface IRestoreBacklinkReadingAnchorOptions extends ICaptureBacklinkReadingAnchorOptions {
    anchor: IBacklinkReadingAnchor,
}

export interface IBacklinkReadingAnchorCandidate {
    top: number,
    bottom: number,
    height: number,
    depth: number,
    order: number,
}

export type TBacklinkReadingAnchorRestoreTarget = "block" | "next" | "previous" | "occurrence" | "document";

interface IBacklinkDOMAnchorCandidate extends IBacklinkReadingAnchorCandidate {
    element: HTMLElement,
    rootID: string,
    occurrenceID: string,
}

interface IBacklinkOccurrence {
    breadcrumbElement: HTMLElement,
    wysiwygElement: HTMLElement,
}

const BLOCK_SELECTOR = "[data-node-id][data-type]";
const BREADCRUMB_SELECTOR = ".protyle-breadcrumb__bar[data-backlink-id]";
const DOCUMENT_SELECTOR = ".backlinkList__item[data-node-id]";

const getAttribute = (element: Element, name: string) => element.getAttribute(name) || "";

const getElementDepth = (element: HTMLElement, ancestor: HTMLElement) => {
    let depth = 0;
    let current: HTMLElement | null = element;
    while (current && current !== ancestor) {
        depth++;
        current = current.parentElement;
    }
    return depth;
};

const getOccurrence = (element: HTMLElement): IBacklinkOccurrence | undefined => {
    const wysiwygElement = element.closest(".protyle-wysiwyg") as HTMLElement;
    if (!wysiwygElement) {
        return;
    }
    let topLevelElement = element;
    while (topLevelElement.parentElement && topLevelElement.parentElement !== wysiwygElement) {
        topLevelElement = topLevelElement.parentElement;
    }
    if (topLevelElement.parentElement !== wysiwygElement) {
        return;
    }
    let siblingElement = topLevelElement.previousElementSibling as HTMLElement;
    while (siblingElement) {
        if (siblingElement.matches(BREADCRUMB_SELECTOR)) {
            return {
                breadcrumbElement: siblingElement,
                wysiwygElement,
            };
        }
        siblingElement = siblingElement.previousElementSibling as HTMLElement;
    }
};

const getOccurrenceBlocks = (occurrence: IBacklinkOccurrence) => {
    const blocks: HTMLElement[] = [];
    let siblingElement = occurrence.breadcrumbElement.nextElementSibling as HTMLElement;
    while (siblingElement && !siblingElement.matches(BREADCRUMB_SELECTOR)) {
        if (siblingElement.matches(BLOCK_SELECTOR)) {
            blocks.push(siblingElement);
        }
        blocks.push(...Array.from(siblingElement.querySelectorAll(BLOCK_SELECTOR)).filter(item =>
            item.closest(".protyle-wysiwyg") === occurrence.wysiwygElement
        ) as HTMLElement[]);
        siblingElement = siblingElement.nextElementSibling as HTMLElement;
    }
    return blocks;
};

const compareCandidatePrecision = <T extends IBacklinkReadingAnchorCandidate>(left: T, right: T) => {
    if (left.depth !== right.depth) {
        return right.depth - left.depth;
    }
    if (left.height !== right.height) {
        return left.height - right.height;
    }
    return left.order - right.order;
};

export const selectBacklinkReadingAnchorCandidate = <T extends IBacklinkReadingAnchorCandidate>(
    candidates: T[],
    viewportTop: number,
    viewportBottom: number,
) => {
    const visibleCandidates = candidates.filter(item => item.bottom > viewportTop && item.top < viewportBottom);
    const crossingCandidates = visibleCandidates.filter(item => item.top <= viewportTop && item.bottom >= viewportTop);
    if (crossingCandidates.length > 0) {
        return [...crossingCandidates].sort(compareCandidatePrecision)[0];
    }
    return [...visibleCandidates].sort((left, right) => {
        if (left.top !== right.top) {
            return left.top - right.top;
        }
        return compareCandidatePrecision(left, right);
    })[0];
};

const collectDOMCandidates = (scopeElement: HTMLElement) => {
    const candidates: IBacklinkDOMAnchorCandidate[] = [];
    const elements = Array.from(scopeElement.querySelectorAll(`.protyle-wysiwyg ${BLOCK_SELECTOR}`)) as HTMLElement[];
    elements.forEach((element, order) => {
        const occurrence = getOccurrence(element);
        const documentElement = element.closest(DOCUMENT_SELECTOR) as HTMLElement;
        const rootID = documentElement && getAttribute(documentElement, "data-node-id");
        const occurrenceID = occurrence && getAttribute(occurrence.breadcrumbElement, "data-backlink-id");
        const blockID = getAttribute(element, "data-node-id");
        if (!occurrence || !rootID || !occurrenceID || !blockID) {
            return;
        }
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= rect.top) {
            return;
        }
        candidates.push({
            element,
            rootID,
            occurrenceID,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            depth: getElementDepth(element, occurrence.wysiwygElement),
            order,
        });
    });
    return candidates;
};

const collectDocumentCandidates = (scopeElement: HTMLElement) => {
    return (Array.from(scopeElement.querySelectorAll(
        `${DOCUMENT_SELECTOR} > .b3-list-item[data-node-id]`
    )) as HTMLElement[]).map((element, order) => {
        const rect = element.getBoundingClientRect();
        return {
            element,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            depth: 0,
            order,
        };
    }).filter(item => item.bottom > item.top);
};

export const captureBacklinkReadingAnchor = (options: ICaptureBacklinkReadingAnchorOptions) => {
    const scrollRect = options.scrollElement.getBoundingClientRect();
    const scopeRect = options.scopeElement.getBoundingClientRect();
    const viewportTop = Math.max(scrollRect.top, scopeRect.top);
    const viewportBottom = Math.min(scrollRect.bottom, scopeRect.bottom);
    if (viewportBottom <= viewportTop) {
        return;
    }
    const candidate = selectBacklinkReadingAnchorCandidate(
        collectDOMCandidates(options.scopeElement),
        viewportTop,
        viewportBottom,
    );
    if (!candidate) {
        const documentCandidate = selectBacklinkReadingAnchorCandidate(
            collectDocumentCandidates(options.scopeElement),
            viewportTop,
            viewportBottom,
        );
        if (!documentCandidate) {
            return;
        }
        return {
            pane: options.pane,
            rootID: getAttribute(documentCandidate.element, "data-node-id"),
            occurrenceID: "",
            blockID: "",
            offset: documentCandidate.top - scrollRect.top,
            queryKey: options.queryKey,
        } satisfies IBacklinkReadingAnchor;
    }
    const occurrence = getOccurrence(candidate.element);
    if (!occurrence) {
        return;
    }
    const blocks = getOccurrenceBlocks(occurrence);
    const blockIndex = blocks.indexOf(candidate.element);
    const previousBlockID = blockIndex > 0 ? getAttribute(blocks[blockIndex - 1], "data-node-id") : undefined;
    const nextBlockID = blockIndex > -1 && blockIndex < blocks.length - 1 ?
        getAttribute(blocks[blockIndex + 1], "data-node-id") : undefined;
    return {
        pane: options.pane,
        rootID: candidate.rootID,
        occurrenceID: candidate.occurrenceID,
        blockID: getAttribute(candidate.element, "data-node-id"),
        offset: candidate.top - scrollRect.top,
        previousBlockID: previousBlockID || undefined,
        nextBlockID: nextBlockID || undefined,
        queryKey: options.queryKey,
    } satisfies IBacklinkReadingAnchor;
};

const findElementByAttribute = (elements: Element[], name: string, value: string) => {
    return elements.find(item => item.getAttribute(name) === value) as HTMLElement;
};

const isVisibleAnchorElement = (element?: HTMLElement) => {
    if (!element || element.closest(".fn__none")) {
        return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.bottom > rect.top;
};

const findDocumentElement = (scopeElement: HTMLElement, rootID: string) => {
    return findElementByAttribute(
        Array.from(scopeElement.querySelectorAll(DOCUMENT_SELECTOR)),
        "data-node-id",
        rootID,
    );
};

const findDocumentTitleElement = (documentElement: HTMLElement) => {
    return Array.from(documentElement.children).find(item => item.matches(".b3-list-item[data-node-id]")) as HTMLElement;
};

export const restoreBacklinkReadingAnchor = (options: IRestoreBacklinkReadingAnchorOptions) => {
    const {anchor} = options;
    if (anchor.pane !== options.pane || anchor.queryKey !== options.queryKey) {
        return;
    }
    if (!isVisibleAnchorElement(options.scopeElement)) {
        return;
    }
    const documentElement = findDocumentElement(options.scopeElement, anchor.rootID);
    if (!documentElement) {
        return;
    }
    const breadcrumbElement = findElementByAttribute(
        Array.from(documentElement.querySelectorAll(BREADCRUMB_SELECTOR)),
        "data-backlink-id",
        anchor.occurrenceID,
    );
    let targetElement: HTMLElement;
    let target: TBacklinkReadingAnchorRestoreTarget;
    if (breadcrumbElement) {
        const occurrence = {
            breadcrumbElement,
            wysiwygElement: breadcrumbElement.parentElement,
        } as IBacklinkOccurrence;
        const blocks = getOccurrenceBlocks(occurrence);
        const blockCandidates: Array<[string, TBacklinkReadingAnchorRestoreTarget]> = [
            [anchor.blockID, "block"],
            [anchor.nextBlockID, "next"],
            [anchor.previousBlockID, "previous"],
        ];
        for (const [blockID, candidateTarget] of blockCandidates) {
            if (!blockID) {
                continue;
            }
            const candidateElement = findElementByAttribute(blocks, "data-node-id", blockID);
            if (isVisibleAnchorElement(candidateElement)) {
                targetElement = candidateElement;
                target = candidateTarget;
                break;
            }
        }
        if (!targetElement) {
            targetElement = breadcrumbElement;
            target = "occurrence";
        }
    } else {
        targetElement = findDocumentTitleElement(documentElement);
        target = "document";
    }
    if (!isVisibleAnchorElement(targetElement)) {
        return;
    }
    const scrollRect = options.scrollElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    options.scrollElement.scrollTop += targetRect.top - scrollRect.top - anchor.offset;
    return target;
};
