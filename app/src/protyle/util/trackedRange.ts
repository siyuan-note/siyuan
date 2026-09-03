import type {Plugin} from "../../plugin";
import {getContenteditableElement} from "../wysiwyg/getBlock";
import {hasClosestBlock, isInEmbedBlock} from "./hasClosest";
import {
    getTrackedTokenBoundaryCandidates,
    hasOverlappingTrackedTokenContext,
    type ITrackedTokenRange,
    mapTrackedTokenRange,
} from "./trackedRangeAnchor";

const EDITABLE_BOUNDARY_TOKEN = "editable-boundary";

interface IBoundaryPoint {
    node: Node;
    offset: number;
    depth: number;
}

interface IBoundaryPoints {
    before: IBoundaryPoint;
    after: IBoundaryPoint;
}

interface IEditableSnapshot {
    block: HTMLElement;
    editable: Element;
    tokens: string[];
    points: Array<IBoundaryPoints | undefined>;
    pointIndexes: Map<Node, Map<number, number>>;
    globalStart: number;
}

interface IRootStream {
    roots: HTMLElement[];
    snapshots: IEditableSnapshot[];
    tokens: string[];
}

interface IRangeSnapshot {
    stream: IRootStream;
    snapshot: IEditableSnapshot;
    start: number;
    end: number;
}

interface ITrackedRangeState {
    range: Range;
    startContainer: Node;
    endContainer: Node;
    exactTarget?: Element;
    collapsed: boolean;
    affinity: "before" | "after";
    targetTokens: string[];
    tokens: string[];
    start: number;
    end: number;
    sourceBlockID: string;
    sourceAncestorIDs: string[];
    rootIDs: string[];
    rootBlockIDs: Set<string>;
    syncedBlockIDs: Set<string>;
    sourceLineageIDs: Set<string>;
    sourceTransitions: Map<string, Set<string>>;
    lineageIDs: Set<string>;
    knownBlockIDs: Set<string>;
    owner?: Plugin;
    invalid: boolean;
    pendingInsertion?: ITrackedRangeInsertion;
    editEvidence: Set<IEditEvidence>;
    provisionalInput?: IProvisionalInputIntent;
}

interface IEditEvidence {
    includeAdjacentRoots: boolean;
    applyAffinity: boolean;
    trustLiveRange: boolean;
    insertion?: ITrackedRangeInsertion;
}

interface IProvisionalInputIntent extends IEditEvidence {
    editable: Element;
    inputType: string;
    invalidate: boolean;
}

export interface ITrackedRangeInsertion {
    readonly id: object;
}

interface ITrackedRangeInsertionData {
    protyle: IProtyle;
    states: ITrackedRangeState[];
    evidence: IEditEvidence;
    active: boolean;
}

interface IOwnedHandle {
    protyle: IProtyle;
    handle: ITrackedRangeHandle;
}

interface IInputListeners {
    element: HTMLElement;
    beforeInputListener: (event: InputEvent) => void;
    inputListener: (event: InputEvent) => void;
}

const trackedRanges = new WeakMap<IProtyle, Map<ITrackedRangeHandle, ITrackedRangeState>>();
const ownedHandles = new WeakMap<Plugin, Set<IOwnedHandle>>();
const unloadingPlugins = new WeakSet<Plugin>();
const destroyedProtyles = new WeakSet<IProtyle>();
const inputListeners = new WeakMap<IProtyle, IInputListeners>();
const trackedRangeInsertions = new WeakMap<ITrackedRangeInsertion, ITrackedRangeInsertionData>();
let handleSequence = 0;

const IGNORED_ATTRIBUTES = new Set([
    "aria-hidden",
    "aria-label",
    "class",
    "contenteditable",
    "data-editing",
    "data-node-id",
    "data-position",
    "data-render",
    "draggable",
    "spellcheck",
    "updated",
]);

const isTransientElement = (element: Element) => {
    return element.tagName === "WBR" || element.classList.contains("protyle-action") ||
        element.classList.contains("protyle-action__drag") ||
        element.classList.contains("protyle-action__title");
};

const getElementSignature = (element: Element) => {
    const attributes = Array.from(element.attributes)
        .filter(attribute => !IGNORED_ATTRIBUTES.has(attribute.name) && !attribute.name.startsWith("aria-"))
        .filter(attribute => !(attribute.name === "src" && element.hasAttribute("data-src")))
        .filter(attribute => !(attribute.name === "href" && element.hasAttribute("data-href")))
        .sort((first, second) => first.name.localeCompare(second.name))
        .map(attribute => `${attribute.name}=${JSON.stringify(attribute.value)}`)
        .join(";");
    return `${element.tagName.toLowerCase()}[${attributes}]`;
};

const getAtomicSignature = (element: Element): string => {
    const values = [`<${getElementSignature(element)}>`];
    Array.from(element.childNodes).forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent?.split("\u200B").join("") || "";
            if (text) {
                values.push(JSON.stringify(text));
            }
        } else if (child.nodeType === Node.ELEMENT_NODE && !isTransientElement(child as Element)) {
            values.push(getAtomicSignature(child as Element));
        }
    });
    values.push(`</${element.tagName.toLowerCase()}>`);
    return values.join("");
};

const isAtomicElement = (element: Element) => {
    return element.tagName === "BR" || element.tagName === "IMG" || element.getAttribute("contenteditable") === "false";
};

const setBoundaryPoint = (snapshot: IEditableSnapshot, node: Node, offset: number, depth: number) => {
    let indexes = snapshot.pointIndexes.get(node);
    if (!indexes) {
        indexes = new Map<number, number>();
        snapshot.pointIndexes.set(node, indexes);
    }
    indexes.set(offset, snapshot.tokens.length);
    const point = {node, offset, depth};
    const current = snapshot.points[snapshot.tokens.length];
    if (!current || depth < current.before.depth) {
        snapshot.points[snapshot.tokens.length] = {before: point, after: point};
    } else if (depth === current.before.depth) {
        current.after = point;
    }
};

const tokenizeNode = (snapshot: IEditableSnapshot, node: Node, depth: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        let offset = 0;
        setBoundaryPoint(snapshot, node, offset, depth);
        Array.from(text).forEach(character => {
            const nextOffset = offset + character.length;
            if (character !== "\u200B") {
                snapshot.tokens.push(`text:${character}`);
            }
            offset = nextOffset;
            setBoundaryPoint(snapshot, node, offset, depth);
        });
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
    }
    const element = node as Element;
    if (isTransientElement(element)) {
        return;
    }
    if (isAtomicElement(element)) {
        snapshot.tokens.push(`atomic:${getAtomicSignature(element)}`);
        return;
    }
    snapshot.tokens.push(`open:${getElementSignature(element)}`);
    setBoundaryPoint(snapshot, element, 0, depth);
    Array.from(element.childNodes).forEach((child, index) => {
        setBoundaryPoint(snapshot, element, index, depth);
        tokenizeNode(snapshot, child, depth + 1);
        setBoundaryPoint(snapshot, element, index + 1, depth);
    });
    snapshot.tokens.push(`close:${element.tagName.toLowerCase()}`);
};

const createEditableSnapshot = (block: HTMLElement, editable: Element): IEditableSnapshot => {
    const snapshot: IEditableSnapshot = {
        block,
        editable,
        tokens: [],
        points: [],
        pointIndexes: new Map(),
        globalStart: 0,
    };
    setBoundaryPoint(snapshot, editable, 0, 0);
    Array.from(editable.childNodes).forEach((child, index) => {
        setBoundaryPoint(snapshot, editable, index, 0);
        tokenizeNode(snapshot, child, 1);
        setBoundaryPoint(snapshot, editable, index + 1, 0);
    });
    return snapshot;
};

const compareElements = (first: Element, second: Element) => {
    if (first === second) {
        return 0;
    }
    return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
};

const sortElements = <T extends Element>(elements: T[]) => {
    return elements.sort(compareElements);
};

const getAncestorBlockIDs = (editorElement: Element, block: Element) => {
    const ids: string[] = [];
    let current: Element | null = block;
    while (current && current !== editorElement) {
        const id = current.getAttribute("data-node-id");
        if (id) {
            ids.push(id);
        }
        current = current.parentElement;
    }
    return ids;
};

const getTopLevelBlock = (editorElement: Element, block: Element) => {
    let root = block as HTMLElement;
    let current = block.parentElement;
    while (current && current !== editorElement) {
        if (current.hasAttribute("data-node-id")) {
            root = current;
        }
        current = current.parentElement;
    }
    return root;
};

const getEditableSnapshots = (roots: HTMLElement[]) => {
    const snapshots: IEditableSnapshot[] = [];
    const seen = new Set<Element>();
    roots.forEach(root => {
        const blocks = [root, ...Array.from(root.querySelectorAll<HTMLElement>("[data-node-id]"))];
        blocks.forEach(block => {
            if (isInEmbedBlock(block, false)) {
                return;
            }
            const editable = getContenteditableElement(block);
            if (editable && hasClosestBlock(editable) === block && !seen.has(editable)) {
                seen.add(editable);
                snapshots.push(createEditableSnapshot(block, editable));
            }
            block.querySelectorAll<HTMLElement>(".callout-title").forEach(title => {
                if (hasClosestBlock(title) === block && !seen.has(title)) {
                    seen.add(title);
                    snapshots.push(createEditableSnapshot(block, title));
                }
            });
        });
    });
    return snapshots.sort((first, second) => compareElements(first.editable, second.editable));
};

const createRootStream = (roots: HTMLElement[]): IRootStream => {
    roots = sortElements(Array.from(new Set(roots)));
    const snapshots = getEditableSnapshots(roots);
    const tokens: string[] = [];
    snapshots.forEach((snapshot, index) => {
        if (index > 0) {
            tokens.push(EDITABLE_BOUNDARY_TOKEN);
        }
        snapshot.globalStart = tokens.length;
        tokens.push(...snapshot.tokens);
    });
    return {roots, snapshots, tokens};
};

const getRootBlockIDs = (roots: HTMLElement[]) => {
    const ids = new Set<string>();
    roots.forEach(root => {
        const blocks = [root, ...Array.from(root.querySelectorAll<HTMLElement>("[data-node-id]"))];
        blocks.forEach(block => {
            if (isInEmbedBlock(block, false)) {
                return;
            }
            const id = block.getAttribute("data-node-id");
            if (id) {
                ids.add(id);
            }
        });
    });
    return ids;
};

const getRangeSnapshot = (protyle: IProtyle, range: Range): IRangeSnapshot | undefined => {
    const editorElement = protyle.wysiwyg?.element;
    if (!editorElement || !editorElement.contains(range.startContainer) || !editorElement.contains(range.endContainer)) {
        return;
    }
    const startBlock = hasClosestBlock(range.startContainer);
    const endBlock = hasClosestBlock(range.endContainer);
    if (!startBlock || startBlock !== endBlock || isInEmbedBlock(startBlock, false) || protyle.options.backlinkData) {
        return;
    }
    const startEditable = getContenteditableElement(startBlock, range.startContainer);
    const endEditable = getContenteditableElement(endBlock, range.endContainer);
    if (!startEditable || startEditable !== endEditable || !startEditable.contains(range.startContainer) ||
        !startEditable.contains(range.endContainer)) {
        return;
    }
    const root = getTopLevelBlock(editorElement, startBlock);
    const stream = createRootStream([root]);
    const snapshot = stream.snapshots.find(item => item.editable === startEditable);
    if (!snapshot) {
        return;
    }
    const localStart = snapshot.pointIndexes.get(range.startContainer)?.get(range.startOffset);
    const localEnd = snapshot.pointIndexes.get(range.endContainer)?.get(range.endOffset);
    if (typeof localStart !== "number" || typeof localEnd !== "number") {
        return;
    }
    return {
        stream,
        snapshot,
        start: snapshot.globalStart + localStart,
        end: snapshot.globalStart + localEnd,
    };
};

const getRangeSnapshotFromStream = (stream: IRootStream, range: Range): IRangeSnapshot | undefined => {
    const snapshot = stream.snapshots.find(item => item.editable.contains(range.startContainer) &&
        item.editable.contains(range.endContainer));
    if (!snapshot) {
        return;
    }
    const localStart = snapshot.pointIndexes.get(range.startContainer)?.get(range.startOffset);
    const localEnd = snapshot.pointIndexes.get(range.endContainer)?.get(range.endOffset);
    if (typeof localStart !== "number" || typeof localEnd !== "number") {
        return;
    }
    return {
        stream,
        snapshot,
        start: snapshot.globalStart + localStart,
        end: snapshot.globalStart + localEnd,
    };
};

const getExactlySelectedElement = (range: Range) => {
    if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== Node.ELEMENT_NODE ||
        range.endOffset !== range.startOffset + 1) {
        return;
    }
    const target = range.startContainer.childNodes[range.startOffset];
    return target?.nodeType === Node.ELEMENT_NODE ? target as Element : undefined;
};

const getBoundaryPoint = (stream: IRootStream, index: number, affinity: "before" | "after") => {
    const matches = stream.snapshots.filter(snapshot => index >= snapshot.globalStart &&
        index <= snapshot.globalStart + snapshot.tokens.length);
    if (matches.length === 0) {
        return;
    }
    const snapshot = affinity === "before" ? matches[0] : matches[matches.length - 1];
    return snapshot.points[index - snapshot.globalStart]?.[affinity];
};

const createRangeFromStream = (stream: IRootStream, start: number, end: number,
                               affinity: "before" | "after") => {
    const startPoint = getBoundaryPoint(stream, start, start === end ? affinity : "after");
    const endPoint = getBoundaryPoint(stream, end, start === end ? affinity : "before");
    if (!startPoint || !endPoint) {
        return;
    }
    const range = document.createRange();
    try {
        range.setStart(startPoint.node, startPoint.offset);
        range.setEnd(endPoint.node, endPoint.offset);
    } catch {
        return;
    }
    return range;
};

const equalTokens = (first: string[], second: string[]) => {
    return first.length === second.length && first.every((token, index) => token === second[index]);
};

const addSourceTransition = (state: ITrackedRangeState, first: string, second: string) => {
    if (!first || !second || first === second) {
        return;
    }
    [
        {source: first, target: second},
        {source: second, target: first},
    ].forEach(edge => {
        let targets = state.sourceTransitions.get(edge.source);
        if (!targets) {
            targets = new Set();
            state.sourceTransitions.set(edge.source, targets);
        }
        targets.add(edge.target);
    });
};

const updateState = (protyle: IProtyle, state: ITrackedRangeState, range: Range,
                     existingSnapshot?: IRangeSnapshot) => {
    const rangeSnapshot = existingSnapshot || getRangeSnapshot(protyle, range);
    if (!rangeSnapshot) {
        return false;
    }
    const targetTokens = rangeSnapshot.stream.tokens.slice(rangeSnapshot.start, rangeSnapshot.end);
    if (!state.collapsed && !equalTokens(state.targetTokens, targetTokens)) {
        return false;
    }
    const trackedRange = range.cloneRange();
    state.range = trackedRange;
    state.startContainer = trackedRange.startContainer;
    state.endContainer = trackedRange.endContainer;
    state.exactTarget = getExactlySelectedElement(trackedRange);
    state.tokens = rangeSnapshot.stream.tokens;
    state.start = rangeSnapshot.start;
    state.end = rangeSnapshot.end;
    const previousSourceBlockID = state.sourceBlockID;
    state.sourceBlockID = rangeSnapshot.snapshot.block.getAttribute("data-node-id") || "";
    state.sourceAncestorIDs = getAncestorBlockIDs(protyle.wysiwyg.element, rangeSnapshot.snapshot.block);
    state.rootIDs = rangeSnapshot.stream.roots.map(root => root.getAttribute("data-node-id") || "").filter(Boolean);
    state.rootBlockIDs = getRootBlockIDs(rangeSnapshot.stream.roots);
    addSourceTransition(state, previousSourceBlockID, state.sourceBlockID);
    state.sourceLineageIDs.add(state.sourceBlockID);
    [...state.sourceAncestorIDs, ...state.rootIDs].forEach(id => state.lineageIDs.add(id));
    state.rootBlockIDs.forEach(id => state.knownBlockIDs.add(id));
    return true;
};

const resolveExactTarget = (protyle: IProtyle, state: ITrackedRangeState) => {
    if (!state.exactTarget?.isConnected) {
        return;
    }
    if (!protyle.wysiwyg.element.contains(state.exactTarget)) {
        state.invalid = true;
        return;
    }
    const range = document.createRange();
    range.selectNode(state.exactTarget);
    if (!updateState(protyle, state, range)) {
        state.invalid = true;
        return;
    }
    return range;
};

const getLiveRange = (protyle: IProtyle, state: ITrackedRangeState, allowCollapsed = false) => {
    const editorElement = protyle.wysiwyg.element;
    if (!editorElement.contains(state.startContainer) || !editorElement.contains(state.endContainer) ||
        !editorElement.contains(state.range.startContainer) || !editorElement.contains(state.range.endContainer) ||
        state.range.collapsed !== state.collapsed || (state.collapsed && !allowCollapsed)) {
        return;
    }
    return state.range.cloneRange();
};

const resolveLiveRange = (protyle: IProtyle, state: ITrackedRangeState, allowCollapsed = false) => {
    const range = getLiveRange(protyle, state, allowCollapsed);
    if (!range) {
        return;
    }
    return updateState(protyle, state, range) ? range : undefined;
};

const getRootsForIDs = (editorElement: HTMLElement, ids: Set<string>) => {
    const roots = new Set<HTMLElement>();
    editorElement.querySelectorAll<HTMLElement>("[data-node-id]").forEach(block => {
        if (ids.has(block.getAttribute("data-node-id") || "") && !isInEmbedBlock(block, false)) {
            roots.add(getTopLevelBlock(editorElement, block));
        }
    });
    return sortElements(Array.from(roots));
};

const addAdjacentUnknownRoots = (roots: HTMLElement[], state: ITrackedRangeState) => {
    const expandedRoots = new Set(roots);
    const addDirection = (root: HTMLElement, direction: "nextElementSibling" | "previousElementSibling") => {
        let sibling = root[direction] as HTMLElement | null;
        while (sibling?.hasAttribute("data-node-id")) {
            const id = sibling.getAttribute("data-node-id") || "";
            if (!id || state.knownBlockIDs.has(id)) {
                break;
            }
            expandedRoots.add(sibling);
            sibling = sibling[direction] as HTMLElement | null;
        }
    };
    roots.forEach(root => {
        addDirection(root, "previousElementSibling");
        addDirection(root, "nextElementSibling");
    });
    return sortElements(Array.from(expandedRoots));
};

const getResolveStream = (protyle: IProtyle, state: ITrackedRangeState, includeAdjacentRoots: boolean) => {
    const ids = new Set([...state.rootIDs, ...state.sourceAncestorIDs]);
    let roots = getRootsForIDs(protyle.wysiwyg.element, ids);
    if (roots.length === 0) {
        return;
    }
    let stream = createRootStream(roots);
    if (includeAdjacentRoots || !equalTokens(state.tokens, stream.tokens)) {
        roots = addAdjacentUnknownRoots(roots, state);
        stream = createRootStream(roots);
    }
    return stream;
};

const getProvisionalSourceIDs = (state: ITrackedRangeState, stream: IRootStream) => {
    const currentBlockIDs = getRootBlockIDs(stream.roots);
    return {
        introduced: new Set(Array.from(currentBlockIDs).filter(id => !state.knownBlockIDs.has(id))),
        restored: new Set(Array.from(currentBlockIDs).filter(id => state.sourceLineageIDs.has(id))),
    };
};

const mapStateToStream = (protyle: IProtyle, state: ITrackedRangeState, stream: IRootStream,
                          introducedSourceIDs?: Set<string>, restoredSourceIDs?: Set<string>,
                          existingMappedRange?: ITrackedTokenRange) => {
    const mapped = existingMappedRange || mapTrackedTokenRange(state.tokens, stream.tokens,
        {start: state.start, end: state.end}, state.collapsed, state.affinity);
    if (!mapped) {
        return;
    }
    const range = createRangeFromStream(stream, mapped.start, mapped.end, state.affinity);
    if (!range) {
        return;
    }
    const snapshot = stream.snapshots.find(item => mapped.start >= item.globalStart &&
        mapped.end <= item.globalStart + item.tokens.length && item.editable.contains(range.startContainer) &&
        item.editable.contains(range.endContainer));
    const sourceBlockID = snapshot?.block.getAttribute("data-node-id") || "";
    if (!snapshot) {
        return;
    }
    if (sourceBlockID !== state.sourceBlockID) {
        const sourceStillExists = stream.snapshots.some(item =>
            item.block.getAttribute("data-node-id") === state.sourceBlockID);
        const isNewSplitSource = introducedSourceIDs?.has(sourceBlockID) &&
            !state.syncedBlockIDs.has(sourceBlockID) && sourceStillExists;
        const isRestoredSource = state.sourceTransitions.get(state.sourceBlockID)?.has(sourceBlockID) &&
            restoredSourceIDs?.has(sourceBlockID) &&
            (!sourceStillExists || !state.syncedBlockIDs.has(sourceBlockID));
        if (!sourceBlockID || (!isNewSplitSource && !isRestoredSource)) {
            return;
        }
    }
    if (!updateState(protyle, state, range, {stream, snapshot, start: mapped.start, end: mapped.end})) {
        return;
    }
    return range;
};

const resolveState = (protyle: IProtyle, state: ITrackedRangeState) => {
    if (state.invalid || !protyle.wysiwyg?.element?.isConnected) {
        return;
    }
    const exactRange = resolveExactTarget(protyle, state);
    if (exactRange || state.invalid) {
        return exactRange;
    }
    if (!state.collapsed) {
        const liveRange = resolveLiveRange(protyle, state);
        if (liveRange) {
            return liveRange;
        }
        const stream = getResolveStream(protyle, state, false);
        if (!stream) {
            return;
        }
        const sourceIDs = getProvisionalSourceIDs(state, stream);
        return mapStateToStream(protyle, state, stream, sourceIDs.introduced, sourceIDs.restored);
    }
    const hasAffinityEvidence = Array.from(state.editEvidence).some(evidence => evidence.applyAffinity);
    const trustLiveRange = !hasAffinityEvidence &&
        Array.from(state.editEvidence).some(evidence => evidence.trustLiveRange);
    const includeAdjacentRoots = Array.from(state.editEvidence)
        .some(evidence => evidence.includeAdjacentRoots);
    const stream = getResolveStream(protyle, state, includeAdjacentRoots);
    if (!stream) {
        return;
    }
    if (equalTokens(state.tokens, stream.tokens)) {
        const liveRange = getLiveRange(protyle, state, true);
        const liveSnapshot = liveRange && getRangeSnapshotFromStream(stream, liveRange);
        if (liveRange && liveSnapshot && updateState(protyle, state, liveRange, liveSnapshot)) {
            Array.from(state.editEvidence).forEach(evidence => {
                if (!evidence.insertion) {
                    state.editEvidence.delete(evidence);
                }
            });
            return liveRange;
        }
        return mapStateToStream(protyle, state, stream);
    }
    if (state.editEvidence.size > 0) {
        state.editEvidence.clear();
    }
    state.provisionalInput = undefined;
    const mapped = mapTrackedTokenRange(state.tokens, stream.tokens, {start: state.start, end: state.end},
        true, state.affinity, hasAffinityEvidence);
    const liveRange = (!hasAffinityEvidence || trustLiveRange) && getLiveRange(protyle, state, true);
    const liveSnapshot = liveRange && getRangeSnapshotFromStream(stream, liveRange);
    const boundaryCandidates = getTrackedTokenBoundaryCandidates(state.tokens, stream.tokens, state.start);
    const liveMatchesMapping = liveSnapshot && (trustLiveRange || (mapped ?
        liveSnapshot.start === mapped.start && liveSnapshot.end === mapped.end :
        hasOverlappingTrackedTokenContext(state.tokens, stream.tokens) &&
        boundaryCandidates.length === 1 && boundaryCandidates.includes(liveSnapshot.start) &&
        liveSnapshot.start === liveSnapshot.end));
    if (liveRange && liveSnapshot && liveMatchesMapping && updateState(protyle, state, liveRange, liveSnapshot)) {
        return liveRange;
    }
    const sourceIDs = getProvisionalSourceIDs(state, stream);
    return mapStateToStream(protyle, state, stream, sourceIDs.introduced, sourceIDs.restored, mapped);
};

const getOperationIDs = (operation: IOperation) => {
    return [
        operation.id,
        operation.blockID,
        operation.parentID,
        operation.previousID,
        operation.nextID,
        ...(operation.blockIDs || []),
        ...(operation.srcIDs || []),
    ].filter(Boolean) as string[];
};

const getOperationDataBlockIDs = (operation: IOperation) => {
    const blockIDs: string[] = [];
    if (typeof operation.data !== "string" || !operation.data.includes("data-node-id")) {
        return blockIDs;
    }
    const template = document.createElement("template");
    template.innerHTML = operation.data;
    const firstElementID = template.content.firstElementChild?.getAttribute("data-node-id");
    if (firstElementID) {
        blockIDs.push(firstElementID);
    }
    template.content.querySelectorAll<HTMLElement>("[data-node-id]").forEach(block => {
        const id = block.getAttribute("data-node-id");
        if (id) {
            blockIDs.push(id);
        }
    });
    return blockIDs;
};

const rememberOperationReferences = (state: ITrackedRangeState, operations: IOperation[]) => {
    operations.forEach(operation => {
        if (!["insert", "move", "update"].includes(operation.action)) {
            return;
        }
        [operation.id, operation.blockID, ...(operation.blockIDs || []), ...(operation.srcIDs || [])]
            .filter(Boolean).forEach(id => state.knownBlockIDs.add(id));
    });
};

const rememberOperationBlockIDs = (state: ITrackedRangeState, operations: IOperation[]) => {
    rememberOperationReferences(state, operations);
    operations.forEach(operation => {
        if (["insert", "update"].includes(operation.action)) {
            getOperationDataBlockIDs(operation).forEach(id => state.knownBlockIDs.add(id));
        }
    });
};

const getRelatedOperationIDs = (state: ITrackedRangeState, operations: IOperation[]) => {
    const ids = new Set([state.sourceBlockID, ...state.sourceAncestorIDs, ...state.rootIDs, ...state.rootBlockIDs]);
    const operationIDs = operations.map(getOperationIDs);
    const operationIndexes = new Map<string, number[]>();
    operationIDs.forEach((itemIDs, index) => {
        itemIDs.forEach(id => {
            let indexes = operationIndexes.get(id);
            if (!indexes) {
                indexes = [];
                operationIndexes.set(id, indexes);
            }
            indexes.push(index);
        });
    });
    const pendingIDs = Array.from(ids);
    const visitedOperations = new Set<number>();
    let related = false;
    for (let pendingIndex = 0; pendingIndex < pendingIDs.length; pendingIndex++) {
        operationIndexes.get(pendingIDs[pendingIndex])?.forEach(operationIndex => {
            if (!visitedOperations.has(operationIndex)) {
                visitedOperations.add(operationIndex);
                related = true;
                operationIDs[operationIndex].forEach(id => {
                    if (!ids.has(id)) {
                        ids.add(id);
                        pendingIDs.push(id);
                    }
                });
            }
        });
    }
    if (!related) {
        return;
    }
    state.lineageIDs.forEach(id => {
        if (!ids.has(id) && operationIndexes.has(id)) {
            ids.add(id);
            pendingIDs.push(id);
        }
    });
    for (let pendingIndex = 0; pendingIndex < pendingIDs.length; pendingIndex++) {
        operationIndexes.get(pendingIDs[pendingIndex])?.forEach(operationIndex => {
            if (!visitedOperations.has(operationIndex)) {
                visitedOperations.add(operationIndex);
                operationIDs[operationIndex].forEach(id => {
                    if (!ids.has(id)) {
                        ids.add(id);
                        pendingIDs.push(id);
                    }
                });
            }
        });
    }
    return ids;
};

const getIntroducedBlockIDs = (state: ITrackedRangeState, operations: IOperation[], relatedIDs: Set<string>) => {
    const ids = new Set<string>();
    const lineageIDs = new Set([state.sourceBlockID, ...state.sourceAncestorIDs]);
    const movedIDs = new Set<string>();
    operations.forEach(operation => {
        if (operation.action !== "move") {
            return;
        }
        [operation.id, operation.blockID, ...(operation.blockIDs || []), ...(operation.srcIDs || [])]
            .filter(Boolean).forEach(id => movedIDs.add(id));
    });
    const addID = (id?: string) => {
        if (id && !state.knownBlockIDs.has(id) && !movedIDs.has(id)) {
            ids.add(id);
        }
    };
    operations.forEach(operation => {
        if (operation.action !== "update" || !lineageIDs.has(operation.id) ||
            !getOperationIDs(operation).some(id => relatedIDs.has(id))) {
            return;
        }
        const dataBlockIDs = getOperationDataBlockIDs(operation);
        if (!dataBlockIDs.includes(state.sourceBlockID)) {
            return;
        }
        dataBlockIDs.forEach(addID);
    });
    const pending = operations.filter(operation => operation.action === "insert");
    let added = true;
    while (added) {
        added = false;
        for (let index = pending.length - 1; index >= 0; index--) {
            const operation = pending[index];
            if (![operation.parentID, operation.previousID, operation.nextID]
                .some(id => id && (lineageIDs.has(id) || ids.has(id)))) {
                continue;
            }
            const size = ids.size;
            addID(operation.id);
            getOperationDataBlockIDs(operation).forEach(addID);
            if (ids.size > size) {
                added = true;
            }
            pending.splice(index, 1);
        }
    }
    return ids;
};

const getRestoredSourceIDs = (state: ITrackedRangeState, operations: IOperation[], relatedIDs: Set<string>) => {
    const ids = new Set<string>();
    const addLineageID = (id?: string) => {
        if (id && state.sourceLineageIDs.has(id)) {
            ids.add(id);
        }
    };
    operations.forEach(operation => {
        if (!getOperationIDs(operation).some(id => relatedIDs.has(id))) {
            return;
        }
        if (["insert", "update", "move"].includes(operation.action)) {
            addLineageID(operation.id);
            addLineageID(operation.blockID);
            operation.blockIDs?.forEach(addLineageID);
            operation.srcIDs?.forEach(addLineageID);
        }
        if (!["insert", "update"].includes(operation.action) || typeof operation.data !== "string" ||
            !operation.data.includes("data-node-id")) {
            return;
        }
        const template = document.createElement("template");
        template.innerHTML = operation.data;
        addLineageID(template.content.firstElementChild?.getAttribute("data-node-id"));
        template.content.querySelectorAll<HTMLElement>("[data-node-id]").forEach(block => {
            addLineageID(block.getAttribute("data-node-id"));
        });
    });
    return ids;
};

const getManager = (protyle: IProtyle) => {
    let manager = trackedRanges.get(protyle);
    if (!manager) {
        manager = new Map();
        trackedRanges.set(protyle, manager);
    }
    return manager;
};

const comparePoints = (firstNode: Node, firstOffset: number, secondNode: Node, secondOffset: number) => {
    const first = document.createRange();
    const second = document.createRange();
    try {
        first.setStart(firstNode, firstOffset);
        first.collapse(true);
        second.setStart(secondNode, secondOffset);
        second.collapse(true);
        return first.compareBoundaryPoints(Range.START_TO_START, second);
    } catch {
        return;
    }
};

const rememberAdjacentRootIDs = (protyle: IProtyle, state: ITrackedRangeState) => {
    const ids = new Set([...state.rootIDs, ...state.sourceAncestorIDs]);
    getRootsForIDs(protyle.wysiwyg.element, ids).forEach(root => {
        [root.previousElementSibling, root.nextElementSibling].forEach(sibling => {
            const id = sibling?.getAttribute("data-node-id");
            if (id) {
                state.knownBlockIDs.add(id);
            }
        });
    });
};

export const prepareTrackedRangeInsertion = (protyle: IProtyle, range: Range) => {
    const insertion = Object.freeze({id: {}});
    const states: ITrackedRangeState[] = [];
    if (range.collapsed) {
        trackedRanges.get(protyle)?.forEach(state => {
            if (!state.invalid && !state.pendingInsertion && state.collapsed &&
                comparePoints(range.startContainer, range.startOffset,
                state.range.startContainer, state.range.startOffset) === 0) {
                state.pendingInsertion = insertion;
                states.push(state);
            }
        });
    }
    const evidence: IEditEvidence = {
        includeAdjacentRoots: true,
        applyAffinity: true,
        trustLiveRange: false,
        insertion,
    };
    trackedRangeInsertions.set(insertion, {protyle, states, evidence, active: false});
    return insertion;
};

export const activateTrackedRangeInsertion = (insertion?: ITrackedRangeInsertion) => {
    const data = insertion && trackedRangeInsertions.get(insertion);
    if (!data || data.active) {
        return;
    }
    data.active = true;
    data.states.forEach(state => {
        rememberAdjacentRootIDs(data.protyle, state);
        state.editEvidence.add(data.evidence);
    });
};

export const setTrackedRangeInsertionResult = (insertion: ITrackedRangeInsertion | undefined,
                                               beforeRange: Range, afterRange: Range) => {
    const data = insertion && trackedRangeInsertions.get(insertion);
    if (!data?.active) {
        return;
    }
    data.states.forEach(state => {
        if (!state.invalid && !updateState(data.protyle, state,
            state.affinity === "before" ? beforeRange : afterRange)) {
            state.invalid = true;
        }
    });
};

export const endTrackedRangeInsertion = (insertion: ITrackedRangeInsertion) => {
    const data = trackedRangeInsertions.get(insertion);
    if (!data) {
        return;
    }
    data.states.forEach(state => {
        state.editEvidence.delete(data.evidence);
        if (state.pendingInsertion === insertion) {
            state.pendingInsertion = undefined;
        }
    });
    trackedRangeInsertions.delete(insertion);
};

const editTouchesTrackedRange = (editRange: Range, trackedRange: Range) => {
    if (trackedRange.collapsed) {
        if (editRange.collapsed) {
            return false;
        }
        const afterStart = comparePoints(editRange.startContainer, editRange.startOffset,
            trackedRange.startContainer, trackedRange.startOffset);
        const beforeEnd = comparePoints(editRange.endContainer, editRange.endOffset,
            trackedRange.startContainer, trackedRange.startOffset);
        return typeof afterStart === "number" && typeof beforeEnd === "number" && afterStart < 0 && beforeEnd > 0;
    }
    if (editRange.collapsed) {
        const afterStart = comparePoints(trackedRange.startContainer, trackedRange.startOffset,
            editRange.startContainer, editRange.startOffset);
        const beforeEnd = comparePoints(trackedRange.endContainer, trackedRange.endOffset,
            editRange.startContainer, editRange.startOffset);
        return typeof afterStart === "number" && typeof beforeEnd === "number" && afterStart < 0 && beforeEnd > 0;
    }
    const startsBeforeTrackedEnd = comparePoints(editRange.startContainer, editRange.startOffset,
        trackedRange.endContainer, trackedRange.endOffset);
    const endsAfterTrackedStart = comparePoints(editRange.endContainer, editRange.endOffset,
        trackedRange.startContainer, trackedRange.startOffset);
    return typeof startsBeforeTrackedEnd === "number" && typeof endsAfterTrackedStart === "number" &&
        startsBeforeTrackedEnd < 0 && endsAfterTrackedStart > 0;
};

const isInsertionAtTrackedRange = (event: InputEvent, editRange: Range, trackedRange: Range) => {
    return trackedRange.collapsed && editRange.collapsed && event.inputType.startsWith("insert") &&
        comparePoints(editRange.startContainer, editRange.startOffset,
            trackedRange.startContainer, trackedRange.startOffset) === 0;
};

const getInputEditable = (protyle: IProtyle, target: EventTarget | null) => {
    const targetNode = target as Node | null;
    const targetElement = targetNode?.nodeType === Node.ELEMENT_NODE ? targetNode as Element : targetNode?.parentElement;
    if (!targetNode || !protyle.wysiwyg.element.contains(targetNode) ||
        targetElement?.closest("input, select, textarea, [contenteditable=\"false\"]")) {
        return;
    }
    const targetBlock = hasClosestBlock(targetNode);
    const targetEditable = targetBlock && getContenteditableElement(targetBlock, targetNode);
    if (!targetEditable || !targetEditable.contains(targetNode)) {
        return;
    }
    return targetEditable;
};

const getBeforeInputRanges = (event: InputEvent, targetEditable: Element) => {
    const ranges: Range[] = [];
    try {
        event.getTargetRanges().forEach(targetRange => {
            if (!targetEditable.contains(targetRange.startContainer) ||
                !targetEditable.contains(targetRange.endContainer)) {
                return;
            }
            const range = document.createRange();
            range.setStart(targetRange.startContainer, targetRange.startOffset);
            range.setEnd(targetRange.endContainer, targetRange.endOffset);
            ranges.push(range);
        });
    } catch {
        // 部分输入法不提供目标范围，下面使用当前选区兜底。
    }
    if (ranges.length === 0) {
        const selection = document.getSelection();
        if (selection?.rangeCount) {
            const range = selection.getRangeAt(0);
            if (targetEditable.contains(range.startContainer) && targetEditable.contains(range.endContainer)) {
                ranges.push(range.cloneRange());
            }
        }
    }
    return ranges;
};

const ensureInputListeners = (protyle: IProtyle) => {
    if (inputListeners.has(protyle)) {
        return;
    }
    const element = protyle.wysiwyg.element;
    const beforeInputListener = (event: InputEvent) => {
        if (event.defaultPrevented || ["historyRedo", "historyUndo"].includes(event.inputType)) {
            return;
        }
        const editable = getInputEditable(protyle, event.target);
        if (!editable) {
            return;
        }
        const ranges = getBeforeInputRanges(event, editable);
        if (ranges.length === 0) {
            return;
        }
        trackedRanges.get(protyle)?.forEach(state => {
            let intent: IProvisionalInputIntent | undefined;
            if (ranges.some(range => editTouchesTrackedRange(range, state.range))) {
                intent = {
                    editable,
                    inputType: event.inputType,
                    includeAdjacentRoots: false,
                    applyAffinity: false,
                    trustLiveRange: false,
                    invalidate: true,
                };
            } else if (ranges.some(range => isInsertionAtTrackedRange(event, range, state.range))) {
                rememberAdjacentRootIDs(protyle, state);
                intent = {
                    editable,
                    inputType: event.inputType,
                    includeAdjacentRoots: ["insertLineBreak", "insertParagraph"].includes(event.inputType),
                    applyAffinity: true,
                    trustLiveRange: false,
                    invalidate: false,
                };
            } else if (editable.contains(state.range.startContainer) && editable.contains(state.range.endContainer)) {
                intent = {
                    editable,
                    inputType: event.inputType,
                    includeAdjacentRoots: false,
                    applyAffinity: false,
                    trustLiveRange: true,
                    invalidate: false,
                };
            }
            if (intent) {
                state.provisionalInput = intent;
                setTimeout(() => {
                    if (state.provisionalInput === intent) {
                        state.provisionalInput = undefined;
                    }
                }, 0);
            }
        });
    };
    const inputListener = (event: InputEvent) => {
        const editable = getInputEditable(protyle, event.target);
        if (!editable) {
            return;
        }
        trackedRanges.get(protyle)?.forEach((state, handle) => {
            const intent = state.provisionalInput;
            if (intent?.editable === editable && intent.inputType === event.inputType) {
                state.provisionalInput = undefined;
                if (intent.invalidate) {
                    removeTrackedRange(protyle, handle);
                } else {
                    state.editEvidence.add(intent);
                }
            }
        });
    };
    element.addEventListener("beforeinput", beforeInputListener, true);
    element.addEventListener("input", inputListener, true);
    inputListeners.set(protyle, {element, beforeInputListener, inputListener});
};

const removeInputListeners = (protyle: IProtyle) => {
    const item = inputListeners.get(protyle);
    if (!item) {
        return;
    }
    item.element.removeEventListener("beforeinput", item.beforeInputListener, true);
    item.element.removeEventListener("input", item.inputListener, true);
    inputListeners.delete(protyle);
};

const removeTrackedRange = (protyle: IProtyle, handle: ITrackedRangeHandle) => {
    const manager = trackedRanges.get(protyle);
    const state = manager?.get(handle);
    if (!state) {
        return;
    }
    manager.delete(handle);
    if (manager.size === 0) {
        trackedRanges.delete(protyle);
        removeInputListeners(protyle);
    }
    if (state.owner) {
        const handles = ownedHandles.get(state.owner);
        handles?.forEach(item => {
            if (item.protyle === protyle && item.handle === handle) {
                handles.delete(item);
            }
        });
        if (handles?.size === 0) {
            ownedHandles.delete(state.owner);
        }
    }
};

export const trackRange = (protyle: IProtyle, range: Range,
                           options: ITrackRangeOptions): ITrackedRangeHandle => {
    if (destroyedProtyles.has(protyle)) {
        throw new Error("Cannot track a range in a destroyed Protyle instance");
    }
    if (!options?.owner || !["function", "object"].includes(typeof options.owner)) {
        throw new TypeError("The tracked range owner is required");
    }
    if (options.affinity && !["after", "before"].includes(options.affinity)) {
        throw new TypeError("The tracked range affinity must be before or after");
    }
    if (unloadingPlugins.has(options.owner)) {
        throw new Error("Cannot track a range for an unloaded plugin");
    }
    const rangeSnapshot = getRangeSnapshot(protyle, range);
    if (!rangeSnapshot) {
        throw new TypeError("The range must be inside one editable source block of this Protyle instance");
    }
    const targetTokens = rangeSnapshot.stream.tokens.slice(rangeSnapshot.start, rangeSnapshot.end);
    if (!range.collapsed && targetTokens.length === 0) {
        throw new TypeError("The tracked range must contain semantic content");
    }
    const handle = Object.freeze({id: `tracked-range-${++handleSequence}`});
    const trackedRange = range.cloneRange();
    const state: ITrackedRangeState = {
        range: trackedRange,
        startContainer: trackedRange.startContainer,
        endContainer: trackedRange.endContainer,
        exactTarget: getExactlySelectedElement(trackedRange),
        collapsed: trackedRange.collapsed,
        affinity: options.affinity || "before",
        targetTokens,
        tokens: rangeSnapshot.stream.tokens,
        start: rangeSnapshot.start,
        end: rangeSnapshot.end,
        sourceBlockID: rangeSnapshot.snapshot.block.getAttribute("data-node-id") || "",
        sourceAncestorIDs: getAncestorBlockIDs(protyle.wysiwyg.element, rangeSnapshot.snapshot.block),
        rootIDs: rangeSnapshot.stream.roots.map(root => root.getAttribute("data-node-id") || "").filter(Boolean),
        rootBlockIDs: getRootBlockIDs(rangeSnapshot.stream.roots),
        syncedBlockIDs: getRootBlockIDs(rangeSnapshot.stream.roots),
        sourceLineageIDs: new Set([rangeSnapshot.snapshot.block.getAttribute("data-node-id") || ""]),
        sourceTransitions: new Map(),
        lineageIDs: new Set([
            ...getAncestorBlockIDs(protyle.wysiwyg.element, rangeSnapshot.snapshot.block),
            ...rangeSnapshot.stream.roots.map(root => root.getAttribute("data-node-id") || "").filter(Boolean),
        ]),
        knownBlockIDs: getRootBlockIDs([protyle.wysiwyg.element]),
        owner: options.owner,
        invalid: false,
        editEvidence: new Set(),
    };
    getManager(protyle).set(handle, state);
    ensureInputListeners(protyle);
    if (state.owner) {
        let handles = ownedHandles.get(state.owner);
        if (!handles) {
            handles = new Set();
            ownedHandles.set(state.owner, handles);
        }
        handles.add({protyle, handle});
    }
    return handle;
};

export const resolveTrackedRange = (protyle: IProtyle, handle: ITrackedRangeHandle): TTrackedRangeResult => {
    const state = trackedRanges.get(protyle)?.get(handle);
    if (!state) {
        return {status: "invalid"};
    }
    const range = resolveState(protyle, state);
    if (!range) {
        removeTrackedRange(protyle, handle);
        return {status: "invalid"};
    }
    return {status: "resolved", range: range.cloneRange()};
};

export const releaseTrackedRange = (protyle: IProtyle, handle: ITrackedRangeHandle) => {
    removeTrackedRange(protyle, handle);
};

export const syncTrackedRanges = (protyle: IProtyle, operations: IOperation[],
                                  insertion?: ITrackedRangeInsertion) => {
    const manager = trackedRanges.get(protyle);
    if (!manager || manager.size === 0 || operations.length === 0) {
        return;
    }
    manager.forEach((state, handle) => {
        if (state.invalid) {
            removeTrackedRange(protyle, handle);
            return;
        }
        const pendingInsertionData = state.pendingInsertion && trackedRangeInsertions.get(state.pendingInsertion);
        const hasActivePendingInsertion = pendingInsertionData && state.editEvidence.has(pendingInsertionData.evidence);
        if (hasActivePendingInsertion && state.pendingInsertion !== insertion) {
            rememberOperationReferences(state, operations);
            return;
        }
        const relatedIDs = getRelatedOperationIDs(state, operations);
        if (!relatedIDs) {
            rememberOperationBlockIDs(state, operations);
            return;
        }
        const editEvidence = Array.from(state.editEvidence)
            .filter(evidence => !evidence.insertion || evidence.insertion === insertion);
        const applyAffinity = editEvidence.some(evidence => evidence.applyAffinity);
        const trustLiveRange = !applyAffinity && editEvidence.some(evidence => evidence.trustLiveRange);
        editEvidence.forEach(evidence => state.editEvidence.delete(evidence));
        state.provisionalInput = undefined;
        const roots = getRootsForIDs(protyle.wysiwyg.element, relatedIDs);
        const introducedSourceIDs = getIntroducedBlockIDs(state, operations, relatedIDs);
        const restoredSourceIDs = getRestoredSourceIDs(state, operations, relatedIDs);
        const exactRange = resolveExactTarget(protyle, state);
        if (state.invalid) {
            removeTrackedRange(protyle, handle);
            return;
        }
        if (exactRange) {
            state.syncedBlockIDs = getRootBlockIDs(roots);
            rememberOperationBlockIDs(state, operations);
            return;
        }
        const liveRange = resolveLiveRange(protyle, state);
        if (liveRange) {
            state.syncedBlockIDs = getRootBlockIDs(roots);
            rememberOperationBlockIDs(state, operations);
            return;
        }
        rememberOperationBlockIDs(state, operations);
        if (roots.length === 0) {
            removeTrackedRange(protyle, handle);
            return;
        }
        const stream = createRootStream(roots);
        let mappedRange: ITrackedTokenRange | undefined;
        if (state.collapsed) {
            const boundaryCandidates = getTrackedTokenBoundaryCandidates(state.tokens, stream.tokens, state.start);
            const hasAffinityEvidence = applyAffinity;
            mappedRange = mapTrackedTokenRange(state.tokens, stream.tokens, {start: state.start, end: state.end},
                true, state.affinity, hasAffinityEvidence);
            const liveRange = (!hasAffinityEvidence || trustLiveRange) && getLiveRange(protyle, state, true);
            const liveSnapshot = liveRange && getRangeSnapshotFromStream(stream, liveRange);
            const liveMatchesMapping = liveSnapshot && (trustLiveRange || (mappedRange ?
                liveSnapshot.start === mappedRange.start && liveSnapshot.end === mappedRange.end :
                hasOverlappingTrackedTokenContext(state.tokens, stream.tokens) &&
                boundaryCandidates.length === 1 && boundaryCandidates.includes(liveSnapshot.start) &&
                liveSnapshot.start === liveSnapshot.end));
            if (liveRange && liveSnapshot && liveMatchesMapping &&
                updateState(protyle, state, liveRange, liveSnapshot)) {
                state.syncedBlockIDs = getRootBlockIDs(stream.roots);
                return;
            }
        }
        if (mapStateToStream(protyle, state, stream, introducedSourceIDs, restoredSourceIDs, mappedRange)) {
            state.syncedBlockIDs = getRootBlockIDs(stream.roots);
        } else {
            removeTrackedRange(protyle, handle);
        }
    });
};

export const invalidateTrackedRanges = (protyle: IProtyle) => {
    Array.from(trackedRanges.get(protyle)?.keys() || []).forEach(handle => removeTrackedRange(protyle, handle));
};

export const invalidateTrackedRangesByOperations = (protyle: IProtyle, operations: IOperation[]) => {
    const manager = trackedRanges.get(protyle);
    if (!manager || manager.size === 0 || operations.length === 0) {
        return;
    }
    if (operations.some(operation => operation.id === protyle.block.rootID &&
        ["delete", "update"].includes(operation.action))) {
        invalidateTrackedRanges(protyle);
        return;
    }
    manager.forEach((state, handle) => {
        if (!state.invalid && getRelatedOperationIDs(state, operations)) {
            removeTrackedRange(protyle, handle);
        }
    });
};

export const invalidateTrackedRangesInElement = (protyle: IProtyle, element: Element) => {
    const manager = trackedRanges.get(protyle);
    if (!manager || manager.size === 0) {
        return;
    }
    const ids = new Set<string>();
    const elementID = element.getAttribute("data-node-id");
    if (elementID) {
        ids.add(elementID);
    }
    element.querySelectorAll<HTMLElement>("[data-node-id]").forEach(block => {
        const id = block.getAttribute("data-node-id");
        if (id) {
            ids.add(id);
        }
    });
    manager.forEach((state, handle) => {
        if (state.invalid) {
            removeTrackedRange(protyle, handle);
            return;
        }
        if (element.contains(state.startContainer) || element.contains(state.endContainer) ||
            (state.exactTarget && element.contains(state.exactTarget)) ||
            [...state.sourceAncestorIDs, ...state.rootIDs].some(id => ids.has(id))) {
            removeTrackedRange(protyle, handle);
        }
    });
};

export const destroyTrackedRanges = (protyle: IProtyle) => {
    destroyedProtyles.add(protyle);
    const handles = Array.from(trackedRanges.get(protyle)?.keys() || []);
    handles.forEach(handle => releaseTrackedRange(protyle, handle));
    trackedRanges.delete(protyle);
};

export const releaseTrackedRangesByPlugin = (plugin: Plugin) => {
    unloadingPlugins.add(plugin);
    Array.from(ownedHandles.get(plugin) || []).forEach(item => releaseTrackedRange(item.protyle, item.handle));
    ownedHandles.delete(plugin);
};
