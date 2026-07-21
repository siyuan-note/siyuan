const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10D00}-\u{10D3F}\u{1E900}-\u{1E95F}]/u;
const LETTER_RE = /\p{Letter}/u;

const RTL_RATIO_THRESHOLD = 0.35;
const AUTO_DIRECTION_TYPES = new Set(["NodeParagraph", "NodeHeading", "NodeListItem"]);
const SKIP_TEXT_SELECTOR = '[data-type~="code"], [data-type~="kbd"], [data-type~="inline-math"], code, pre, kbd, samp';
const SCOPE_ATTRIBUTE = "data-auto-text-direction-scope";

type TAutoTextDirection = "rtl" | "ltr" | "neutral";
type TResolvedTextDirection = Exclude<TAutoTextDirection, "neutral">;

interface IAutoDirectionRuntime {
    protyle: IProtyle;
    scope: string;
    styleElement: HTMLStyleElement;
    observer: MutationObserver;
    directions: Map<string, TResolvedTextDirection>;
    queue: Set<HTMLElement>;
    stylesDirty: boolean;
    frame?: number;
}

const runtimes = new WeakMap<HTMLElement, IAutoDirectionRuntime>();
let scopeSeed = 0;

export const classifyTextDirection = (value: string): TAutoTextDirection => {
    const text = typeof value === "string" ? value.normalize("NFKC") : "";
    let rtlCount = 0;
    let ltrCount = 0;

    for (const character of text) {
        if (!LETTER_RE.test(character)) {
            continue;
        }
        if (RTL_RE.test(character)) {
            rtlCount++;
        } else {
            ltrCount++;
        }
    }

    const strongCount = rtlCount + ltrCount;
    if (strongCount === 0) {
        return "neutral";
    }
    return rtlCount > 0 && rtlCount / strongCount >= RTL_RATIO_THRESHOLD ? "rtl" : "ltr";
};

const isAutoDirectionBlock = (block: Element): block is HTMLElement => {
    const type = block.getAttribute("data-type");
    return !!type && AUTO_DIRECTION_TYPES.has(type);
};

const getDirectionTextRoot = (block: HTMLElement): Element | null => {
    if (block.getAttribute("data-type") === "NodeListItem") {
        return block.querySelector(':scope > [data-node-id] > [contenteditable="true"]');
    }
    return block.querySelector(':scope > [contenteditable="true"]');
};

const extractDirectionalText = (block: HTMLElement) => {
    const root = getDirectionTextRoot(block);
    if (!root) {
        return "";
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || parent.closest(SKIP_TEXT_SELECTOR)) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let text = "";
    let node: Node | null;
    while ((node = walker.nextNode())) {
        text += ` ${node.textContent || ""}`;
    }
    return text;
};

const renderStyles = (runtime: IAutoDirectionRuntime) => {
    const scopeSelector = `[${SCOPE_ATTRIBUTE}="${runtime.scope}"]`;
    const rules = [
        `${scopeSelector} .protyle-wysiwyg :is(${SKIP_TEXT_SELECTOR}) { direction: ltr; unicode-bidi: isolate; }`
    ];
    runtime.directions.forEach((direction, id) => {
        const selector = `${scopeSelector} .protyle-wysiwyg [data-node-id="${CSS.escape(id)}"]`;
        rules.push(`${selector} { direction: ${direction}; unicode-bidi: isolate; }`);
        if (direction === "rtl") {
            const autoListSelector = `${selector}.li:not([style*="direction"])`;
            rules.push(`${autoListSelector} > .protyle-action { right: 0; left: auto; direction: rtl; }`);
            rules.push(`${autoListSelector} > [data-node-id] { margin-right: 34px; margin-left: 0; }`);
            rules.push(`${autoListSelector}::before { right: 17px; left: auto; }`);
        }
    });
    runtime.styleElement.textContent = rules.join("\n");
};

const updateBlockDirection = (runtime: IAutoDirectionRuntime, block: HTMLElement, deferRender = false) => {
    const id = block.getAttribute("data-node-id");
    if (!id || !isAutoDirectionBlock(block)) {
        return false;
    }

    const direction = classifyTextDirection(extractDirectionalText(block));
    const previous = runtime.directions.get(id);
    if (direction === "neutral") {
        runtime.directions.delete(id);
    } else {
        runtime.directions.set(id, direction);
    }

    const changed = previous !== runtime.directions.get(id);
    if (changed && !deferRender) {
        renderStyles(runtime);
    }
    return changed;
};

const queueBlockAndParents = (runtime: IAutoDirectionRuntime, element: Element | null) => {
    let block = element?.closest("[data-node-id]") as HTMLElement | null;
    while (block && runtime.protyle.wysiwyg.element.contains(block)) {
        if (isAutoDirectionBlock(block)) {
            runtime.queue.add(block);
        }
        block = block.parentElement?.closest("[data-node-id]") as HTMLElement | null;
    }
};

const queueTree = (runtime: IAutoDirectionRuntime, element: Element) => {
    queueBlockAndParents(runtime, element);
    element.querySelectorAll<HTMLElement>("[data-node-id]").forEach((block) => {
        if (isAutoDirectionBlock(block)) {
            runtime.queue.add(block);
        }
    });
};

const removeTree = (runtime: IAutoDirectionRuntime, element: Element) => {
    const id = element.getAttribute("data-node-id");
    if (id && runtime.directions.delete(id)) {
        runtime.stylesDirty = true;
    }
    element.querySelectorAll<HTMLElement>("[data-node-id]").forEach((block) => {
        const childId = block.getAttribute("data-node-id");
        if (childId && runtime.directions.delete(childId)) {
            runtime.stylesDirty = true;
        }
    });
};

const scheduleFlush = (runtime: IAutoDirectionRuntime) => {
    if (runtime.frame !== undefined) {
        return;
    }
    runtime.frame = requestAnimationFrame(() => {
        runtime.frame = undefined;
        let stylesChanged = runtime.stylesDirty;
        runtime.stylesDirty = false;
        runtime.queue.forEach((block) => {
            if (block.isConnected && updateBlockDirection(runtime, block, true)) {
                stylesChanged = true;
            }
        });
        runtime.queue.clear();
        if (stylesChanged) {
            renderStyles(runtime);
        }
    });
};

const scanEditor = (runtime: IAutoDirectionRuntime) => {
    const activeIds = new Set<string>();
    runtime.protyle.wysiwyg.element.querySelectorAll<HTMLElement>("[data-node-id]").forEach((block) => {
        if (!isAutoDirectionBlock(block)) {
            return;
        }
        const id = block.getAttribute("data-node-id");
        if (id) {
            activeIds.add(id);
        }
        updateBlockDirection(runtime, block, true);
    });
    runtime.directions.forEach((_direction, id) => {
        if (!activeIds.has(id)) {
            runtime.directions.delete(id);
        }
    });
    renderStyles(runtime);
};

const startAutoDirectionRuntime = (protyle: IProtyle) => {
    const existing = runtimes.get(protyle.wysiwyg.element);
    if (existing) {
        scanEditor(existing);
        return;
    }

    const scope = String(++scopeSeed);
    protyle.element.setAttribute(SCOPE_ATTRIBUTE, scope);
    const styleElement = document.createElement("style");
    styleElement.dataset.autoTextDirection = "true";
    protyle.element.appendChild(styleElement);

    const runtime = {} as IAutoDirectionRuntime;
    runtime.protyle = protyle;
    runtime.scope = scope;
    runtime.styleElement = styleElement;
    runtime.directions = new Map();
    runtime.queue = new Set();
    runtime.stylesDirty = false;
    runtime.observer = new MutationObserver((mutations) => {
        let shouldFlush = false;
        mutations.forEach((mutation) => {
            if (mutation.type === "characterData") {
                queueBlockAndParents(runtime, mutation.target.parentElement);
                shouldFlush = true;
                return;
            }
            if (mutation.type === "attributes") {
                queueBlockAndParents(runtime, mutation.target as Element);
                shouldFlush = true;
                return;
            }
            queueBlockAndParents(runtime, mutation.target as Element);
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    queueBlockAndParents(runtime, node.parentElement);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    queueTree(runtime, node as Element);
                }
            });
            mutation.removedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    removeTree(runtime, node as Element);
                }
            });
            shouldFlush = true;
        });
        if (shouldFlush) {
            scheduleFlush(runtime);
        }
    });
    runtime.observer.observe(protyle.wysiwyg.element, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "data-type"]
    });
    runtimes.set(protyle.wysiwyg.element, runtime);
    scanEditor(runtime);
};

const stopAutoDirectionRuntime = (protyle: IProtyle) => {
    const runtime = runtimes.get(protyle.wysiwyg.element);
    if (!runtime) {
        return;
    }
    runtime.observer.disconnect();
    if (runtime.frame !== undefined) {
        cancelAnimationFrame(runtime.frame);
    }
    runtime.styleElement.remove();
    protyle.element.removeAttribute(SCOPE_ATTRIBUTE);
    runtimes.delete(protyle.wysiwyg.element);
};

export const destroyAutoDirectionRuntime = (protyle: IProtyle) => {
    stopAutoDirectionRuntime(protyle);
};

export const syncAutoDirectionRuntime = (protyle: IProtyle) => {
    if (window.siyuan?.config?.editor?.autoTextDirection && !window.siyuan.config.editor.rtl) {
        startAutoDirectionRuntime(protyle);
    } else {
        stopAutoDirectionRuntime(protyle);
    }
};
