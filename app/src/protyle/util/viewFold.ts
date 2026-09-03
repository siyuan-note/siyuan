import {fetchSyncPost} from "../../util/fetch";
import {processRender} from "./processCode";
import {highlightRender} from "../render/highlightRender";
import {avRender} from "../render/av/render";
import {blockRender} from "../render/blockRender";
import {disabledProtyle} from "./onGet";
import {
    clearViewFoldDefaultsForOccurrence,
    clearViewFoldOccurrenceRuntimeState,
} from "./viewFoldRuntimeState";
import {normalizeHTMLAssetIFrameBlockDOM} from "../../asset/html";

const VIEW_FOLD_SOURCE = "data-view-fold-source";
const VIEW_FOLD_VALUE = "data-view-fold";
const VIEW_FOLD_DEFAULT = "data-view-fold-default";
const VIEW_FOLD_HIDDEN = "data-view-fold-hidden";
const VIEW_FOLD_HIDDEN_SOURCE = "data-view-fold-hidden-source";
const VIEW_HEADING_OWNER = "data-view-heading-owner";
const VIEW_HEADING_LOADED = "data-view-heading-loaded";

export interface IViewFoldStateStore {
    get<T>(key: string): T | undefined,
    set<T>(key: string, value: T): void,
    remove(key: string): void,
}

export interface IViewFoldContext {
    store: IViewFoldStateStore,
    pane: string,
    rootID: string,
    generation?: number,
    defaults?: Map<string, boolean>,
    transient?: Map<string, boolean>,
    getOccurrenceID?: (element: Element) => string,
    getOccurrenceRevision?: (element: Element) => string,
}

const viewFoldContexts = new WeakMap<IProtyle, IViewFoldContext>();
const headingRequestVersions = new WeakMap<Element, number>();
interface IHeadingChildrenRequest {
    context: IViewFoldContext,
    contextGeneration: number,
    occurrenceID: string,
    revision: string,
    stateKey: string,
    requestVersion: number,
    promise: Promise<void>,
}
const headingChildrenRequests = new WeakMap<Element, IHeadingChildrenRequest>();

const encodeKeyPart = (value: string) => encodeURIComponent(value || "");

export const getViewFoldOccurrenceID = (protyle: IProtyle, element: Element) => {
    return viewFoldContexts.get(protyle)?.getOccurrenceID?.(element) || "";
};

const getViewFoldStateKeyByIdentity = (context: IViewFoldContext, occurrenceID: string, blockID: string) => {
    if (!blockID) {
        return "";
    }
    return [
        "fold",
        encodeKeyPart(context.pane),
        encodeKeyPart(context.rootID),
        encodeKeyPart(occurrenceID),
        encodeKeyPart(blockID),
    ].join(":");
};

export const getViewFoldStateKey = (protyle: IProtyle, element: Element) => {
    const context = viewFoldContexts.get(protyle);
    const blockID = element.getAttribute("data-node-id");
    if (!context || !blockID) {
        return "";
    }
    return getViewFoldStateKeyByIdentity(context, getViewFoldOccurrenceID(protyle, element), blockID);
};

const getSourceFold = (element: Element) => {
    const source = element.getAttribute(VIEW_FOLD_SOURCE);
    return source === null ? element.getAttribute("fold") === "1" : source === "1";
};

const getHeadingLevel = (element: Element) => {
    const subtype = element.getAttribute("data-subtype") || "";
    return /^h[1-6]$/.test(subtype) ? Number(subtype.substring(1)) : 0;
};

const getHeadingChildren = (heading: Element) => {
    const level = getHeadingLevel(heading);
    const children: Element[] = [];
    let current = heading.nextElementSibling;
    while (current && !current.classList.contains("protyle-breadcrumb__bar")) {
        const currentLevel = getHeadingLevel(current);
        if (currentLevel > 0 && currentLevel <= level) {
            break;
        }
        children.push(current);
        current = current.nextElementSibling;
    }
    return children;
};

const setHeadingChildrenHidden = (heading: Element, hidden: boolean, token: string) => {
    getHeadingChildren(heading).forEach(child => {
        const tokens = new Set((child.getAttribute(VIEW_FOLD_HIDDEN) || "").split(" ").filter(Boolean));
        if (hidden) {
            if (!child.hasAttribute(VIEW_FOLD_HIDDEN_SOURCE)) {
                child.setAttribute(VIEW_FOLD_HIDDEN_SOURCE, child.classList.contains("fn__none") ? "1" : "0");
            }
            tokens.add(token);
            child.classList.add("fn__none");
        } else {
            tokens.delete(token);
            if (tokens.size === 0) {
                if (child.getAttribute(VIEW_FOLD_HIDDEN_SOURCE) !== "1") {
                    child.classList.remove("fn__none");
                }
                child.removeAttribute(VIEW_FOLD_HIDDEN_SOURCE);
            }
        }
        if (tokens.size === 0) {
            child.removeAttribute(VIEW_FOLD_HIDDEN);
        } else {
            child.setAttribute(VIEW_FOLD_HIDDEN, Array.from(tokens).join(" "));
        }
    });
};

const getHeadingToken = (protyle: IProtyle, heading: Element) => {
    return encodeKeyPart(getViewFoldStateKey(protyle, heading) || heading.getAttribute("data-node-id"));
};

const renderHeadingChildren = (protyle: IProtyle, heading: Element, children: Element[]) => {
    if (children.length === 0) {
        return;
    }
    const token = getHeadingToken(protyle, heading);
    const fragment = document.createDocumentFragment();
    children.forEach(child => {
        child.removeAttribute("parent-heading");
        child.setAttribute(VIEW_HEADING_OWNER, token);
        fragment.appendChild(child);
    });
    heading.after(fragment);
    children.forEach(child => {
        processRender(child);
        highlightRender(child);
        avRender(child, protyle);
        blockRender(protyle, child);
    });
    if (protyle.disabled) {
        disabledProtyle(protyle);
    }
};

const ensureHeadingChildren = async (protyle: IProtyle, heading: Element, stateKey: string, force = false) => {
    if (getHeadingChildren(heading).length > 0 || heading.getAttribute(VIEW_HEADING_LOADED) === "1" ||
        (!force && getSourceFold(heading) === false)) {
        return;
    }
    const context = viewFoldContexts.get(protyle);
    if (!context) {
        return;
    }
    const contextGeneration = context.generation || 0;
    const occurrenceID = getViewFoldOccurrenceID(protyle, heading);
    const revision = context.getOccurrenceRevision?.(heading) || "";
    const currentRequestVersion = headingRequestVersions.get(heading) || 0;
    const inFlight = headingChildrenRequests.get(heading);
    if (inFlight?.context === context && inFlight.occurrenceID === occurrenceID && inFlight.revision === revision &&
        inFlight.stateKey === stateKey && inFlight.requestVersion === currentRequestVersion) {
        await inFlight.promise;
        if (headingChildrenRequests.get(heading) === inFlight) {
            headingChildrenRequests.delete(heading);
        }
        if (inFlight.contextGeneration === contextGeneration) {
            return;
        }
        if (viewFoldContexts.get(protyle) === context && heading.isConnected &&
            getViewFoldStateKey(protyle, heading) === stateKey && heading.getAttribute(VIEW_FOLD_VALUE) === "0") {
            await ensureHeadingChildren(protyle, heading, stateKey, force);
        }
        return;
    }

    const requestVersion = currentRequestVersion + 1;
    headingRequestVersions.set(heading, requestVersion);
    const promise = (async () => {
        let response: IWebSocketData;
        try {
            response = await fetchSyncPost("/api/block/getHeadingChildrenDOM", {
                id: heading.getAttribute("data-node-id"),
                removeFoldAttr: false,
            });
        } catch (error) {
            console.error(error);
            return;
        }
        if (viewFoldContexts.get(protyle) !== context || context.generation !== contextGeneration ||
            !heading.isConnected || headingRequestVersions.get(heading) !== requestVersion ||
            getViewFoldOccurrenceID(protyle, heading) !== occurrenceID ||
            getViewFoldStateKey(protyle, heading) !== stateKey ||
            (context.getOccurrenceRevision?.(heading) || "") !== revision ||
            heading.getAttribute(VIEW_FOLD_VALUE) !== "0") {
            return;
        }
        if (response.code !== 0 || typeof response.data !== "string") {
            return;
        }
        const template = document.createElement("template");
        template.innerHTML = normalizeHTMLAssetIFrameBlockDOM(response.data);
        const elements = Array.from(template.content.children);
        if (!elements[0] || elements[0].getAttribute("data-node-id") !== heading.getAttribute("data-node-id")) {
            return;
        }
        heading.setAttribute(VIEW_HEADING_LOADED, "1");
        if (getHeadingChildren(heading).length > 0) {
            return;
        }
        const children = elements.slice(1);
        renderHeadingChildren(protyle, heading, children);
        const foldedHeadings: Element[] = [];
        children.forEach(element => {
            if (element.getAttribute("data-type") === "NodeHeading" && element.getAttribute("fold") === "1") {
                foldedHeadings.push(element);
            }
            element.querySelectorAll('[data-type="NodeHeading"][fold="1"]').forEach(item => foldedHeadings.push(item));
        });
        foldedHeadings.reverse().forEach(item => applyFold(protyle, item, true, true));
        await Promise.all([heading, ...children].map(element => applyViewFoldStates(protyle, element)));
    })();
    const request: IHeadingChildrenRequest = {
        context,
        contextGeneration,
        occurrenceID,
        revision,
        stateKey,
        requestVersion,
        promise,
    };
    headingChildrenRequests.set(heading, request);
    try {
        await promise;
    } finally {
        if (headingChildrenRequests.get(heading) === request) {
            headingChildrenRequests.delete(heading);
        }
    }
};

const applyFold = (protyle: IProtyle, element: Element, folded: boolean, sourceFold?: boolean) => {
    const source = sourceFold ?? getSourceFold(element);
    const previousFold = element.getAttribute(VIEW_FOLD_VALUE);
    const foldValue = folded ? "1" : "0";
    element.setAttribute(VIEW_FOLD_SOURCE, source ? "1" : "0");
    element.setAttribute(VIEW_FOLD_VALUE, foldValue);
    if (folded) {
        element.setAttribute("fold", "1");
    } else {
        element.removeAttribute("fold");
    }
    if (element.getAttribute("data-type") === "NodeHeading") {
        const token = getHeadingToken(protyle, element);
        setHeadingChildrenHidden(element, folded, token);
        if (previousFold !== foldValue) {
            headingRequestVersions.set(element, (headingRequestVersions.get(element) || 0) + 1);
        }
    }
};

export const markViewFoldDefault = (element: Element, folded: boolean) => {
    if (!element.hasAttribute(VIEW_FOLD_SOURCE)) {
        element.setAttribute(VIEW_FOLD_SOURCE, element.getAttribute("fold") === "1" ? "1" : "0");
    }
    element.setAttribute(VIEW_FOLD_DEFAULT, folded ? "1" : "0");
    element.setAttribute(VIEW_FOLD_VALUE, folded ? "1" : "0");
    element.toggleAttribute("fold", folded);
    if (folded) {
        element.setAttribute("fold", "1");
    }
};

export const hasViewFoldContext = (protyle: IProtyle) => viewFoldContexts.has(protyle);

export const registerViewFoldContext = (protyle: IProtyle, context: IViewFoldContext) => {
    viewFoldContexts.set(protyle, {
        ...context,
        generation: (viewFoldContexts.get(protyle)?.generation || 0) + 1,
        defaults: new Map<string, boolean>(),
        transient: new Map<string, boolean>(),
    });
    return applyViewFoldStates(protyle);
};

export const clearViewFoldDefaults = (protyle: IProtyle, occurrenceID: string) => {
    const context = viewFoldContexts.get(protyle);
    if (!context || !occurrenceID) {
        return;
    }
    clearViewFoldDefaultsForOccurrence(context, {
        pane: context.pane,
        rootID: context.rootID,
        occurrenceID,
    });
};

export const clearViewFoldOccurrenceState = (protyle: IProtyle, occurrenceID: string) => {
    const context = viewFoldContexts.get(protyle);
    if (!context || !occurrenceID) {
        return;
    }
    clearViewFoldOccurrenceRuntimeState(context, {
        pane: context.pane,
        rootID: context.rootID,
        occurrenceID,
    });
};

export const invalidateViewFoldRequests = (protyle: IProtyle) => {
    const context = viewFoldContexts.get(protyle);
    if (context) {
        context.generation = (context.generation || 0) + 1;
    }
};

export const unregisterViewFoldContext = (protyle: IProtyle) => {
    viewFoldContexts.delete(protyle);
};

export const setViewFoldState = (protyle: IProtyle, occurrenceID: string, blockID: string, folded: boolean) => {
    const context = viewFoldContexts.get(protyle);
    if (!context) {
        return false;
    }
    const stateKey = getViewFoldStateKeyByIdentity(context, occurrenceID, blockID);
    if (!stateKey) {
        return false;
    }
    context.store.set(stateKey, folded);
    context.transient?.delete(stateKey);
    return true;
};

export const setViewFold = (protyle: IProtyle, element: Element, folded: boolean, sourceFold?: boolean) => {
    const stateKey = getViewFoldStateKey(protyle, element);
    if (!stateKey || !setViewFoldState(protyle, getViewFoldOccurrenceID(protyle, element),
        element.getAttribute("data-node-id"), folded)) {
        return false;
    }
    applyFold(protyle, element, folded, sourceFold);
    if (!folded && element.getAttribute("data-type") === "NodeHeading") {
        void ensureHeadingChildren(protyle, element, stateKey, true).catch(error => console.error(error));
    }
    return true;
};

export const setViewFoldTransient = async (protyle: IProtyle, element: Element, folded: boolean,
                                           sourceFold?: boolean, loadHeadingChildren = true) => {
    const stateKey = getViewFoldStateKey(protyle, element);
    if (!viewFoldContexts.has(protyle) || !stateKey) {
        return;
    }
    viewFoldContexts.get(protyle)?.transient?.set(stateKey, folded);
    applyFold(protyle, element, folded, sourceFold);
    if (loadHeadingChildren && !folded && element.getAttribute("data-type") === "NodeHeading") {
        await ensureHeadingChildren(protyle, element, stateKey, true);
    }
};

export const applyViewFoldStates = async (protyle: IProtyle, scope?: ParentNode) => {
    const context = viewFoldContexts.get(protyle);
    if (!context) {
        return;
    }
    const root = scope || protyle.wysiwyg.element;
    const elements: Element[] = [];
    if (root instanceof Element && root.hasAttribute("data-node-id")) {
        elements.push(root);
    }
    root.querySelectorAll("[data-node-id][data-type]").forEach(element => elements.push(element));
    const headings: Promise<void>[] = [];
    elements.forEach(element => {
        const stateKey = getViewFoldStateKey(protyle, element);
        if (!stateKey) {
            return;
        }
        const transient = context.transient?.get(stateKey);
        const override = context.store.get<boolean>(stateKey);
        const defaultAttribute = element.getAttribute(VIEW_FOLD_DEFAULT);
        if (defaultAttribute !== null) {
            context.defaults?.set(stateKey, defaultAttribute === "1");
        }
        const defaultFold = defaultAttribute === null ? context.defaults?.get(stateKey) : defaultAttribute === "1";
        if (typeof transient !== "boolean" && typeof override !== "boolean" && typeof defaultFold !== "boolean") {
            return;
        }
        const folded = typeof transient === "boolean" ? transient :
            (typeof override === "boolean" ? override : defaultFold);
        applyFold(protyle, element, folded);
        if (!folded && element.getAttribute("data-type") === "NodeHeading") {
            headings.push(ensureHeadingChildren(protyle, element, stateKey, true));
        }
    });
    await Promise.all(headings);
};

const restoreViewFoldElement = (element: Element) => {
    const source = element.getAttribute(VIEW_FOLD_SOURCE);
    if (source !== null) {
        if (source === "1") {
            element.setAttribute("fold", "1");
        } else {
            element.removeAttribute("fold");
        }
    }
    const hiddenSource = element.getAttribute(VIEW_FOLD_HIDDEN_SOURCE);
    if (hiddenSource !== null) {
        element.classList.toggle("fn__none", hiddenSource === "1");
    }
    [VIEW_FOLD_SOURCE, VIEW_FOLD_VALUE, VIEW_FOLD_DEFAULT, VIEW_FOLD_HIDDEN,
        VIEW_FOLD_HIDDEN_SOURCE, VIEW_HEADING_OWNER, VIEW_HEADING_LOADED].forEach(attribute => element.removeAttribute(attribute));
};

export const sanitizeViewFoldHTML = (html: string) => {
    if (!html || !html.includes("data-view-")) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll(`[${VIEW_FOLD_SOURCE}], [${VIEW_FOLD_HIDDEN_SOURCE}], [${VIEW_FOLD_DEFAULT}], ` +
        `[${VIEW_HEADING_OWNER}], [${VIEW_HEADING_LOADED}]`).forEach(restoreViewFoldElement);
    return template.innerHTML;
};

const stripFoldAttribute = (operation: IOperation) => {
    if (operation.action === "setAttrs" && typeof operation.data === "string") {
        try {
            const attrs = JSON.parse(operation.data);
            if (!Object.prototype.hasOwnProperty.call(attrs, "fold")) {
                return operation;
            }
            delete attrs.fold;
            if (Object.keys(attrs).length === 0) {
                return undefined;
            }
            return {...operation, data: JSON.stringify(attrs)};
        } catch (error) {
            console.error(error);
            return operation;
        }
    }
    if (operation.action === "updateAttrs" && typeof operation.data === "object" && operation.data !== null) {
        const data = operation.data as {
            old?: Record<string, string>,
            new?: Record<string, string>,
            [key: string]: unknown,
        };
        const oldAttrs = {...data.old};
        const newAttrs = {...data.new};
        if (!Object.prototype.hasOwnProperty.call(oldAttrs, "fold") &&
            !Object.prototype.hasOwnProperty.call(newAttrs, "fold")) {
            return operation;
        }
        delete oldAttrs.fold;
        delete newAttrs.fold;
        const otherKeys = Object.keys(data).filter(key => key !== "old" && key !== "new");
        if (Object.keys(oldAttrs).length === 0 && Object.keys(newAttrs).length === 0 && otherKeys.length === 0) {
            return undefined;
        }
        return {...operation, data: {...data, old: oldAttrs, new: newAttrs}};
    }
    return operation;
};

const sanitizeOperations = (operations: IOperation[] = []) => operations.flatMap(operation => {
    if (operation.action === "foldHeading" || operation.action === "unfoldHeading") {
        return [];
    }
    const stripped = stripFoldAttribute(operation);
    if (!stripped) {
        return [];
    }
    if (["update", "insert", "append"].includes(stripped.action) && typeof stripped.data === "string") {
        return [{...stripped, data: sanitizeViewFoldHTML(stripped.data)}];
    }
    return [stripped];
});

const sanitizeOperationHTML = (operations: IOperation[] = []) => operations.map(operation => {
    if (["update", "insert", "append"].includes(operation.action) && typeof operation.data === "string") {
        return {...operation, data: sanitizeViewFoldHTML(operation.data)};
    }
    return operation;
});

const getFoldValue = (operation: IOperation) => {
    if (operation.action === "foldHeading") {
        return true;
    }
    if (operation.action === "unfoldHeading") {
        return false;
    }
    if (operation.action === "setAttrs" && typeof operation.data === "string") {
        try {
            const attrs = JSON.parse(operation.data);
            return Object.prototype.hasOwnProperty.call(attrs, "fold") ? attrs.fold === "1" : undefined;
        } catch (error) {
            console.error(error);
        }
    }
    if (operation.action === "updateAttrs" && typeof operation.data === "object" && operation.data !== null) {
        const data = operation.data as {old?: Record<string, string>, new?: Record<string, string>};
        if (Object.prototype.hasOwnProperty.call(data.old || {}, "fold") ||
            Object.prototype.hasOwnProperty.call(data.new || {}, "fold")) {
            return data.new?.fold === "1";
        }
    }
    return undefined;
};

export const prepareViewFoldTransaction = (protyle: IProtyle, doOperations: IOperation[], undoOperations?: IOperation[]) => {
    if (!hasViewFoldContext(protyle)) {
        return {
            doOperations: sanitizeOperationHTML(doOperations),
            undoOperations: undoOperations ? sanitizeOperationHTML(undoOperations) : undefined,
        };
    }
    return {
        doOperations: sanitizeOperations(doOperations),
        undoOperations: undoOperations ? sanitizeOperations(undoOperations) : undefined,
    };
};

export const handleViewFoldSourceOperation = (protyle: IProtyle, operation: IOperation) => {
    if (!hasViewFoldContext(protyle) || !operation.id) {
        return false;
    }
    const sourceFold = getFoldValue(operation);
    if (typeof sourceFold !== "boolean") {
        return false;
    }
    protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach(element => {
        const stateKey = getViewFoldStateKey(protyle, element);
        const context = viewFoldContexts.get(protyle);
        const transient = stateKey ? context?.transient?.get(stateKey) : undefined;
        const override = stateKey ? context?.store.get<boolean>(stateKey) : undefined;
        const defaultAttribute = element.getAttribute(VIEW_FOLD_DEFAULT);
        if (defaultAttribute !== null && stateKey) {
            context?.defaults?.set(stateKey, defaultAttribute === "1");
        }
        const defaultFold = defaultAttribute === null && stateKey ? context?.defaults?.get(stateKey) :
            defaultAttribute === "1";
        const effective = typeof transient === "boolean" ? transient :
            (typeof override === "boolean" ? override :
                (typeof defaultFold === "boolean" ? defaultFold : sourceFold));
        applyFold(protyle, element, effective, sourceFold);
        if (!effective && element.getAttribute("data-type") === "NodeHeading") {
            const key = getViewFoldStateKey(protyle, element);
            if (key) {
                void ensureHeadingChildren(protyle, element, key, true);
            }
        }
    });
    const stripped = stripFoldAttribute(operation);
    if (stripped) {
        operation.data = stripped.data;
        return operation.action === "foldHeading" || operation.action === "unfoldHeading";
    }
    return true;
};
