import {
    focusBlock,
    focusByOffset,
    focusByRange,
    focusByWbr,
    getBlockRanges,
    getEditorRange,
    getSelectionOffset,
    getUndoFocusContext,
    restoreFocusContext,
    setLastNodeRange
} from "../util/selection";
import {
    fixAdjacentTags,
    getContenteditableElement,
    getEmbedChildOperationContext,
    getEmbedChildOperationParentID,
    getLastBlock,
    getNextBlock,
    getParentBlock,
    getPreviousBlock,
    getPreviousBlockSibling,
    getSbChildBlockCount,
    getTopAloneElement,
    getTopEmptyElement,
    hasNextSibling,
    hasPreviousSibling,
    IEmbedChildOperationContext,
    isNotEditBlock
} from "./getBlock";
import {transaction, turnsIntoOneTransaction, turnsIntoTransaction, updateTransaction} from "./transaction";
import {cancelSB, genEmptyElement, rebalanceSbWidth, refreshSbResize} from "../../block/util";
import {
    getFocusedOrderedListDeleteOperations,
    getFocusedOrderedListRemoveOperations,
    getFocusedParentOrderedList,
    getOrderedListStart,
    listOutdent,
    updateListOrder
} from "./list";
import {zoomOut} from "../../menus/protyle";
import {preventScroll} from "../scroll/preventScroll";
import {hideElements} from "../ui/hideElements";
import {Constants} from "../../constants";
import {scrollCenter} from "../../util/highlightById";
import {isMobile} from "../../util/functions";
import {mathRender} from "../render/mathRender";
import {hasClosestBlock, hasClosestByClassName, hasClosestByTag, isInEmbedBlock} from "../util/hasClosest";
/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif
import {fetchSyncPost} from "../../util/fetch";
import {setFold} from "../util/blockFold";
import {highlightRender} from "../render/highlightRender";
import {processRender} from "../util/processCode";
import {avRender} from "../render/av/render";
import {blockRender} from "../render/blockRender";
import * as dayjs from "dayjs";
import {mergeSameInlineElement} from "../toolbar/util";
import {
    getBlockRefCheckElementChain,
    getCrossBlockEndAction,
    getCrossBlockNestedListMergeContext,
    getCrossBlockMergeRemoveElement,
    getCrossBlockSiblingListItemMergeContext,
    getDeletedBlockElements,
    isNativeCrossBlockCompositionSupported,
    isEntireBlockContentSelected,
    mergeCrossBlockNestedLists,
    mergeCrossBlockSiblingListItems
} from "./removeRange";
import {confirmBlockRef} from "../../util/checkBlockRef";
import {input} from "./input";
import {isWindows} from "../util/compatibility";
import {
    BLOCK_SELECTION_MODE_CLASS,
    BLOCK_SELECTION_CLASS,
    getBlockSelectionModeElement,
    getBlockSelectionStatusIDs,
    getDeleteSelectionCandidate,
    setBlockSelectionModeElement
} from "./blockSelection";
import {countBlockWord} from "../../layout/status";
import {
    getSemanticInlineVisibleText,
    getTextWithoutSemanticMarkers,
    hasSemanticInlineType,
    normalizeSemanticInlineElements,
    removeSemanticInlineExternalBoundaries
} from "../util/inlineElementMarker";

export interface IBlockRefCheckTargets {
    elements: HTMLElement[];
    exactIDs: string[];
    deletedIDs: string[];
}

interface ICrossBlockReplacement {
    event?: InputEvent;
    text: string;
}

export interface ICrossBlockComposition {
    preventNativeInput: boolean;

    update(text: string): void;

    preservePreview(): void;

    complete(committed: boolean, range: Range): Promise<void>;
}

const hasMeaningfulContent = (element: Element) => {
    const text = getTextWithoutSemanticMarkers(element).split(Constants.ZWSP).join("").trim();
    return text !== "" || !!element.querySelector(".img, .emoji, [data-type~='inline-math']");
};

const isEntireMeaningfulContentSelected = (selectedRange: Range, editableElement: Element) => {
    const contentRange = document.createRange();
    contentRange.selectNodeContents(editableElement);
    if (isEntireBlockContentSelected(selectedRange, contentRange)) {
        return true;
    }
    const beforeRange = contentRange.cloneRange();
    beforeRange.setEnd(selectedRange.startContainer, selectedRange.startOffset);
    const afterRange = contentRange.cloneRange();
    afterRange.setStart(selectedRange.endContainer, selectedRange.endOffset);
    const beforeElement = document.createElement("div");
    beforeElement.append(beforeRange.cloneContents());
    const afterElement = document.createElement("div");
    afterElement.append(afterRange.cloneContents());
    return !hasMeaningfulContent(beforeElement) && !hasMeaningfulContent(afterElement);
};

const ensureListItemContentBlock = (listItemElement: Element, doOperations: IOperation[],
                                    undoOperations: IOperation[]) => {
    if (listItemElement.getAttribute("data-type") !== "NodeListItem") {
        return false;
    }
    const firstBlock = Array.from(listItemElement.children).find(item => item.hasAttribute("data-node-id"));
    if (firstBlock?.getAttribute("data-type") !== "NodeList") {
        return false;
    }
    const emptyID = Lute.NewNodeID();
    const emptyElement = genEmptyElement(false, false, emptyID);
    listItemElement.querySelector(":scope > .protyle-action")?.after(emptyElement);
    doOperations.push({
        action: "insert",
        id: emptyID,
        data: emptyElement.outerHTML,
        nextID: firstBlock.getAttribute("data-node-id"),
        parentID: listItemElement.getAttribute("data-node-id"),
    });
    undoOperations.push({
        action: "delete",
        id: emptyID,
    });
    return true;
};

const getCrossBlockRemovalContext = (editorElement: HTMLElement, selectedRange: Range,
                                     startElement: HTMLElement, endElement: HTMLElement,
                                     handleEndElement = true) => {
    const ranges = getBlockRanges(editorElement, selectedRange);
    const rangeStartElement = ranges[0]?.blockElement || startElement;
    const selectedElements: HTMLElement[] = [];
    selectedRange.cloneContents().querySelectorAll<HTMLElement>("[data-node-id]").forEach(item => {
        const element = editorElement.querySelector<HTMLElement>(`[data-node-id="${item.getAttribute("data-node-id")}"]`);
        if (!element || selectedElements.includes(element) || element === rangeStartElement || element === endElement ||
            element.contains(rangeStartElement) || element.contains(endElement) || isInEmbedBlock(element)) {
            return;
        }
        const elementRange = document.createRange();
        elementRange.selectNode(element);
        if (selectedRange.compareBoundaryPoints(Range.START_TO_START, elementRange) <= 0 &&
            selectedRange.compareBoundaryPoints(Range.END_TO_END, elementRange) >= 0) {
            selectedElements.push(element);
        }
    });
    const selectedSet = new Set(selectedElements);
    const rangeRemoveElements = selectedElements.filter(item => {
        return !selectedSet.has(item.parentElement.closest<HTMLElement>("[data-node-id]"));
    });
    const removeElements = [...rangeRemoveElements];
    const rangesByBlock = new Map<HTMLElement, typeof ranges>();
    ranges.forEach(item => {
        if (removeElements.some(removeElement => removeElement.contains(item.blockElement))) {
            return;
        }
        const blockRanges = rangesByBlock.get(item.blockElement) || [];
        blockRanges.push(item);
        rangesByBlock.set(item.blockElement, blockRanges);
    });

    const startEditableElement = rangesByBlock.get(rangeStartElement)?.[0]?.editableElement;
    const endBlockRange = rangesByBlock.get(endElement)?.[0];
    const endEditableElement = endBlockRange?.editableElement;
    let mergeEndElement: Element;
    const siblingListItemMergeContext = getCrossBlockSiblingListItemMergeContext(
        editorElement, rangeStartElement, endElement);
    const endAction = handleEndElement && rangeStartElement !== endElement && startEditableElement && endBlockRange ?
        getCrossBlockEndAction(
            rangeStartElement.getAttribute("data-type"),
            endElement.getAttribute("data-type"),
            isEntireMeaningfulContentSelected(endBlockRange.range, endEditableElement),
            endElement.getAttribute("fold") === "1",
        ) : undefined;
    if (endAction) {
        const topElement = (endAction === "merge" ? siblingListItemMergeContext?.removeEndElement : undefined) ||
            getCrossBlockMergeRemoveElement(editorElement, rangeStartElement, endElement);
        if (topElement) {
            if (endAction === "merge") {
                mergeEndElement = topElement;
            }
            for (let i = removeElements.length - 1; i >= 0; i--) {
                if (topElement.contains(removeElements[i])) {
                    removeElements.splice(i, 1);
                }
            }
            removeElements.push(topElement);
        }
    }

    const updateElements = Array.from(rangesByBlock.keys()).filter(item => {
        return !removeElements.some(removeElement => removeElement.contains(item));
    });
    return {
        ranges,
        startElement: rangeStartElement,
        endElement,
        rangeRemoveElements,
        removeElements,
        rangesByBlock,
        startEditableElement,
        endEditableElement,
        mergeEndElement,
        siblingListItemMergeContext,
        updateElements,
    };
};

const getCrossBlockRemovalPlan = (editorElement: HTMLElement, selectedRange: Range,
                                   startElement: HTMLElement, endElement: HTMLElement,
                                   handleEndElement = true, replacement = false) => {
    const context = getCrossBlockRemovalContext(
        editorElement, selectedRange, startElement, endElement, handleEndElement);
    if (!handleEndElement) {
        return {
            ...context,
            nestedListMergeContext: undefined,
            replacementListItemElement: undefined,
            removeStartListItem: false,
            startRemoveListItemElement: undefined,
            retainedElements: [],
        };
    }
    const nestedListMergeContext = getCrossBlockNestedListMergeContext(editorElement, selectedRange,
        context.ranges[0]?.blockElement || startElement,
        context.ranges[context.ranges.length - 1]?.blockElement || endElement);
    const replacementListItemElement = replacement ? nestedListMergeContext?.replacementListItemElement : undefined;
    const removeStartListItem = !replacement && !!nestedListMergeContext &&
        (!!nestedListMergeContext.replacementListItemElement ||
            nestedListMergeContext.startTextFullySelected && nestedListMergeContext.startTrailingListItems.length > 0);
    const startRemoveListItemElement = (!replacement ? nestedListMergeContext?.replacementListItemElement :
        undefined) ||
        (removeStartListItem ? nestedListMergeContext?.startListItemElement : undefined);
    const nestedListRemoveElements = nestedListMergeContext ? [
        ...(startRemoveListItemElement ? [startRemoveListItemElement] : []),
        ...nestedListMergeContext.startTrailingListItems,
        nestedListMergeContext.endOuterListItemElement,
    ] : [];
    const retainedElements = [
        ...(replacementListItemElement ? [replacementListItemElement] : []),
        ...(context.siblingListItemMergeContext?.trailingEndBlockElements || []),
        ...(context.siblingListItemMergeContext?.trailingEndListItemElements || []),
    ];
    if (nestedListMergeContext) {
        let item = nestedListMergeContext.endListItemElement.nextElementSibling as HTMLElement;
        while (item?.getAttribute("data-type") === "NodeListItem") {
            retainedElements.push(item);
            item = item.nextElementSibling as HTMLElement;
        }
    }
    if (nestedListMergeContext) {
        for (let i = context.removeElements.length - 1; i >= 0; i--) {
            if (nestedListRemoveElements.some(element => element.contains(context.removeElements[i]))) {
                context.removeElements.splice(i, 1);
            }
        }
        nestedListRemoveElements.forEach(element => {
            if (!context.removeElements.some(item => item === element || item.contains(element))) {
                context.removeElements.push(element);
            }
        });
        context.removeElements.sort((a, b) => a === b ? 0 :
            a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        context.rangesByBlock.forEach((value, element) => {
            if (nestedListRemoveElements.some(removeElement => removeElement.contains(element))) {
                context.rangesByBlock.delete(element);
            }
        });
        for (let i = context.updateElements.length - 1; i >= 0; i--) {
            if (nestedListRemoveElements.some(element => element.contains(context.updateElements[i]))) {
                context.updateElements.splice(i, 1);
            }
        }
    }
    return {
        ...context,
        nestedListMergeContext,
        replacementListItemElement,
        removeStartListItem,
        startRemoveListItemElement,
        retainedElements,
    };
};

const addExactRefCheckElement = (elementsByID: Map<string, HTMLElement>, exactIDs: Set<string>,
                                 element: HTMLElement) => {
    const id = element?.getAttribute("data-node-id");
    if (id) {
        elementsByID.set(id, element);
        exactIDs.add(id);
    }
};

const addExactRefCheckElementChain = (elementsByID: Map<string, HTMLElement>, exactIDs: Set<string>,
                                      element: HTMLElement) => {
    const topElement = getTopAloneElement(element) as HTMLElement;
    getBlockRefCheckElementChain(element, topElement).forEach(item => {
        addExactRefCheckElement(elementsByID, exactIDs, item);
    });
};

const getBlockRefCheckTargetsFromContext = (context: ReturnType<typeof getCrossBlockRemovalContext>,
                                            removedElements: HTMLElement[], retainedElements: HTMLElement[] = []) => {
    const elementsByID = new Map<string, HTMLElement>();
    const exactIDs = new Set<string>();
    const deletionTargets = getDeletedBlockElements(removedElements, retainedElements);
    const deletedIDs = new Set<string>();
    deletionTargets.elements.forEach(item => {
        const id = item.getAttribute("data-node-id");
        if (id) {
            elementsByID.set(id, item);
            deletedIDs.add(id);
        }
    });
    let mergedEndHasRemainingContent = false;
    if (context.mergeEndElement) {
        const endRange = context.ranges.find(item => item.blockElement === context.endElement);
        if (endRange) {
            mergedEndHasRemainingContent = !isEntireMeaningfulContentSelected(
                endRange.range, endRange.editableElement);
        }
    }
    context.ranges.forEach(item => {
        if (removedElements.some(removeElement => removeElement.contains(item.blockElement)) ||
            getContenteditableElement(item.blockElement) !== item.editableElement ||
            (mergedEndHasRemainingContent && item.blockElement === context.startElement)) {
            return;
        }
        if (!isEntireMeaningfulContentSelected(item.range, item.editableElement)) {
            return;
        }
        addExactRefCheckElementChain(elementsByID, exactIDs, item.blockElement);
    });
    deletedIDs.forEach(id => {
        if (deletionTargets.expansionStopIDs.has(id)) {
            exactIDs.add(id);
        } else {
            exactIDs.delete(id);
        }
    });
    return {
        elements: Array.from(elementsByID.values()),
        exactIDs: Array.from(exactIDs),
        deletedIDs: Array.from(deletedIDs),
    };
};

const deleteCrossBlockRangeContents = (rangesByBlock: ReturnType<typeof getCrossBlockRemovalContext>["rangesByBlock"]) => {
    rangesByBlock.forEach(blockRanges => {
        blockRanges.forEach(item => {
            const boundarySpans = new Set<HTMLElement>([
                hasClosestByTag(item.range.startContainer, "SPAN"),
                hasClosestByTag(item.range.endContainer, "SPAN"),
            ].filter(Boolean) as HTMLElement[]);
            const dynamicRefTexts = new Map(Array.from(boundarySpans)
                .filter(refElement => refElement.getAttribute("data-type")?.split(" ").includes("block-ref") &&
                    refElement.getAttribute("data-subtype") === "d")
                .map(refElement => [refElement, refElement.textContent] as const));
            item.range.deleteContents();
            dynamicRefTexts.forEach((text, refElement) => {
                if (refElement.isConnected && refElement.textContent !== text) {
                    refElement.setAttribute("data-subtype", "s");
                }
            });
            boundarySpans.forEach(spanElement => {
                const isSemanticInline = hasSemanticInlineType(spanElement.getAttribute("data-type"));
                const isEmpty = isSemanticInline ?
                    getSemanticInlineVisibleText(spanElement) === "" : spanElement.textContent === "";
                if (spanElement.isConnected && isEmpty && !spanElement.querySelector("img")) {
                    if (isSemanticInline) {
                        removeSemanticInlineExternalBoundaries(spanElement);
                    }
                    spanElement.remove();
                }
            });
        });
        const editableElement = blockRanges[0]?.editableElement;
        if (editableElement?.isConnected) {
            fixAdjacentTags(editableElement);
            normalizeSemanticInlineElements(editableElement);
        }
    });
};

const getEditorRootElement = (editorElement: HTMLElement, blockElement: HTMLElement) => {
    let rootElement = blockElement;
    while (rootElement.parentElement && rootElement.parentElement !== editorElement) {
        rootElement = rootElement.parentElement;
    }
    return rootElement.parentElement === editorElement ? rootElement : undefined;
};

export const prepareCrossBlockComposition = (protyle: IProtyle, selectedRange: Range,
                                               startElement: HTMLElement, endElement: HTMLElement):
ICrossBlockComposition | undefined => {
    const editorElement = protyle.wysiwyg.element;
    const ranges = getBlockRanges(editorElement, selectedRange);
    const startRootElement = getEditorRootElement(editorElement, startElement);
    const endRootElement = getEditorRootElement(editorElement, endElement);
    const undoFocusContext = getUndoFocusContext(editorElement, selectedRange, true);
    if (!startRootElement || !endRootElement || !undoFocusContext) {
        return;
    }
    const snapshotNodes: Node[] = [];
    const sourceRects: { left: number; top: number; width: number }[] = [];
    let currentNode: Node = startRootElement;
    while (currentNode) {
        snapshotNodes.push(currentNode.cloneNode(true));
        if (currentNode.nodeType === Node.ELEMENT_NODE) {
            const rect = (currentNode as HTMLElement).getBoundingClientRect();
            sourceRects.push({
                left: rect.left,
                top: rect.top,
                width: rect.width,
            });
        }
        if (currentNode === endRootElement) {
            break;
        }
        currentNode = currentNode.nextSibling;
    }
    const snapshotTypes = snapshotNodes.flatMap(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return [];
        }
        const element = node as HTMLElement;
        return [element, ...Array.from(element.querySelectorAll<HTMLElement>("[data-node-id]"))]
            .map(item => item.getAttribute("data-type") || "");
    });
    if (currentNode !== endRootElement || !isNativeCrossBlockCompositionSupported(
        ranges.map(item => item.blockElement.getAttribute("data-type") || ""), snapshotTypes)) {
        return;
    }
    const startMarker = document.createComment("siyuan-cross-block-composition-start");
    const endMarker = document.createComment("siyuan-cross-block-composition-end");
    startRootElement.before(startMarker);
    endRootElement.after(endMarker);
    const previewElements: HTMLElement[] = [];
    const sourceElements: HTMLElement[] = [];
    let compositionText = "";

    const markPreviewRange = (range: Range) => {
        const textSegments: { node: Text; start: number; end: number }[] = [];
        const commonAncestor = range.commonAncestorContainer;
        const addTextSegment = (textNode: Text) => {
            if (range.intersectsNode(textNode)) {
                const start = textNode === range.startContainer ? range.startOffset : 0;
                const end = textNode === range.endContainer ? range.endOffset : textNode.data.length;
                if (start < end) {
                    textSegments.push({node: textNode, start, end});
                }
            }
        };
        if (commonAncestor.nodeType === Node.TEXT_NODE) {
            addTextSegment(commonAncestor as Text);
        } else {
            const walker = document.createTreeWalker(commonAncestor, NodeFilter.SHOW_TEXT);
            let textNode = walker.nextNode() as Text;
            while (textNode) {
                addTextSegment(textNode);
                textNode = walker.nextNode() as Text;
            }
        }
        textSegments.reverse().forEach(item => {
            const selectedNode = item.start === 0 ? item.node : item.node.splitText(item.start);
            if (item.end - item.start < selectedNode.data.length) {
                selectedNode.splitText(item.end - item.start);
            }
            const selectionElement = document.createElement("span");
            selectionElement.className = "protyle-cross-block-preview__selection";
            selectedNode.before(selectionElement);
            selectionElement.append(selectedNode);
        });
    };

    const preservePreview = () => {
        if (!isWindows() || previewElements.length > 0 ||
            startMarker.parentNode !== editorElement || endMarker.parentNode !== editorElement) {
            return;
        }
        let sourceNode = startMarker.nextSibling;
        while (sourceNode && sourceNode !== endMarker) {
            if (sourceNode.nodeType === Node.ELEMENT_NODE) {
                sourceElements.push(sourceNode as HTMLElement);
            }
            sourceNode = sourceNode.nextSibling;
        }
        if (sourceNode !== endMarker || sourceElements.length === 0) {
            return;
        }
        const previewFragment = document.createDocumentFragment();
        snapshotNodes.forEach(snapshotNode => {
            const previewNode = snapshotNode.cloneNode(true);
            previewFragment.append(previewNode);
            if (previewNode.nodeType === Node.ELEMENT_NODE) {
                const previewElement = previewNode as HTMLElement;
                previewElement.classList.add("protyle-cross-block-preview");
                previewElement.setAttribute("contenteditable", "false");
                previewElement.setAttribute("aria-hidden", "true");
                previewElement.querySelectorAll<HTMLElement>("[contenteditable]").forEach(
                    element => element.setAttribute("contenteditable", "false"));
                previewElements.push(previewElement);
            }
        });
        ranges.forEach(item => {
            const blockID = item.blockElement.getAttribute("data-node-id");
            if (!blockID) {
                return;
            }
            let previewBlockElement: HTMLElement;
            previewElements.find(element => {
                previewBlockElement = element.getAttribute("data-node-id") === blockID ? element :
                    element.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(blockID)}"]`);
                return !!previewBlockElement;
            });
            if (!previewBlockElement) {
                return;
            }
            let previewEditableElement: Element | undefined;
            if (["TD", "TH"].includes(item.editableElement.tagName)) {
                const cellIndex = Array.from(item.blockElement.querySelectorAll("th, td")).indexOf(item.editableElement);
                previewEditableElement = previewBlockElement.querySelectorAll("th, td")[cellIndex];
            } else if (item.editableElement.classList.contains("callout-title")) {
                previewEditableElement = previewBlockElement.querySelector(".callout-title");
            } else {
                previewEditableElement = getContenteditableElement(previewBlockElement);
            }
            const previewRange = focusByOffset(previewEditableElement, item.start, item.end, false);
            if (previewRange) {
                markPreviewRange(previewRange);
            }
        });
        previewElements.forEach(previewElement => {
            [previewElement, ...Array.from(previewElement.querySelectorAll<HTMLElement>("[data-node-id]"))]
                .forEach(element => element.setAttribute("data-node-id", `preview-${element.getAttribute("data-node-id")}`));
        });
        sourceElements.forEach((element, index) => {
            const rect = sourceRects[index] || sourceRects[0];
            element.style.left = `${rect.left}px`;
            element.style.top = `${rect.top}px`;
            element.style.width = `${rect.width}px`;
            element.classList.add("protyle-cross-block-source");
        });
        startMarker.after(previewFragment);
    };

    const restore = () => {
        previewElements.forEach(element => element.remove());
        sourceElements.forEach(element => {
            element.classList.remove("protyle-cross-block-source");
            element.style.removeProperty("left");
            element.style.removeProperty("top");
            element.style.removeProperty("width");
        });
        if (startMarker.parentNode !== editorElement || endMarker.parentNode !== editorElement) {
            return;
        }
        let node = startMarker.nextSibling;
        while (node && node !== endMarker) {
            const nextNode = node.nextSibling;
            node.remove();
            node = nextNode;
        }
        if (node !== endMarker) {
            return;
        }
        const restoredElements: HTMLElement[] = [];
        snapshotNodes.forEach(snapshotNode => {
            const restoredNode = snapshotNode.cloneNode(true);
            editorElement.insertBefore(restoredNode, endMarker);
            if (restoredNode.nodeType === Node.ELEMENT_NODE) {
                restoredElements.push(restoredNode as HTMLElement);
            }
        });
        startMarker.remove();
        endMarker.remove();
        if (!restoreFocusContext(protyle, undoFocusContext)) {
            return;
        }
        const selection = getSelection();
        if (selection.rangeCount === 0) {
            return;
        }
        return {
            elements: restoredElements,
            range: selection.getRangeAt(0).cloneRange(),
        };
    };

    return {
        preventNativeInput: false,
        update(text: string) {
            compositionText = text;
        },
        preservePreview,
        async complete(committed: boolean) {
            const restored = restore();
            if (!restored) {
                return;
            }
            if (!committed) {
                restored.elements.forEach(element => {
                    element.querySelectorAll<HTMLElement>(
                        ".render-node[data-render], [data-type=\"NodeAttributeView\"][data-render], " +
                        "[data-type=\"NodeBlockQueryEmbed\"][data-render]"
                    ).forEach(item => item.removeAttribute("data-render"));
                    if (element.matches(".render-node[data-render], [data-type=\"NodeAttributeView\"][data-render], " +
                        "[data-type=\"NodeBlockQueryEmbed\"][data-render]")) {
                        element.removeAttribute("data-render");
                    }
                    processRender(element);
                    avRender(element, protyle);
                    blockRender(protyle, element);
                    if (element.getAttribute("data-type") === "NodeSuperBlock") {
                        refreshSbResize(element);
                    }
                    element.querySelectorAll('[data-type="NodeSuperBlock"]').forEach(refreshSbResize);
                });
                return;
            }
            const restoredRange = restored.range;
            const restoredRanges = getBlockRanges(editorElement, restoredRange);
            const restoredStartElement = restoredRanges[0]?.blockElement ||
                hasClosestBlock(restoredRange.startContainer) as HTMLElement;
            const restoredEndElement = restoredRanges[restoredRanges.length - 1]?.blockElement ||
                hasClosestBlock(restoredRange.endContainer) as HTMLElement;
            if (!restoredStartElement || !restoredEndElement || restoredStartElement === restoredEndElement) {
                return;
            }
            await removeCrossBlockRange(protyle, restoredRange, restoredStartElement, restoredEndElement, false, {
                text: compositionText,
            });
        },
    };
};

export const getRangeBlockRefCheckTargets = (editorElement: HTMLElement, selectedRange: Range,
                                              startElement: HTMLElement, endElement: HTMLElement,
                                              handleEndElement = false) => {
    const plan = handleEndElement ? getCrossBlockRemovalPlan(
        editorElement, selectedRange, startElement, endElement) : undefined;
    const context = plan || getCrossBlockRemovalContext(
        editorElement, selectedRange, startElement, endElement, false);
    return getBlockRefCheckTargetsFromContext(
        context, handleEndElement ? context.removeElements : context.rangeRemoveElements,
        plan?.retainedElements || []);
};

export const getImageBlockRefCheckTargets = (blockElement: HTMLElement, removeElement: Element):
IBlockRefCheckTargets => {
    const editableElement = getContenteditableElement(blockElement);
    if (!editableElement?.contains(removeElement)) {
        return {elements: [], exactIDs: [], deletedIDs: []};
    }
    const cloneElement = editableElement.cloneNode(true) as HTMLElement;
    const removeElements = Array.from(editableElement.querySelectorAll(".img"));
    const imageElement = removeElement.classList.contains("img") ? removeElement : removeElement.closest(".img");
    const removeIndex = removeElements.indexOf(imageElement);
    if (removeIndex < 0) {
        return {elements: [], exactIDs: [], deletedIDs: []};
    }
    cloneElement.querySelectorAll(".img")[removeIndex]?.remove();
    if (hasMeaningfulContent(cloneElement)) {
        return {elements: [], exactIDs: [], deletedIDs: []};
    }
    const elementsByID = new Map<string, HTMLElement>();
    const exactIDs = new Set<string>();
    addExactRefCheckElementChain(elementsByID, exactIDs, blockElement);
    return {
        elements: Array.from(elementsByID.values()),
        exactIDs: Array.from(exactIDs),
        deletedIDs: [],
    };
};

export const removeCrossBlockRange = async (protyle: IProtyle, selectedRange: Range,
                                            startElement: HTMLElement, endElement: HTMLElement,
                                            skipRefCheck = false, replacement?: ICrossBlockReplacement) => {
    const editorElement = protyle.wysiwyg.element;
    const context = getCrossBlockRemovalPlan(
        editorElement, selectedRange, startElement, endElement, true, !!replacement);
    const {
        ranges,
        removeElements,
        rangesByBlock,
        startEditableElement,
        endEditableElement,
        mergeEndElement,
        siblingListItemMergeContext,
        updateElements,
    } = context;
    if (removeElements.length === 0 && updateElements.length === 0) {
        return;
    }
    const affectedListItemElements = new Set<HTMLElement>();
    ranges.forEach(item => {
        let listItemElement = item.blockElement.closest<HTMLElement>('[data-type="NodeListItem"]');
        while (listItemElement && editorElement.contains(listItemElement)) {
            affectedListItemElements.add(listItemElement);
            listItemElement = listItemElement.parentElement?.closest<HTMLElement>('[data-type="NodeListItem"]');
        }
    });
    const oldStartHTML = startElement.outerHTML;

    const {nestedListMergeContext, replacementListItemElement, removeStartListItem,
        startRemoveListItemElement} = context;
    const replacementListItemPosition = replacementListItemElement ? {
        parentID: replacementListItemElement.parentElement.getAttribute("data-node-id"),
        previousID: replacementListItemElement.previousElementSibling?.getAttribute("data-node-id"),
    } : undefined;
    const movedListPreviousID = startRemoveListItemElement && !nestedListMergeContext?.replacementListItemElement ?
        startRemoveListItemElement.previousElementSibling?.getAttribute("data-node-id") :
        replacementListItemElement?.getAttribute("data-node-id") ||
        nestedListMergeContext?.startListItemElement?.getAttribute("data-node-id");
    if (!skipRefCheck) {
        const checkTargets = getBlockRefCheckTargetsFromContext(context, removeElements, context.retainedElements);
        const checkIDs = checkTargets.elements.map(item => item.getAttribute("data-node-id")).filter(Boolean);
        if (checkIDs.length > 0 && !await confirmBlockRef({
            scope: "blocks",
            ids: checkIDs,
            exactIDs: checkTargets.exactIDs,
            deletedIDs: checkTargets.deletedIDs,
            notebook: protyle.notebookId,
        }, protyle)) {
            return;
        }
        if (checkTargets.elements.some(item => !item.isConnected || item.getAttribute("data-node-id") === null)) {
            return;
        }
    }

    let undoRange = selectedRange;
    if (nestedListMergeContext && ranges.length > 0) {
        undoRange = document.createRange();
        undoRange.setStart(ranges[0].range.startContainer, ranges[0].range.startOffset);
        const lastRange = ranges[ranges.length - 1].range;
        undoRange.setEnd(lastRange.endContainer, lastRange.endOffset);
    }
    const undoFocusContext = getUndoFocusContext(editorElement, undoRange, true);
    const operationUpdateElements = replacement ? updateElements.filter(item => item !== startElement) : updateElements;
    const undoOperations: IOperation[] = operationUpdateElements.map(item => ({
        action: "update",
        id: item.getAttribute("data-node-id"),
        data: item.outerHTML
    }));
    if (replacementListItemElement) {
        undoOperations.push({
            action: "move",
            id: replacementListItemElement.getAttribute("data-node-id"),
            previousID: replacementListItemPosition.previousID,
            parentID: replacementListItemPosition.parentID,
        });
    }
    const insertOperations: IOperation[] = removeElements.map(item => {
        let data = item.outerHTML;
        if (item.classList.contains("render-node") || item.querySelector("div.render-node")) {
            data = protyle.lute.SpinBlockDOM(data);
        }
        return {
            action: "insert",
            id: item.getAttribute("data-node-id"),
            data,
            previousID: getPreviousBlockSibling(item)?.getAttribute("data-node-id"),
            parentID: getOperationParentID(item, protyle.block.parentID)
        };
    });
    const orderListElements = Array.from(new Set(removeElements
        .filter(item => item.classList.contains("li") && item.parentElement.getAttribute("data-subtype") === "o")
        .map(item => item.parentElement))).map(item => ({
        element: item,
        start: getOrderedListStart(item),
    }));

    deleteCrossBlockRangeContents(rangesByBlock);
    if (replacementListItemElement) {
        nestedListMergeContext.startListElement.lastElementChild.before(replacementListItemElement);
    }
    const movedListItems = nestedListMergeContext ? mergeCrossBlockNestedLists(nestedListMergeContext) : [];
    const movedEndElements = siblingListItemMergeContext ?
        mergeCrossBlockSiblingListItems(siblingListItemMergeContext) :
        {movedEndBlocks: [], movedEndListItems: []};
    if (mergeEndElement && !nestedListMergeContext) {
        const firstEndNode = endEditableElement.firstChild;
        while (endEditableElement.firstChild) {
            startEditableElement.append(endEditableElement.firstChild);
        }
        if (firstEndNode?.nodeType === 1) {
            const currentElement = firstEndNode as HTMLElement;
            let previousElement = currentElement.previousSibling as HTMLElement;
            while (previousElement?.nodeType === 1 && mergeSameInlineElement(currentElement, previousElement)) {
                previousElement.remove();
                previousElement = currentElement.previousSibling as HTMLElement;
            }
        }
        startEditableElement.normalize();
        fixAdjacentTags(startEditableElement);
        normalizeSemanticInlineElements(startEditableElement);
    }
    removeElements.forEach(item => item.remove());
    updateElements.forEach(item => {
        if (item.isConnected) {
            normalizeSemanticInlineElements(item);
        }
    });

    const firstRange = ranges.find(item => item.editableElement.isConnected);
    let replacementRange: Range;
    if (replacement && firstRange) {
        const currentRange = focusByOffset(firstRange.editableElement, firstRange.start, firstRange.start,
            false, true);
        if (currentRange) {
            replacementRange = currentRange;
            const textNode = document.createTextNode(replacement.text);
            replacementRange.insertNode(textNode);
            replacementRange.setStartAfter(textNode);
            replacementRange.collapse(true);
        }
    }

    const updated = dayjs().format("YYYYMMDDHHmmss");
    const doOperations: IOperation[] = removeElements.map(item => ({
        action: "delete",
        id: item.getAttribute("data-node-id")
    }));
    if (nestedListMergeContext?.newListParentElement) {
        doOperations.push({
            action: "insert",
            id: nestedListMergeContext.startListElement.getAttribute("data-node-id"),
            data: nestedListMergeContext.newListData,
            previousID: nestedListMergeContext.startListElement.previousElementSibling?.getAttribute("data-node-id"),
            parentID: nestedListMergeContext.newListParentElement.getAttribute("data-node-id"),
        });
    }
    if (replacementListItemElement) {
        doOperations.push({
            action: "move",
            id: replacementListItemElement.getAttribute("data-node-id"),
            previousID: nestedListMergeContext.startListItemElement?.getAttribute("data-node-id"),
            parentID: nestedListMergeContext.startListElement.getAttribute("data-node-id"),
        });
    }
    let insertedListItemContent = false;
    affectedListItemElements.forEach(item => {
        if (item.isConnected) {
            insertedListItemContent = ensureListItemContentBlock(item, doOperations, undoOperations) ||
                insertedListItemContent;
        }
    });
    if (!replacement && undoFocusContext && affectedListItemElements.size === 0 && !nestedListMergeContext &&
        !siblingListItemMergeContext && !insertedListItemContent) {
        undoFocusContext.undoFocusCollapseToEnd = "true";
    }
    let previousID = movedListPreviousID;
    movedListItems.forEach(item => {
        doOperations.push({
            action: "insert",
            id: item.getAttribute("data-node-id"),
            data: item.outerHTML,
            previousID,
            parentID: nestedListMergeContext.startListElement.getAttribute("data-node-id")
        });
        previousID = item.getAttribute("data-node-id");
    });
    movedEndElements.movedEndBlocks.forEach(item => {
        doOperations.push({
            action: "insert",
            id: item.getAttribute("data-node-id"),
            data: item.outerHTML,
            previousID: getPreviousBlockSibling(item)?.getAttribute("data-node-id"),
            parentID: siblingListItemMergeContext.startListItemElement.getAttribute("data-node-id")
        });
    });
    movedEndElements.movedEndListItems.forEach(item => {
        doOperations.push({
            action: "insert",
            id: item.getAttribute("data-node-id"),
            data: item.outerHTML,
            previousID: getPreviousBlockSibling(item)?.getAttribute("data-node-id"),
            parentID: siblingListItemMergeContext.startListElement.getAttribute("data-node-id")
        });
    });
    orderListElements.forEach(item => {
        const oldListItems = new Map(Array.from(item.element.querySelectorAll<HTMLElement>(":scope > .li")).map(listItem => {
            return [listItem.getAttribute("data-node-id"), listItem.outerHTML];
        }));
        updateListOrder(item.element, item.start);
        item.element.querySelectorAll<HTMLElement>(":scope > .li").forEach(listItem => {
            const id = listItem.getAttribute("data-node-id");
            const oldHTML = oldListItems.get(id);
            if (!oldHTML || oldHTML === listItem.outerHTML) {
                return;
            }
            listItem.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            undoOperations.push({
                action: "update",
                id,
                data: oldHTML
            });
            doOperations.push({
                action: "update",
                id,
                data: listItem.outerHTML
            });
        });
    });
    operationUpdateElements.forEach(item => {
        item.classList.remove("protyle-wysiwyg--select");
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
        item.setAttribute("updated", updated);
        item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        doOperations.push({
            action: "update",
            id: item.getAttribute("data-node-id"),
            data: item.outerHTML
        });
    });
    const movedUndoOperations: IOperation[] = movedListItems.concat(
        movedEndElements.movedEndBlocks, movedEndElements.movedEndListItems).map(item => ({
        action: "delete",
        id: item.getAttribute("data-node-id")
    }));
    if (nestedListMergeContext?.newListParentElement) {
        movedUndoOperations.push({
            action: "delete",
            id: nestedListMergeContext.startListElement.getAttribute("data-node-id"),
        });
    }
    const crossBlockUndoOperations = undoOperations.concat(movedUndoOperations, insertOperations);
    if (!replacement && crossBlockUndoOperations[0]) {
        crossBlockUndoOperations[0].context = undoFocusContext;
    }
    if (replacement && replacementRange) {
        const startID = startElement.getAttribute("data-node-id");
        protyle.wysiwyg.lastHTMLs[startID] = oldStartHTML;
        await input(protyle, startElement, replacementRange, true, replacement.event, {
            doOperations,
            undoOperations: crossBlockUndoOperations,
            undoContext: undoFocusContext,
        });
        const currentStartElement = editorElement.querySelector<HTMLElement>(`[data-node-id="${startID}"]`);
        focusByOffset(currentStartElement, firstRange.start + replacement.text.length,
            firstRange.start + replacement.text.length, true, true);
        return;
    }
    transaction(protyle, doOperations, crossBlockUndoOperations);

    const movedEditableElement = removeStartListItem && movedListItems[0] ?
        getContenteditableElement(movedListItems[0]) : undefined;
    if (movedEditableElement) {
        focusByOffset(movedEditableElement, 0, 0);
    } else if (firstRange) {
        focusByOffset(firstRange.editableElement, firstRange.start, firstRange.start);
    }
    updateElements.forEach(item => {
        if (item.getAttribute("data-type") === "NodeCodeBlock") {
            item.querySelector(".hljs")?.removeAttribute("data-render");
            highlightRender(item);
        }
    });
};

export const removeBlock = async (protyle: IProtyle, blockElement: Element, range: Range,
                                  type: "Delete" | "Backspace" | "remove", skipRefCheck = false,
                                  restoreSelectionModeAfterZoom = false) => {
    const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
    if (selectElements?.length > 0) {
        const selectedTopElement = selectElements.length === 1 ? getTopAloneElement(selectElements[0]) : undefined;
        const focusedOrderedListItem = selectedTopElement?.parentElement === protyle.wysiwyg.element &&
            selectedTopElement.getAttribute("data-type") === "NodeListItem" &&
            selectedTopElement.getAttribute("data-subtype") === "o" ? selectedTopElement as HTMLElement : undefined;
        const embedSelectElements = selectElements.filter(item => isInEmbedBlock(item));
        if (embedSelectElements.length > 0) {
            // 嵌入块内暂不支持跨边界或多块删除，避免上溯时删除查询目标。
            if (embedSelectElements.length !== selectElements.length || embedSelectElements.length !== 1) {
                return false;
            }
            const embedContext = getEmbedChildOperationContext(embedSelectElements[0]);
            const topElement = getTopAloneElement(embedSelectElements[0]);
            if (!embedContext || !canDeleteEmbedElement(topElement, type, embedContext)) {
                return false;
            }
        }
        const foldTransactions = new Map<string, IWebSocketData>();
        if (!skipRefCheck) {
            const checkIDs: string[] = [];
            const exactIDs: string[] = [];
            const selectedSuperBlocks = new Map<Element, number>();
            for (const item of selectElements) {
                const topElement = getTopAloneElement(item);
                const id = topElement.getAttribute("data-node-id");
                if (id) {
                    checkIDs.push(id);
                }
                if (topElement.getAttribute("data-type") === "NodeHeading" && topElement.getAttribute("fold") === "1") {
                    const foldTransaction = await fetchSyncPost("/api/block/getHeadingDeleteTransaction", {id});
                    if (foldTransaction.code !== 0) {
                        return false;
                    }
                    foldTransactions.set(id, foldTransaction);
                    foldTransaction.data.doOperations.forEach((operation: IOperation) => {
                        if (operation.action === "delete") {
                            checkIDs.push(operation.id);
                        }
                    });
                }
                const parent = topElement.parentElement;
                if (parent?.getAttribute("data-type") === "NodeSuperBlock") {
                    selectedSuperBlocks.set(parent, (selectedSuperBlocks.get(parent) || 0) + 1);
                }
            }
            selectedSuperBlocks.forEach((selectedCount, superBlock) => {
                if (getSbChildBlockCount(superBlock) - selectedCount <= 1) {
                    const superBlockID = superBlock.getAttribute("data-node-id");
                    checkIDs.push(superBlockID);
                    exactIDs.push(superBlockID);
                }
            });
            const uniqueCheckIDs = Array.from(new Set(checkIDs));
            if (!await confirmBlockRef({
                scope: "blocks",
                ids: uniqueCheckIDs,
                exactIDs: Array.from(new Set(exactIDs)),
                deletedIDs: uniqueCheckIDs,
                notebook: protyle.notebookId,
            }, protyle)) {
                return false;
            }
            if (selectElements.some(item => !item.isConnected || !item.classList.contains("protyle-wysiwyg--select"))) {
                return false;
            }
        }
        let focusedOrderOperations: ReturnType<typeof getFocusedOrderedListDeleteOperations>;
        if (focusedOrderedListItem) {
            const focusedParentListElement = await getFocusedParentOrderedList(protyle, protyle.wysiwyg.element);
            if (!focusedParentListElement) {
                return false;
            }
            focusedOrderOperations = getFocusedOrderedListDeleteOperations(focusedParentListElement,
                focusedOrderedListItem);
            if (!focusedOrderOperations) {
                return false;
            }
        }
        protyle.observerLoad?.disconnect();
        // 删除后，防止滚动条滚动后调用 get 请求，因为返回的请求已查找不到内容块了
        preventScroll(protyle);
        const deletes: IOperation[] = [];
        const inserts: IOperation[] = [];
        const candidateElements = Array.from(new Set(selectElements.map(item => getTopAloneElement(item))));
        const selectionCandidate = getDeleteSelectionCandidate(candidateElements, type,
            getPreviousBlock, getNextBlock);
        let sideElement = selectionCandidate?.element;
        let sideIsNext = selectionCandidate?.side === "after";
        if (!sideElement && !protyle.options.backlinkData) {
            sideElement = protyle.wysiwyg.element;
            sideIsNext = false;
        }
        const orderedLists = new Map<Element, number | undefined>();
        const superBlockParents = new Map<Element, Set<string>>();
        hideElements(["select"], protyle);
        const unfoldData: {
            [key: string]: {
                element: Element,
                previousID?: string
            }
        } = {};
        for (let i = 0; i < selectElements.length; i++) {
            const topElement = getTopAloneElement(selectElements[i]);
            const topParentElement = topElement.parentElement;
            if (topParentElement?.getAttribute("data-type") === "NodeSuperBlock") {
                if (!superBlockParents.has(topParentElement)) {
                    superBlockParents.set(topParentElement, new Set());
                }
                superBlockParents.get(topParentElement).add(topElement.getAttribute("data-node-id"));
            }
            const id = topElement.getAttribute("data-node-id");
            deletes.push({
                action: "delete",
                id,
            });
            if (topElement.getAttribute("data-type") === "NodeHeading" && topElement.getAttribute("fold") === "1") {
                const foldTransaction = foldTransactions.get(id) || await fetchSyncPost("/api/block/getHeadingDeleteTransaction", {id});
                deletes.push(...foldTransaction.data.doOperations.slice(1));
                foldTransaction.data.undoOperations.forEach((operationItem: IOperation, index: number) => {
                    if (index > 0) {
                        operationItem.context = {
                            ignoreProcess: "true"
                        };
                    }
                });
                foldTransaction.data.undoOperations.reverse();
                const foldPreviousBlockElement = getPreviousBlockSibling(topElement);
                if (foldPreviousBlockElement &&
                    foldPreviousBlockElement.getAttribute("data-type") === "NodeHeading" &&
                    foldPreviousBlockElement.getAttribute("fold") === "1") {
                    const foldId = foldPreviousBlockElement.getAttribute("data-node-id");
                    if (!unfoldData[foldId]) {
                        const foldTransaction = await fetchSyncPost("/api/block/getHeadingDeleteTransaction", {
                            id: foldId,
                        });
                        unfoldData[foldId] = {
                            element: foldPreviousBlockElement,
                            previousID: foldTransaction.data.doOperations[foldTransaction.data.doOperations.length - 1].id
                        };
                    }
                }
                inserts.push(...foldTransaction.data.undoOperations);
                // https://github.com/siyuan-note/siyuan/issues/4422
                topElement.firstElementChild.removeAttribute("contenteditable");
                topElement.remove();
            } else {
                let data = topElement.outerHTML; // 列表项不可 Spin，否则会转换为列表块。
                if (topElement.classList.contains("render-node") || topElement.querySelector("div.render-node")) {
                    data = protyle.lute.SpinBlockDOM(data);
                }
                const previousBlockElement = getPreviousBlockSibling(topElement);
                let previousID = previousBlockElement ? previousBlockElement.getAttribute("data-node-id") : "";
                if (focusedOrderOperations && id === focusedOrderedListItem.getAttribute("data-node-id")) {
                    previousID = focusedOrderOperations.previousID || "";
                }
                if (previousBlockElement &&
                    previousBlockElement.getAttribute("data-type") === "NodeHeading" &&
                    previousBlockElement.getAttribute("fold") === "1") {
                    const foldId = previousBlockElement.getAttribute("data-node-id");
                    if (!unfoldData[foldId]) {
                        const foldTransaction = await fetchSyncPost("/api/block/getHeadingDeleteTransaction", {
                            id: foldId,
                        });
                        unfoldData[foldId] = {
                            element: previousBlockElement,
                            previousID: foldTransaction.data.doOperations[foldTransaction.data.doOperations.length - 1].id
                        };
                    }
                    previousID = unfoldData[foldId].previousID;
                }
                inserts.push({
                    action: "insert",
                    data,
                    id,
                    previousID,
                    parentID: getOperationParentID(topElement, protyle.block.parentID)
                });
                if (topElement.getAttribute("data-subtype") === "o" && topElement.classList.contains("li")) {
                    if (!orderedLists.has(topElement.parentElement)) {
                        orderedLists.set(topElement.parentElement, getOrderedListStart(topElement.parentElement));
                    }
                }
                // https://github.com/siyuan-note/siyuan/issues/12327
                if (topElement.parentElement.classList.contains("li") && topElement.parentElement.childElementCount === 4 &&
                    topElement.parentElement.getAttribute("fold") === "1") {
                    unfoldData[topElement.parentElement.getAttribute("data-node-id")] = {
                        element: topElement.parentElement,
                    };
                }
                topElement.remove();
                ensureListItemContentBlock(topParentElement, deletes, inserts);
            }
        }
        Object.keys(unfoldData).forEach(item => {
            const foldOperations = setFold(protyle, unfoldData[item].element, true, false, false, true);
            deletes.push(...foldOperations.doOperations);
            inserts.splice(0, 0, ...foldOperations.undoOperations);
        });
        if (sideElement) {
            if (protyle.block.showAll && sideElement.classList.contains("protyle-wysiwyg") && protyle.wysiwyg.element.childElementCount === 0) {
                const focusID = protyle.block.parent2ID;
                setTimeout(() => {
                    if (document.contains(protyle.element)) {
                        zoomOut({
                            protyle,
                            id: focusID,
                            focusId: focusID,
                            callback: restoreSelectionModeAfterZoom ? () => {
                                const targetElement = protyle.wysiwyg.element.querySelector<HTMLElement>(
                                    `[data-node-id="${focusID}"]`) ||
                                    protyle.wysiwyg.element.querySelector<HTMLElement>("[data-node-id]");
                                if (targetElement) {
                                    setBlockSelectionModeElement(protyle.wysiwyg.element, targetElement);
                                    focusBlock(targetElement);
                                    countBlockWord(getBlockSelectionStatusIDs(protyle.wysiwyg.element),
                                        protyle.block.rootID);
                                }
                            } : undefined,
                        });
                    }
                }, Constants.TIMEOUT_INPUT * 2 + 100);
            } else {
                if (sideElement.classList.contains("protyle-wysiwyg") && protyle.wysiwyg.element.childElementCount === 0) {
                    const newID = Lute.NewNodeID();
                    const emptyElement = genEmptyElement(false, true, newID);
                    sideElement.insertAdjacentElement("afterbegin", emptyElement);
                    deletes.push({
                        action: "insert",
                        data: emptyElement.outerHTML,
                        id: newID,
                        parentID: sideElement.getAttribute("data-node-id") || protyle.block.parentID
                    });
                    inserts.push({
                        action: "delete",
                        id: newID,
                    });
                    sideElement = undefined;
                    focusByWbr(emptyElement, range);
                }
                // https://github.com/siyuan-note/siyuan/issues/5485
                // https://github.com/siyuan-note/siyuan/issues/10389
                // https://github.com/siyuan-note/siyuan/issues/10899
                if (sideElement) {
                    if (type !== "Backspace" && sideIsNext) {
                        focusBlock(sideElement);
                    } else {
                        focusBlock(sideElement, undefined, false);
                    }
                    scrollCenter(protyle, sideElement);
                }
            }
        }
        orderedLists.forEach((listStart, listElement) => {
            if (!listElement.isConnected) {
                return;
            }
            inserts.push({
                action: "update",
                id: listElement.getAttribute("data-node-id"),
                data: listElement.outerHTML
            });
            listElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            updateListOrder(listElement, listStart);
            deletes.push({
                action: "update",
                id: listElement.getAttribute("data-node-id"),
                data: listElement.outerHTML
            });
        });
        if (focusedOrderOperations) {
            deletes.push(...focusedOrderOperations.doOperations);
            inserts.splice(0, 0, ...focusedOrderOperations.undoOperations);
        }
        if (deletes.length > 0) {
            const getElementDepth = (element: Element) => {
                let depth = 0;
                let parentElement = element.parentElement;
                while (parentElement) {
                    depth++;
                    parentElement = parentElement.parentElement;
                }
                return depth;
            };
            const parentUndoOperationGroups: IOperation[][] = [];
            const childReplacements = new Map<string, {
                childIDs: string[],
                foldedHeadingIDs: string[]
            }>();
            const sortedSuperBlocks = Array.from(superBlockParents.entries())
                .sort(([first], [second]) => getElementDepth(second) - getElementDepth(first));
            for (const [superBlock, excludedChildIDs] of sortedSuperBlocks) {
                if (!superBlock.isConnected) {
                    continue;
                }
                if (getSbChildBlockCount(superBlock) === 1) {
                    const sbData = await cancelSB(protyle, superBlock, undefined, excludedChildIDs,
                        childReplacements);
                    deletes.push(...sbData.doOperations);
                    parentUndoOperationGroups.push(sbData.undoOperations);
                    if (sbData.doOperations.length > 0) {
                        childReplacements.set(superBlock.getAttribute("data-node-id"), {
                            childIDs: sbData.childIDs || [],
                            foldedHeadingIDs: sbData.foldedHeadingIDs || [],
                        });
                    }
                } else {
                    // 超级块删除子块后剩余多个子块时，刷新拖拽手柄（被删块两侧手柄需移除/重建）
                    refreshSbResize(superBlock);
                    const widthChanges = rebalanceSbWidth(superBlock);
                    const widthUndoOperations: IOperation[] = [];
                    widthChanges.forEach(change => {
                        const targetEl = superBlock.querySelector(`[data-node-id="${change.id}"]`);
                        if (targetEl) {
                            deletes.push({
                                action: "setAttrs",
                                id: change.id,
                                data: JSON.stringify({style: targetEl.getAttribute("style") || ""})
                            });
                            widthUndoOperations.push({
                                action: "setAttrs",
                                id: change.id,
                                data: JSON.stringify({style: change.oldStyle})
                            });
                        }
                    });
                    if (widthUndoOperations.length > 0) {
                        parentUndoOperationGroups.push(widthUndoOperations);
                    }
                }
            }
            if (sideElement?.isConnected && protyle.wysiwyg.element.contains(sideElement)) {
                if (type !== "Backspace" && sideIsNext) {
                    focusBlock(sideElement);
                } else {
                    focusBlock(sideElement, undefined, false);
                }
                scrollCenter(protyle, sideElement);
            }
            const parentUndoOperations = parentUndoOperationGroups.reverse().flat();
            transaction(protyle, deletes, parentUndoOperations.concat(inserts.reverse()));
        }

        hideElements(["util"], protyle);
        /// #if !MOBILE
        if (!sideElement) {
            const backlinkElement = hasClosestByClassName(protyle.element, "sy__backlink", true);
            if (backlinkElement) {
                getAllModels().backlink.find(item => {
                    if (!item.element.contains(protyle.element)) {
                        return false;
                    }
                    const editors = item.editors;
                    editors.find((item, index) => {
                        if (item.protyle.element === protyle.element) {
                            item.destroy();
                            editors.splice(index, 1);
                            item.protyle.element.previousElementSibling.remove();
                            item.protyle.element.remove();
                            return true;
                        }
                    });
                    return true;
                });
            }
        }
        /// #endif
        // https://github.com/siyuan-note/siyuan/issues/16767
        setTimeout(() => {
            if (!document.contains(protyle.element)) {
                return;
            }
            if (protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "2" &&
                !protyle.scroll.element.classList.contains("fn__none") &&
                protyle.contentElement.scrollHeight - protyle.contentElement.scrollTop < protyle.contentElement.clientHeight * 2
            ) {
                protyle.scroll.loadDynamic(protyle, 2);
            }
        }, Constants.TIMEOUT_COUNT);// 需等待滚动阻塞、后台处理完成。否则会加载已删除的内容
        return true;
    }
    protyle.observerLoad?.disconnect();
    // 删除后，防止滚动条滚动后调用 get 请求，因为返回的请求已查找不到内容块了
    preventScroll(protyle);
    const embedBlockElement = isInEmbedBlock(blockElement);
    const embedContext = getEmbedChildOperationContext(blockElement);
    if (embedBlockElement && (!embedContext || embedContext.targetElement === blockElement)) {
        return;
    }
    const blockType = blockElement.getAttribute("data-type");
    // 空代码块直接删除
    if (blockType === "NodeCodeBlock" && getContenteditableElement(blockElement)?.textContent.trim() === "") {
        blockElement.classList.add("protyle-wysiwyg--select");
        removeBlock(protyle, blockElement, range, type);
        return;
    }

    let isCallout = blockElement.parentElement.classList.contains("callout-content");
    if (type === "Delete") {
        const bqCaElement = hasClosestByClassName(blockElement, "bq") || hasClosestByClassName(blockElement, "callout");
        if (bqCaElement && getContenteditableElement(bqCaElement) === getContenteditableElement(blockElement)) {
            isCallout = bqCaElement.classList.contains("callout");
            blockElement = isCallout ? bqCaElement.querySelector(".callout-content").firstElementChild : bqCaElement.firstElementChild;
        }
    }
    const blockParentElement = isCallout ? blockElement.parentElement.parentElement : blockElement.parentElement;
    if (!blockElement.previousElementSibling && (blockElement.parentElement.getAttribute("data-type") === "NodeBlockquote" || isCallout) && (
        (type !== "Delete" && blockType !== "NodeHeading") ||
        (type === "Delete" && (
            blockParentElement.parentElement.classList.contains("protyle-wysiwyg") ||
            blockParentElement.parentElement.classList.contains("li") ||
            blockParentElement.parentElement.classList.contains("callout-content") ||
            blockParentElement.parentElement.classList.contains("sb")
        ))
    )) {
        if (embedContext && !embedContext.boundaryElement.contains(blockParentElement.parentElement)) {
            return;
        }
        const removeBlockParent = isCallout ? blockParentElement.querySelector(".callout-content").childElementCount === 1 :
            blockParentElement.childElementCount === 2;
        if (removeBlockParent && !await confirmRefRemoval(protyle,
            [blockParentElement.getAttribute("data-node-id")], [blockParentElement],
            [blockParentElement.getAttribute("data-node-id")])) {
            return;
        }
        if (type !== "Delete") {
            range.insertNode(document.createElement("wbr"));
        }
        blockParentElement.insertAdjacentElement("beforebegin", blockElement);
        // 跳过 sb__resize 手柄取前一个块，避免超级块内引述块首删除时 previousID 为手柄导致位置错
        const previousID = getPreviousBlockSibling(blockElement)?.getAttribute("data-node-id");
        if (removeBlockParent) {
            transaction(protyle, [{
                action: "move",
                id: blockElement.getAttribute("data-node-id"),
                previousID,
                parentID: getOperationParentID(blockParentElement, protyle.block.parentID)
            }, {
                action: "delete",
                id: blockParentElement.getAttribute("data-node-id")
            }], [{
                action: "insert",
                id: blockParentElement.getAttribute("data-node-id"),
                data: blockParentElement.outerHTML,
                previousID,
                parentID: getOperationParentID(blockElement, protyle.block.parentID)
            }, {
                action: "move",
                id: blockElement.getAttribute("data-node-id"),
                parentID: blockParentElement.getAttribute("data-node-id")
            }]);
            blockParentElement.remove();
        } else {
            transaction(protyle, [{
                action: "move",
                id: blockElement.getAttribute("data-node-id"),
                previousID,
                parentID: getOperationParentID(blockParentElement, protyle.block.parentID)
            }], [{
                action: "move",
                id: blockElement.getAttribute("data-node-id"),
                parentID: blockParentElement.getAttribute("data-node-id")
            }]);
        }
        // 引述块移出/删除后，若所在容器是超级块则刷新拖拽手柄（清残留）
        const sbAncestor = getParentBlock(blockElement);
        if (sbAncestor?.classList.contains("sb")) {
            refreshSbResize(sbAncestor);
        }
        if (type === "Delete") {
            moveToPrevious(blockElement, range, true);
        } else {
            focusByWbr(blockElement, range);
        }
        return;
    }

    if (blockElement.parentElement.classList.contains("li") && blockType !== "NodeHeading" &&
        blockElement.previousElementSibling.classList.contains("protyle-action")) {
        if (embedContext && !canRemoveLiInEmbed(blockElement, embedContext)) {
            return;
        }
        removeLi(protyle, blockElement, range, type === "Delete");
        return;
    }
    if (type === "Delete") {
        const liElement = hasClosestByClassName(blockElement, "li");
        if (liElement && getContenteditableElement(liElement) === getContenteditableElement(blockElement)) {
            if (embedContext && !canRemoveLiInEmbed(liElement.firstElementChild.nextElementSibling, embedContext)) {
                return;
            }
            removeLi(protyle, liElement.firstElementChild.nextElementSibling, range, true);
            return;
        }
    }
    const previousElement = getPreviousBlock(blockElement) as HTMLElement;
    if (embedContext && (!previousElement || !embedContext.boundaryElement.contains(previousElement))) {
        return;
    }
    // 设置 bq 和代码块光标
    // 需放在列表处理后 https://github.com/siyuan-note/siyuan/issues/11606
    if (["NodeCodeBlock", "NodeTable", "NodeAttributeView"].includes(blockType)) {
        if (previousElement) {
            if (previousElement.classList.contains("p") && getContenteditableElement(previousElement).textContent === "") {
                // 空块向后删除时移除改块 https://github.com/siyuan-note/siyuan/issues/11732
                const ppElement = getPreviousBlock(previousElement);
                if (!await confirmRefRemoval(protyle,
                    [previousElement.getAttribute("data-node-id")], [previousElement])) {
                    return;
                }
                transaction(protyle, [{
                    action: "delete",
                    id: previousElement.getAttribute("data-node-id"),
                }], [{
                    action: "insert",
                    data: previousElement.outerHTML,
                    id: previousElement.getAttribute("data-node-id"),
                    parentID: getOperationParentID(previousElement, protyle.block.parentID),
                    previousID: (ppElement && (!previousElement.previousElementSibling || !previousElement.previousElementSibling.classList.contains("protyle-action"))) ? ppElement.getAttribute("data-node-id") : undefined
                }]);
                previousElement.remove();
            } else {
                focusBlock(previousElement, undefined, false);
            }
        }
        return;
    }
    if (blockType === "NodeHeading") {
        const previousBlockElement = getPreviousBlockSibling(blockElement);
        if (previousBlockElement?.getAttribute("data-type") === "NodeHeading" &&
            previousBlockElement.getAttribute("fold") === "1") {
            setFold(protyle, previousBlockElement, true, false, false, false, false);
        }
        if (blockType === "NodeHeading" &&
            blockElement.getAttribute("fold") === "1") {
            setFold(protyle, blockElement, true, false, false, false, false);
        }
        turnsIntoTransaction({
            protyle: protyle,
            selectsElement: [blockElement],
            type: "Blocks2Ps",
            range: moveToPrevious(blockElement, range, type === "Delete")
        });
        return;
    }
    if (blockElement.previousElementSibling && blockElement.previousElementSibling.classList.contains("protyle-breadcrumb__bar")) {
        return;
    }

    if (!previousElement) {
        if (protyle.wysiwyg.element.childElementCount > 1 &&
            getContenteditableElement(blockElement)?.textContent === "") {
            focusBlock(protyle.wysiwyg.element.firstElementChild.nextElementSibling);
            // 列表项中包含超级块时需要到顶层
            const topElement = getTopAloneElement(blockElement);
            if (!await confirmRefRemoval(protyle, [topElement.getAttribute("data-node-id")], [topElement])) {
                return;
            }
            transaction(protyle, [{
                action: "delete",
                id: topElement.getAttribute("data-node-id"),
            }], [{
                action: "insert",
                data: topElement.outerHTML,
                id: topElement.getAttribute("data-node-id"),
                parentID: protyle.block.parentID
            }]);
            topElement.remove();
        }
        return;
    }

    const parentElement = hasClosestBlock(getParentBlock(blockElement));
    const editableElement = getContenteditableElement(blockElement);
    let previousLastElement = getLastBlock(previousElement) as HTMLElement;
    if (range.toString() === "" && isMobile() && previousLastElement &&
        previousLastElement.classList.contains("hr") && editableElement && getSelectionOffset(editableElement).start === 0) {
        if (!await confirmRefRemoval(protyle,
            [previousLastElement.getAttribute("data-node-id")], [previousLastElement])) {
            return;
        }
        transaction(protyle, [{
            action: "delete",
            id: previousLastElement.getAttribute("data-node-id"),
        }], [{
            action: "insert",
            data: previousLastElement.outerHTML,
            id: previousLastElement.getAttribute("data-node-id"),
            previousID: getPreviousBlockSibling(previousLastElement)?.getAttribute("data-node-id"),
            parentID: getOperationParentID(previousLastElement, protyle.block.parentID)
        }]);
        previousLastElement.remove();
        return;
    }
    if (!editableElement) {
        if (!focusByWbr(protyle.wysiwyg.element, range)) {
            focusBlock(previousLastElement, undefined, false);
        }
        return;
    }
    const isSelectNode = previousLastElement && (
        previousLastElement.classList.contains("table") ||
        previousLastElement.classList.contains("render-node") ||
        previousLastElement.classList.contains("iframe") ||
        previousLastElement.classList.contains("hr") ||
        previousLastElement.classList.contains("av") ||
        previousLastElement.classList.contains("code-block") ||
        isNotEditBlock(previousLastElement));
    const previousId = previousLastElement.getAttribute("data-node-id");
    if (isSelectNode) {
        if (previousLastElement.classList.contains("code-block")) {
            if (editableElement.textContent.trim() === "") {
                const id = blockElement.getAttribute("data-node-id");
                const checkIDs = [id];
                const exactIDs: string[] = [];
                if (parentElement && parentElement.getAttribute("data-type") === "NodeSuperBlock" && getSbChildBlockCount(parentElement) === 2) {
                    const parentID = parentElement.getAttribute("data-node-id");
                    checkIDs.push(parentID);
                    exactIDs.push(parentID);
                }
                if (!await confirmRefRemoval(protyle, checkIDs, [blockElement], exactIDs)) {
                    return;
                }
                const doOperations: IOperation[] = [{
                    action: "delete",
                    id,
                }];
                const undoOperations: IOperation[] = [{
                    action: "insert",
                    data: blockElement.outerHTML,
                    id: id,
                    previousID: getPreviousBlockSibling(blockElement)?.getAttribute("data-node-id"),
                    parentID: getOperationParentID(blockElement, protyle.block.parentID)
                }];
                blockElement.remove();
                // 取消超级块
                if (parentElement && parentElement.getAttribute("data-type") === "NodeSuperBlock" && getSbChildBlockCount(parentElement) === 1) {
                    const sbData = await cancelSB(protyle, parentElement);
                    transaction(protyle, doOperations.concat(sbData.doOperations), sbData.undoOperations.concat(undoOperations));
                } else {
                    transaction(protyle, doOperations, undoOperations);
                }
                focusBlock(protyle.wysiwyg.element.querySelector(`[data-node-id="${previousId}"]`), undefined, false);
            } else {
                focusBlock(previousLastElement, undefined, false);
            }
            return;
        }
        if (editableElement.textContent !== "" ||
            // https://github.com/siyuan-note/siyuan/issues/10207
            blockElement.classList.contains("av")) {
            focusBlock(previousLastElement, undefined, false);
            return;
        }
    }

    const removeElement = getTopEmptyElement(blockElement, embedContext?.boundaryElement);
    if (embedContext && (embedContext.targetElement === removeElement ||
        (parentElement === embedContext.targetElement && parentElement.getAttribute("data-type") === "NodeSuperBlock" &&
            getSbChildBlockCount(parentElement) <= 2))) {
        return;
    }
    const removeId = removeElement.getAttribute("data-node-id");
    const checkIDs = [removeId];
    const exactIDs: string[] = [];
    if (parentElement && parentElement.getAttribute("data-type") === "NodeSuperBlock" && getSbChildBlockCount(parentElement) === 2) {
        const parentID = parentElement.getAttribute("data-node-id");
        checkIDs.push(parentID);
        exactIDs.push(parentID);
    }
    if (!await confirmRefRemoval(protyle, checkIDs, [removeElement], exactIDs)) {
        return;
    }
    range.insertNode(document.createElement("wbr"));
    const undoOperations: IOperation[] = [{
        action: "update",
        data: previousLastElement.outerHTML,
        id: previousId,
    }, {
        action: "insert",
        data: removeElement.outerHTML,
        id: removeId,
        previousID: getPreviousBlockSibling(blockElement)?.getAttribute("data-node-id"),
        parentID: getOperationParentID(removeElement, protyle.block.parentID)
    }];
    const doOperations: IOperation[] = [{
        action: "delete",
        id: removeId,
    }];

    if (isSelectNode) {
        // 需先移除 removeElement，否则 side 会选中 removeElement
        removeElement.remove();
        focusBlock(previousLastElement, undefined, false);
        // https://github.com/siyuan-note/siyuan/issues/13254
        undoOperations.splice(0, 1);
    } else {
        const previousLastEditElement = getContenteditableElement(previousLastElement);
        if (editableElement && (editableElement.textContent !== "" || editableElement.querySelector(".emoji"))) {
            // 非空块
            range.setEndAfter(editableElement.lastChild);
            // 数学公式回车后再删除 https://github.com/siyuan-note/siyuan/issues/3850
            if ((previousLastEditElement?.lastElementChild?.getAttribute("data-type") || "").indexOf("inline-math") > -1) {
                const lastSibling = hasNextSibling(previousLastEditElement?.lastElementChild);
                if (lastSibling && lastSibling.textContent === "\n") {
                    lastSibling.remove();
                }
            }
        }

        // https://github.com/siyuan-note/siyuan/issues/14807
        if (previousLastEditElement) {
            let previousLastChild = previousLastEditElement.lastChild;
            if (previousLastChild && previousLastChild.nodeType === 3) {
                if (!previousLastChild.textContent) {
                    previousLastChild = hasPreviousSibling(previousLastChild) as ChildNode;
                }
                if (previousLastChild && previousLastChild.nodeType === 3 && previousLastChild.textContent.endsWith("\n")) {
                    previousLastChild.textContent = previousLastChild.textContent.slice(0, -1);
                }
            }
        }

        const scroll = protyle.contentElement.scrollTop;
        const leftNodes = range.extractContents();
        range.selectNodeContents(previousLastEditElement);
        range.collapse(false);
        range.insertNode(leftNodes);
        const previousHTML = previousLastEditElement.innerHTML.trimStart();
        const previousText = previousLastEditElement.textContent.trimStart();
        const enableCodeBlockMiddleDot = window.siyuan.config.editor.markdown.codeBlockMiddleDot !== false;
        const codeBlockMarkerRegExp = enableCodeBlockMiddleDot ? /·|~/g : /~/g;
        const codeBlockFenceStartRegExp = enableCodeBlockMiddleDot ? /^(~|·|`){3,}/g : /^(~|`){3,}/g;
        const codeBlockFenceLineRegExp = enableCodeBlockMiddleDot ? /\n(~|·|`){3,}/g : /\n(~|`){3,}/g;
        // https://github.com/siyuan-note/siyuan/issues/15554
        if (previousHTML.startsWith("```") || previousHTML.startsWith("~~~") ||
            (previousHTML.indexOf("\n```") > -1 && previousText.indexOf("\n```") > -1) ||
            (previousHTML.indexOf("\n~~~") > -1 && previousText.indexOf("\n~~~") > -1) ||
            (enableCodeBlockMiddleDot && (previousHTML.startsWith("···") ||
                (previousHTML.indexOf("\n···") > -1 && previousText.indexOf("\n···") > -1)))) {
            if (previousHTML.indexOf("\n") === -1 &&
                previousHTML.replace(codeBlockMarkerRegExp, "`").replace(/^`{3,}/g, "").indexOf("`") > -1) {
                // ```test` 不处理，正常渲染为段落块
            } else {
                let replaceNewHTML = previousLastEditElement.innerHTML
                    .replace(codeBlockFenceLineRegExp, "\n```").trim()
                    .replace(codeBlockFenceStartRegExp, "```");
                if (!replaceNewHTML.endsWith("\n```")) {
                    replaceNewHTML += "\n```";
                }
                previousLastEditElement.innerHTML = replaceNewHTML;
            }
        }
        // 图片前删除到上一个文字块时，图片前有 zwsp
        previousLastElement.insertAdjacentHTML("afterend",  protyle.lute.SpinBlockDOM(previousLastElement.outerHTML));
        previousLastElement = previousLastElement.nextElementSibling as HTMLElement;
        previousLastElement.previousElementSibling.remove();
        mathRender(getPreviousBlock(removeElement) as HTMLElement);
        const removeParentElement = removeElement.parentElement;
        // https://github.com/siyuan-note/siyuan/issues/12327
        if (removeParentElement.classList.contains("li") && removeParentElement.childElementCount === 4 &&
            removeParentElement.getAttribute("fold") === "1") {
            const foldOperations = setFold(protyle, removeParentElement, true, false, false, true);
            doOperations.push(...foldOperations.doOperations);
            undoOperations.splice(0, 0, ...foldOperations.undoOperations);
        }
        removeElement.remove();
        // extractContents 内容过多时需要进行滚动条重置，否则位置会错位
        protyle.contentElement.scrollTop = scroll;
        protyle.scroll.lastScrollTop = scroll - 1;
        previousLastElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        doOperations.push({
            action: "update",
            data: previousLastElement.outerHTML,
            id: previousId,
        });
    }
    if (parentElement && parentElement.getAttribute("data-type") === "NodeSuperBlock" && getSbChildBlockCount(parentElement) === 1) {
        const sbData = await cancelSB(protyle, parentElement);
        transaction(protyle, doOperations.concat(sbData.doOperations), sbData.undoOperations.concat(undoOperations));
    } else {
        if (parentElement && parentElement.getAttribute("data-type") === "NodeSuperBlock") {
            refreshSbResize(parentElement);
            // 删除子块后重新分配剩余块宽度并持久化
            const widthChanges = rebalanceSbWidth(parentElement);
            widthChanges.forEach(change => {
                const targetEl = parentElement.querySelector(`[data-node-id="${change.id}"]`);
                if (targetEl) {
                    doOperations.push({
                        action: "setAttrs",
                        id: change.id,
                        data: JSON.stringify({style: targetEl.getAttribute("style") || ""})
                    });
                    undoOperations.push({
                        action: "setAttrs",
                        id: change.id,
                        data: JSON.stringify({style: change.oldStyle})
                    });
                }
            });
        }
        transaction(protyle, doOperations, undoOperations);
    }
    focusByWbr(protyle.wysiwyg.element, range);
};

export const removeBlockPreservingSelectionMode = async (protyle: IProtyle, blockElement: Element, range: Range,
                                                       type: "Delete" | "Backspace" | "remove",
                                                       skipRefCheck = false) => {
    const editorElement = protyle.wysiwyg.element;
    const selectionModeElement = getBlockSelectionModeElement(editorElement);
    if (!selectionModeElement) {
        return removeBlock(protyle, blockElement, range, type, skipRefCheck);
    }
    const temporarySelection = !editorElement.querySelector(`.${BLOCK_SELECTION_CLASS}`);
    if (temporarySelection) {
        selectionModeElement.classList.add(BLOCK_SELECTION_CLASS);
    }
    selectionModeElement.classList.remove(BLOCK_SELECTION_MODE_CLASS);
    const removed = await removeBlock(protyle, blockElement, range, type, skipRefCheck, true);
    if (!removed && temporarySelection && selectionModeElement.isConnected) {
        selectionModeElement.classList.remove(BLOCK_SELECTION_CLASS);
        selectionModeElement.removeAttribute("select-start");
        selectionModeElement.removeAttribute("select-end");
    }
    const currentRange = getEditorRange(editorElement);
    let nextSelectionModeElement = selectionModeElement.isConnected ? selectionModeElement :
        hasClosestBlock(currentRange.startContainer) as HTMLElement;
    if (!nextSelectionModeElement || !editorElement.contains(nextSelectionModeElement)) {
        nextSelectionModeElement = editorElement.querySelector<HTMLElement>("[data-node-id]");
    }
    if (nextSelectionModeElement) {
        setBlockSelectionModeElement(editorElement, nextSelectionModeElement);
        focusBlock(nextSelectionModeElement);
    }
    countBlockWord(getBlockSelectionStatusIDs(editorElement), protyle.block.rootID);
    return removed;
};

const canDeleteEmbedElement = (element: Element, type: "Delete" | "Backspace" | "remove",
                               embedContext: IEmbedChildOperationContext) => {
    if (embedContext.targetElement === element || !embedContext.boundaryElement.contains(element)) {
        return false;
    }

    const parentElement = getParentBlock(element);
    if (parentElement === embedContext.targetElement && parentElement.getAttribute("data-type") === "NodeSuperBlock" &&
        getSbChildBlockCount(parentElement) <= 2) {
        return false;
    }

    let sideElement: Element | false;
    if (type === "Backspace") {
        sideElement = getPreviousBlock(element) || getNextBlock(element);
    } else {
        sideElement = getNextBlock(element) || getPreviousBlock(element);
    }
    return !!sideElement && embedContext.boundaryElement.contains(sideElement);
};

const getOperationParentID = (element: Element, fallbackID: string) => {
    return getEmbedChildOperationParentID(element) || getParentBlock(element)?.getAttribute("data-node-id") || fallbackID;
};

const canRemoveLiInEmbed = (blockElement: Element, embedContext: IEmbedChildOperationContext) => {
    const listItemElement = blockElement.parentElement;
    const listElement = listItemElement.parentElement;
    const previousListItemElement = listItemElement.previousElementSibling;
    if (previousListItemElement?.getAttribute("data-node-id")) {
        return embedContext.boundaryElement.contains(previousListItemElement);
    }
    if (listElement.parentElement === embedContext.resultElement) {
        return false;
    }
    return embedContext.boundaryElement.contains(listElement.parentElement);
};

export const moveToPrevious = (blockElement: Element, range: Range, isDelete: boolean) => {
    if (isDelete) {
        const previousBlockElement = getPreviousBlock(blockElement);
        if (previousBlockElement) {
            if (previousBlockElement.querySelector("wbr")) {
                return focusByWbr(previousBlockElement, range);
            } else {
                const previousEditElement = getContenteditableElement(getLastBlock(previousBlockElement));
                if (previousEditElement) {
                    return setLastNodeRange(previousEditElement, range, false);
                }
            }
        }
    }
};

// https://github.com/siyuan-note/siyuan/issues/10393
export const removeImage = (imgSelectElement: Element, nodeElement: HTMLElement, range: Range, protyle: IProtyle) => {
    const oldHTML = nodeElement.outerHTML;
    const imgPreviousSibling = hasPreviousSibling(imgSelectElement);
    if (imgPreviousSibling && imgPreviousSibling.textContent.endsWith(Constants.ZWSP)) {
        imgPreviousSibling.textContent = imgPreviousSibling.textContent.substring(0, imgPreviousSibling.textContent.length - 1);
    }
    const imgNextSibling = hasNextSibling(imgSelectElement);
    if (imgNextSibling && imgNextSibling.textContent.startsWith(Constants.ZWSP)) {
        imgNextSibling.textContent = imgNextSibling.textContent.replace(Constants.ZWSP, "");
    }
    imgSelectElement.insertAdjacentHTML("afterend", "<wbr>");
    imgSelectElement.remove();
    updateTransaction(protyle, nodeElement, oldHTML);
    focusByWbr(nodeElement, range);
    // 不太清楚为什么删除图片后无法上下键定位，但重绘后就好了 https://ld246.com/article/1714314625702
    const editElement = getContenteditableElement(nodeElement);
    if (editElement.innerHTML.trim() === "") {
        editElement.innerHTML = "";
    }
};

const confirmRefRemoval = async (protyle: IProtyle, ids: string[], elements: Element[], exactIDs: string[] = []) => {
    const confirmed = await confirmBlockRef({
        scope: "blocks",
        ids,
        exactIDs,
        deletedIDs: ids,
        notebook: protyle.notebookId,
    }, protyle);
    if (confirmed && elements.every(item => item.isConnected)) {
        return true;
    }
    protyle.observerLoad?.observe(protyle.wysiwyg.element);
    return false;
};

const removeLi = async (protyle: IProtyle, blockElement: Element, range: Range, isDelete = false) => {
    if (!blockElement.parentElement.previousElementSibling && blockElement.parentElement.nextElementSibling && blockElement.parentElement.nextElementSibling.classList.contains("protyle-attr")) {
        await listOutdent(protyle, [blockElement.parentElement], range, isDelete, blockElement);
        return;
    }
    // 第一个子列表合并到上一个块的末尾
    if (!blockElement.parentElement.previousElementSibling && blockElement.parentElement.parentElement.parentElement.classList.contains("list")) {
        if (!await confirmRefRemoval(protyle,
            [blockElement.parentElement.getAttribute("data-node-id")], [blockElement.parentElement],
            [blockElement.parentElement.getAttribute("data-node-id")])) {
            return;
        }
        range.insertNode(document.createElement("wbr"));
        const listElement = blockElement.parentElement.parentElement;
        const listHTML = listElement.outerHTML;
        const listStart = getOrderedListStart(listElement);
        const previousLastElement = blockElement.parentElement.parentElement.previousElementSibling.lastElementChild;
        const previousHTML = previousLastElement.parentElement.outerHTML;
        blockElement.parentElement.firstElementChild.remove();
        blockElement.parentElement.lastElementChild.remove();
        previousLastElement.insertAdjacentHTML("beforebegin", blockElement.parentElement.innerHTML);
        blockElement.parentElement.remove();
        if (listElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listElement, listStart);
        }
        listElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        previousLastElement.parentElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        transaction(protyle, [{
            action: "update",
            id: listElement.getAttribute("data-node-id"),
            data: listElement.outerHTML
        }, {
            action: "update",
            data: previousLastElement.parentElement.outerHTML,
            id: previousLastElement.parentElement.getAttribute("data-node-id"),
        }], [{
            action: "update",
            data: previousHTML,
            id: previousLastElement.parentElement.getAttribute("data-node-id"),
        }, {
            action: "update",
            data: listHTML,
            id: listElement.getAttribute("data-node-id"),
        }]);
        focusByWbr(previousLastElement.parentElement, range);
        return;
    }
    // 顶级列表首行删除变为块
    if (!blockElement.parentElement.previousElementSibling) {
        if (blockElement.parentElement.parentElement.classList.contains("protyle-wysiwyg")) {
            return;
        }
        if (!await confirmRefRemoval(protyle,
            [blockElement.parentElement.getAttribute("data-node-id")], [blockElement.parentElement],
            [blockElement.parentElement.getAttribute("data-node-id")])) {
            return;
        }
        moveToPrevious(blockElement, range, isDelete);
        range.insertNode(document.createElement("wbr"));
        const listElement = blockElement.parentElement.parentElement;
        const listHTML = listElement.outerHTML;
        const listStart = getOrderedListStart(listElement);
        blockElement.parentElement.firstElementChild.remove();
        blockElement.parentElement.lastElementChild.remove();
        const tempElement = document.createElement("div");
        tempElement.innerHTML = blockElement.parentElement.innerHTML;
        const doOperations: IOperation[] = [];
        const undoOperations: IOperation[] = [];
        Array.from(tempElement.children).forEach((item, index) => {
            doOperations.push({
                action: "insert",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML,
                previousID: index === 0 ? getPreviousBlockSibling(listElement)?.getAttribute("data-node-id") : doOperations[index - 1].id,
                parentID: getOperationParentID(listElement, protyle.block.parentID)
            });
            undoOperations.push({
                action: "delete",
                id: item.getAttribute("data-node-id"),
            });
        });
        listElement.insertAdjacentHTML("beforebegin", blockElement.parentElement.innerHTML);
        blockElement.parentElement.remove();
        if (listElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listElement, listStart);
        }
        listElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        doOperations.splice(0, 0, {
            action: "update",
            id: listElement.getAttribute("data-node-id"),
            data: listElement.outerHTML
        });
        undoOperations.push({
            action: "update",
            data: listHTML,
            id: listElement.getAttribute("data-node-id"),
        });
        if (listElement.parentElement.classList.contains("sb") &&
            listElement.parentElement.getAttribute("data-sb-layout") === "col") {
            const selectsElement: Element[] = [];
            let previousElement: Element = listElement;
            while (previousElement) {
                selectsElement.push(previousElement);
                if (undoOperations[0].id === previousElement.getAttribute("data-node-id")) {
                    break;
                }
                previousElement = previousElement.previousElementSibling;
            }
            // 合并到同一个 transaction，避免新超级块 id 在第二个 transaction 中找不到
            const mergeOperations = await turnsIntoOneTransaction({
                protyle,
                selectsElement: selectsElement.reverse(),
                type: "BlocksMergeSuperBlock",
                level: "row",
                unfocus: true,
                getOperations: true,
                widthSourceElement: listElement as HTMLElement,
            });
            doOperations.push(...mergeOperations.doOperations);
            undoOperations.splice(0, 0, ...mergeOperations.undoOperations);
        }
        transaction(protyle, doOperations, undoOperations);
        focusByWbr(protyle.wysiwyg.element, range);
        return;
    }

    // 列表项合并到前一个列表项的最后一个块末尾
    const listItemElement = blockElement.parentElement;
    if (listItemElement.previousElementSibling && listItemElement.previousElementSibling.classList.contains("protyle-breadcrumb__bar")) {
        return;
    }
    const listItemId = listItemElement.getAttribute("data-node-id");
    const listElement = listItemElement.parentElement;
    const previousListItem = listItemElement.previousElementSibling;
    const deleteEmptyFoldedListItem = previousListItem.getAttribute("fold") === "1" &&
        getContenteditableElement(blockElement).textContent.trim() === "" &&
        blockElement.nextElementSibling.classList.contains("protyle-attr");
    const deleteFoldedListItem = previousListItem.getAttribute("fold") !== "1" || deleteEmptyFoldedListItem;
    const deletedListItemIDs = deleteEmptyFoldedListItem ?
        [listItemId, blockElement.getAttribute("data-node-id")] : [listItemId];
    if (deleteFoldedListItem && !await confirmRefRemoval(
        protyle, deletedListItemIDs, [listItemElement], [listItemId])) {
        return;
    }
    const shouldUpdateParentList = listElement.classList.contains("protyle-wysiwyg") &&
        listItemElement.getAttribute("data-subtype") === "o";
    const focusedParentListElement = shouldUpdateParentList ?
        await getFocusedParentOrderedList(protyle, listElement) : undefined;
    if (shouldUpdateParentList && !focusedParentListElement) {
        return;
    }
    if (!listItemElement.isConnected || !previousListItem.isConnected) {
        return;
    }
    moveToPrevious(blockElement, range, isDelete);
    range.insertNode(document.createElement("wbr"));
    const html = listElement.outerHTML;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [{
        action: "insert",
        id: listItemId,
        data: "",
        previousID: listItemElement.previousElementSibling.getAttribute("data-node-id")
    }];
    let foldElement: Element;
    const previousLastElement = previousListItem.lastElementChild;
    if (previousListItem.getAttribute("fold") === "1") {
        if (getContenteditableElement(blockElement).textContent.trim() === "" &&
            blockElement.nextElementSibling.classList.contains("protyle-attr")) {
            doOperations.push({
                action: "delete",
                id: listItemId
            });
            undoOperations[0].data = listItemElement.outerHTML;
            setLastNodeRange(getContenteditableElement(listItemElement.previousElementSibling), range);
            range.collapse(true);
            listItemElement.remove();
        } else {
            setLastNodeRange(getContenteditableElement(listItemElement.previousElementSibling), range);
            range.collapse(true);
            focusByRange(range);
            blockElement.querySelector("wbr")?.remove();
            return;
        }
    } else {
        const previousElement = previousLastElement.previousElementSibling;
        if (previousElement.getAttribute("fold") === "1" && previousElement.getAttribute("data-type") === "NodeHeading") {
            foldElement = previousElement;
        }
        let previousID = previousElement.getAttribute("data-node-id");
        Array.from(blockElement.parentElement.children).forEach((item, index) => {
            if (item.classList.contains("protyle-action") || item.classList.contains("protyle-attr")) {
                return;
            }
            const id = item.getAttribute("data-node-id");
            doOperations.push({
                action: "move",
                id,
                previousID,
                context: {ignoreProcess: foldElement ? "true" : "false"}
            });
            undoOperations.push({
                action: "move",
                id,
                previousID: index === 1 ? undefined : previousID,
                parentID: listItemId
            });
            previousID = id;
            if (foldElement) {
                item.remove();
            } else {
                previousLastElement.before(item);
            }
        });
        doOperations.push({
            action: "delete",
            id: listItemId
        });
        undoOperations[0].data = listItemElement.outerHTML;
        listItemElement.remove();
    }

    if (foldElement) {
        const foldOperations = setFold(protyle, foldElement, true, false, false, true);
        doOperations.push(...foldOperations.doOperations);
        undoOperations.push(...foldOperations.undoOperations);
        if (foldElement.parentElement.getAttribute("data-subtype") === "o") {
            let nextElement = foldElement.parentElement.nextElementSibling;
            while (nextElement && !nextElement.classList.contains("protyle-attr")) {
                const nextId = nextElement.getAttribute("data-node-id");
                undoOperations.push({
                    action: "update",
                    id: nextId,
                    data: nextElement.outerHTML
                });
                const count = parseInt(nextElement.getAttribute("data-marker")) - 1 + ".";
                nextElement.setAttribute("data-marker", count);
                nextElement.querySelector(".protyle-action--order").textContent = count;
                doOperations.push({
                    action: "update",
                    id: nextId,
                    data: nextElement.outerHTML
                });
                nextElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
                nextElement = nextElement.nextElementSibling;
            }
        }
        transaction(protyle, doOperations, undoOperations);
    } else if (listElement.classList.contains("protyle-wysiwyg")) {
        const orderOperations = focusedParentListElement ?
            getFocusedOrderedListRemoveOperations(focusedParentListElement,
                previousListItem as HTMLElement, listItemId) : {doOperations: [], undoOperations: []};
        transaction(protyle, [...doOperations, ...orderOperations.doOperations],
            [...undoOperations, ...orderOperations.undoOperations]);
    } else {
        if (listElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listElement);
        }
        updateTransaction(protyle, listElement, html);
    }
    focusByWbr(previousLastElement.parentElement, range);
};
