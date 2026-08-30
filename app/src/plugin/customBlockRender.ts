export interface ICustomBlockRenderOptions {
    element: HTMLElement;
    content: string;
    setContent: (content: string) => boolean;
}

export type TCustomBlockRender = (options: ICustomBlockRenderOptions) => void | (() => void);

interface ICustomBlockRootContext {
    disabled: () => boolean;
    observer?: MutationObserver;
    ready: boolean;
    update: (element: HTMLElement, oldHTML: string) => void;
}

interface ICustomBlockRenderState {
    content: string;
    dispose?: () => void;
    info: string;
    render?: TCustomBlockRender;
    root?: HTMLElement;
}

const rootContexts = new WeakMap<HTMLElement, ICustomBlockRootContext>();
const registeredRoots = new Set<HTMLElement>();
const renderStates = new WeakMap<HTMLElement, ICustomBlockRenderState>();
const activePlugins = new Set<string>();
const isolatedEventTypes = [
    "beforeinput", "input", "keydown", "keyup", "compositionstart", "compositionupdate", "compositionend",
    "copy", "cut", "paste", "click", "dblclick", "contextmenu", "mousedown", "mousemove", "mouseup",
    "pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel",
    "dragstart", "dragenter",
    "dragleave", "dragover", "drop", "dragend",
    "focusout", "mousewheel", "wheel",
];

export const encodeCustomBlockInfo = (pluginName: string, blockType: string) =>
    `${encodeURIComponent(pluginName)}/${encodeURIComponent(blockType)}`;

export const decodeCustomBlockInfo = (info: string): { pluginName: string, blockType: string } | undefined => {
    const separator = info.indexOf("/");
    if (separator < 1 || separator !== info.lastIndexOf("/") || separator === info.length - 1) {
        return;
    }
    try {
        const pluginName = decodeURIComponent(info.slice(0, separator));
        const blockType = decodeURIComponent(info.slice(separator + 1));
        if (pluginName && blockType) {
            return {pluginName, blockType};
        }
    } catch {
        return;
    }
};

export const isCustomBlockContentValid = (content: string) =>
    !content.split(/\r\n|\r|\n/).some(line => line.replaceAll("‸", "").trim() === ";;;");

const isolateEditorEvents = (element: HTMLElement) => {
    isolatedEventTypes.forEach(type => element.addEventListener(type, event => event.stopPropagation()));
};

const getContentElement = (element: HTMLElement) => {
    let contentElement = Array.from(element.children).find(item =>
        item.classList.contains("custom-block__content")) as HTMLElement | undefined;
    if (!contentElement) {
        contentElement = element.ownerDocument.createElement("div");
        contentElement.className = "custom-block__content";
        const attrElement = Array.from(element.children).find(item => item.classList.contains("protyle-attr"));
        element.insertBefore(contentElement, attrElement || null);
    }
    return contentElement;
};

const replaceContentElement = (element: HTMLElement) => {
    const attrElement = Array.from(element.children).find(item => item.classList.contains("protyle-attr"));
    Array.from(element.children).forEach(item => {
        if (item !== attrElement) {
            item.remove();
        }
    });
    const contentElement = element.ownerDocument.createElement("div");
    contentElement.className = "custom-block__content";
    element.insertBefore(contentElement, attrElement || null);
    return contentElement;
};

const disposeCustomBlock = (element: HTMLElement) => {
    const state = renderStates.get(element);
    renderStates.delete(element);
    if (!state?.dispose) {
        return;
    }
    disposeRenderer(state.dispose);
};

const disposeRenderer = (dispose: () => void) => {
    try {
        dispose();
    } catch (error) {
        console.error("Custom block cleanup failed:", error);
    }
};

const renderFallback = (element: HTMLElement, content: string) => {
    const contentElement = replaceContentElement(element);
    const preElement = element.ownerDocument.createElement("pre");
    preElement.textContent = content;
    contentElement.append(preElement);
};

const collectCustomBlocks = (element: Element) => {
    const blocks: HTMLElement[] = [];
    if (element.getAttribute("data-type") === "NodeCustomBlock") {
        blocks.push(element as HTMLElement);
    }
    element.querySelectorAll<HTMLElement>('[data-type="NodeCustomBlock"]').forEach(item => blocks.push(item));
    return blocks;
};

const renderCustomBlock = (element: HTMLElement, force = false) => {
    const rootElement = element.closest<HTMLElement>(".protyle-wysiwyg");
    const context = rootElement && rootContexts.get(rootElement);
    const info = element.getAttribute("data-info") || "";
    const content = element.getAttribute("data-content") || "";
    const decoded = decodeCustomBlockInfo(info);
    const plugin = decoded && activePlugins.has(decoded.pluginName)
        ? window.siyuan.ws?.app?.plugins.find(item => item.name === decoded.pluginName)
        : undefined;
    const render = decoded ? plugin?.customBlockRenders[decoded.blockType]?.render : undefined;
    const state = renderStates.get(element);
    if (!force && state?.info === info && state.content === content && state.render === render &&
        state.root === rootElement) {
        return;
    }

    disposeCustomBlock(element);
    renderFallback(element, content);
    if (!context || !render) {
        renderStates.set(element, {content, info, root: rootElement || undefined});
        return;
    }

    const nextState: ICustomBlockRenderState = {content, info, render, root: rootElement};
    renderStates.set(element, nextState);
    const contentElement = getContentElement(element);
    contentElement.replaceChildren();
    isolateEditorEvents(contentElement);
    let pendingContent = content;
    let contentUpdateQueued = false;
    let rendering = true;
    const isCurrentRoot = () => element.closest<HTMLElement>(".protyle-wysiwyg") === rootElement &&
        rootContexts.get(rootElement) === context;
    const setContent = (newContent: string) => {
        if (typeof newContent !== "string" || !isCustomBlockContentValid(newContent) || rendering ||
            !context.ready || context.disabled() || !element.isConnected || !isCurrentRoot() ||
            renderStates.get(element) !== nextState) {
            return false;
        }
        pendingContent = newContent;
        if (contentUpdateQueued) {
            return true;
        }
        contentUpdateQueued = true;
        queueMicrotask(() => {
            contentUpdateQueued = false;
            if (!context.ready || context.disabled() || !element.isConnected || !isCurrentRoot() ||
                renderStates.get(element) !== nextState) {
                return;
            }
            const currentContent = element.getAttribute("data-content") || "";
            if (currentContent === pendingContent) {
                return;
            }

            disposeCustomBlock(element);
            renderFallback(element, currentContent);
            const oldHTML = element.outerHTML;
            element.setAttribute("data-content", pendingContent);
            renderFallback(element, pendingContent);
            context.update(element, oldHTML);
            renderCustomBlock(element, true);
        });
        return true;
    };

    try {
        const dispose = render({element: contentElement, content, setContent});
        if (typeof dispose === "function") {
            if (renderStates.get(element) === nextState) {
                nextState.dispose = dispose;
            } else {
                disposeRenderer(dispose);
            }
        }
    } catch (error) {
        console.error(`Custom block renderer ${info} failed:`, error);
        renderFallback(element, content);
        if (renderStates.get(element) === nextState) {
            renderStates.set(element, {content, info, render, root: rootElement});
        }
    } finally {
        rendering = false;
    }
};

export const customBlockRender = (element: Element, force = false) => {
    const scopeRoot = element.classList.contains("protyle-wysiwyg")
        ? element as HTMLElement
        : element.closest<HTMLElement>(".protyle-wysiwyg");
    if (!scopeRoot || !rootContexts.has(scopeRoot)) {
        return;
    }
    flushCustomBlockMutations();
    collectCustomBlocks(element).forEach(item => {
        const parentCustomBlock = item.parentElement?.closest<HTMLElement>('[data-type="NodeCustomBlock"]');
        if (item.closest(".protyle-wysiwyg") === scopeRoot &&
            (!parentCustomBlock || parentCustomBlock.closest(".protyle-wysiwyg") !== scopeRoot)) {
            renderCustomBlock(item, force);
        }
    });
};

const disposeRemovedCustomBlocks = (node: Node, rootElement: HTMLElement) => {
    if (!(node instanceof Element) || rootElement.contains(node)) {
        return;
    }
    collectCustomBlocks(node).forEach(item => {
        if (renderStates.get(item)?.root === rootElement) {
            disposeCustomBlock(item);
        }
    });
};

const refreshCustomBlocksInElement = (element: Element) => {
    collectCustomBlocks(element).forEach(item => {
        const rootElement = item.closest<HTMLElement>(".protyle-wysiwyg");
        const parentCustomBlock = item.parentElement?.closest<HTMLElement>('[data-type="NodeCustomBlock"]');
        if (rootElement && rootContexts.has(rootElement) && renderStates.get(item)?.root !== rootElement &&
            (!parentCustomBlock || parentCustomBlock.closest(".protyle-wysiwyg") !== rootElement)) {
            renderCustomBlock(item, true);
        }
    });
};

const flushCustomBlockMutations = () => {
    const pendingRecords: {records: MutationRecord[], rootElement: HTMLElement}[] = [];
    registeredRoots.forEach(rootElement => {
        const records = rootContexts.get(rootElement)?.observer?.takeRecords() || [];
        if (records.length > 0) {
            pendingRecords.push({records, rootElement});
        }
    });
    pendingRecords.forEach(item => item.records.forEach(record => record.removedNodes.forEach(node =>
        disposeRemovedCustomBlocks(node, item.rootElement))));
    pendingRecords.forEach(item => item.records.forEach(record => record.addedNodes.forEach(node => {
        if (node instanceof Element) {
            refreshCustomBlocksInElement(node);
        }
    })));
};

export const registerCustomBlockRoot = (rootElement: HTMLElement, context: {
    disabled: () => boolean;
    update: (element: HTMLElement, oldHTML: string) => void;
}) => {
    unregisterCustomBlockRoot(rootElement);
    const rootContext: ICustomBlockRootContext = {...context, ready: false};
    if (typeof MutationObserver !== "undefined") {
        rootContext.observer = new MutationObserver(records => {
            records.forEach(record => record.removedNodes.forEach(node =>
                disposeRemovedCustomBlocks(node, rootElement)));
            const addedNodes = records.flatMap(record => Array.from(record.addedNodes));
            if (addedNodes.length > 0) {
                queueMicrotask(() => addedNodes.forEach(node => {
                    if (node instanceof Element) {
                        refreshCustomBlocksInElement(node);
                    }
                }));
            }
        });
        rootContext.observer.observe(rootElement, {childList: true, subtree: true});
    }
    rootContexts.set(rootElement, rootContext);
    registeredRoots.add(rootElement);
};

export const setCustomBlockRootReady = (rootElement: HTMLElement, ready: boolean) => {
    const context = rootContexts.get(rootElement);
    if (context) {
        context.ready = ready;
    }
};

export const unregisterCustomBlockRoot = (rootElement: HTMLElement) => {
    const observer = rootContexts.get(rootElement)?.observer;
    observer?.takeRecords().forEach(record => record.removedNodes.forEach(node =>
        disposeRemovedCustomBlocks(node, rootElement)));
    observer?.disconnect();
    rootContexts.delete(rootElement);
    registeredRoots.delete(rootElement);
    collectCustomBlocks(rootElement).forEach(disposeCustomBlock);
};

export const disposeCustomBlocksInElement = (element: Element) => {
    collectCustomBlocks(element).forEach(disposeCustomBlock);
};

const getPluginBlocks = (pluginName: string) => {
    if (typeof document === "undefined") {
        return [];
    }
    return Array.from(document.querySelectorAll<HTMLElement>('[data-type="NodeCustomBlock"]')).filter(item => {
        const rootElement = item.closest<HTMLElement>(".protyle-wysiwyg");
        const parentCustomBlock = item.parentElement?.closest<HTMLElement>('[data-type="NodeCustomBlock"]');
        return !!rootElement && rootContexts.has(rootElement) &&
            (!parentCustomBlock || parentCustomBlock.closest(".protyle-wysiwyg") !== rootElement) &&
            decodeCustomBlockInfo(item.getAttribute("data-info") || "")?.pluginName === pluginName;
    });
};

export const activateCustomBlockPlugin = (pluginName: string) => {
    activePlugins.add(pluginName);
    getPluginBlocks(pluginName).forEach(item => renderCustomBlock(item, true));
};

export const deactivateCustomBlockPlugin = (pluginName: string) => {
    activePlugins.delete(pluginName);
    getPluginBlocks(pluginName).forEach(item => {
        const content = item.getAttribute("data-content") || "";
        const rootElement = item.closest<HTMLElement>(".protyle-wysiwyg");
        disposeCustomBlock(item);
        renderFallback(item, content);
        renderStates.set(item, {content, info: item.getAttribute("data-info") || "", root: rootElement || undefined});
    });
};
