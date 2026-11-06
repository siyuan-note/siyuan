import {AVColumnVirtualScroll} from "./columnVirtualScroll";

interface IAVColumnWindowEntry {
    block: HTMLElement;
    scroll: HTMLElement;
    core: AVColumnVirtualScroll;
    document: IAVColumnWindowDocument;
    frame: number;
    suspensions: number;
    width: number;
    blockWidth: number;
    disposed: boolean;
}

interface IAVColumnWindowDocument {
    entries: Set<IAVColumnWindowEntry>;
    suspensions: Set<{root: HTMLElement; entries: Set<IAVColumnWindowEntry>}>;
    removals: MutationObserver;
    appearance: MutationObserver;
    resize?: ResizeObserver;
    onLoad: () => void;
    onResize: () => void;
}

const entries = new WeakMap<HTMLElement, IAVColumnWindowEntry>();
const documents = new WeakMap<Document, IAVColumnWindowDocument>();

const schedule = (entry: IAVColumnWindowEntry) => {
    if (entry.frame || entry.disposed) {
        return;
    }
    entry.frame = entry.block.ownerDocument.defaultView.requestAnimationFrame(() => {
        entry.frame = 0;
        if (!entry.disposed) {
            entry.core.update();
        }
    });
};

const onScroll = (event: Event) => {
    const scroll = event.currentTarget as HTMLElement;
    const block = scroll.closest<HTMLElement>('[data-av-type="table"]');
    const entry = entries.get(block);
    if (entry?.scroll === scroll) {
        schedule(entry);
    }
};

const getDocument = (document: Document) => {
    let state = documents.get(document);
    if (state) {
        return state;
    }
    const view = document.defaultView;
    const invalidate = () => {
        state.entries.forEach(entry => {
            // 字体、主题和布局变化可能使行变矮，先清除完整测量时保留的最小高度。
            entry.core.invalidate();
            schedule(entry);
        });
    };
    state = {
        entries: new Set(),
        suspensions: new Set(),
        removals: new view.MutationObserver(() => {
            state.entries.forEach(entry => {
                if (!entry.block.isConnected || entry.block.querySelector(".av__scroll") !== entry.scroll) {
                    disposeAVColumnWindow(entry.block);
                }
            });
        }),
        appearance: new view.MutationObserver(invalidate),
        onLoad: invalidate,
        onResize: invalidate,
    };
    if (view.ResizeObserver) {
        state.resize = new view.ResizeObserver(records => {
            const targets = new Set(records.map(record => record.target));
            state.entries.forEach(entry => {
                if (!targets.has(entry.scroll) && !targets.has(entry.block)) {
                    return;
                }
                const width = entry.scroll.clientWidth;
                const blockWidth = entry.block.clientWidth;
                if (width !== entry.width || blockWidth !== entry.blockWidth) {
                    entry.width = width;
                    entry.blockWidth = blockWidth;
                    entry.core.invalidate();
                    schedule(entry);
                }
            });
        });
    }
    // 行内占位和最小高度由核心管理，外层只观察文档结构及全局样式，避免自身修改反复触发。
    state.removals.observe(document.documentElement, {childList: true, subtree: true});
    state.appearance.observe(document.documentElement, {attributes: true});
    state.appearance.observe(document.body, {attributes: true});
    state.appearance.observe(document.head, {childList: true, subtree: true, attributes: true, characterData: true});
    document.head.addEventListener("load", state.onLoad, true);
    view.addEventListener("resize", state.onResize, {passive: true});
    documents.set(document, state);
    return state;
};

export const initAVColumnWindow = (blockElement: HTMLElement, options: {
    enabled: boolean;
    buffer?: number;
    onRowHeight?: (row: HTMLElement, height: number) => void;
}) => {
    disposeAVColumnWindow(blockElement);
    const scroll = blockElement.querySelector<HTMLElement>(".av__scroll");
    if (!options.enabled || blockElement.dataset.avType !== "table" || !blockElement.isConnected || !scroll) {
        return;
    }
    const document = getDocument(blockElement.ownerDocument);
    const entry: IAVColumnWindowEntry = {
        block: blockElement, scroll, document,
        core: new AVColumnVirtualScroll(blockElement, options),
        frame: 0, suspensions: 0, disposed: false,
        width: scroll.clientWidth, blockWidth: blockElement.clientWidth,
    };
    entries.set(blockElement, entry);
    document.entries.add(entry);
    document.suspensions.forEach(suspension => {
        if (suspension.root === blockElement || suspension.root.contains(blockElement)) {
            suspension.entries.add(entry);
            entry.suspensions++;
        }
    });
    if (entry.suspensions > 0) {
        entry.core.setSuspended(true);
    }
    document.resize?.observe(blockElement);
    document.resize?.observe(scroll);
    scroll.addEventListener("scroll", onScroll, {capture: true, passive: true});
    entry.core.update();
};

export const updateAVColumnWindow = (blockElement: HTMLElement) => {
    entries.get(blockElement)?.core.update();
};

export const prepareAVColumnWindow = (blockElement: HTMLElement) => {
    const entry = entries.get(blockElement);
    if (entry) {
        entry.core.invalidate();
        schedule(entry);
    }
};

export const ensureAVColumnWindow = (blockElement: HTMLElement, columnID: string, rowID?: string, groupID?: string) => {
    const entry = entries.get(blockElement);
    if (entry) {
        entry.core.ensureColumn(columnID, rowID, groupID);
        schedule(entry);
    }
};

const cleanupDocument = (document: Document, state: IAVColumnWindowDocument) => {
    if (state.entries.size > 0 || state.suspensions.size > 0) {
        return;
    }
    state.removals.disconnect();
    state.appearance.disconnect();
    state.resize?.disconnect();
    document.head.removeEventListener("load", state.onLoad, true);
    document.defaultView.removeEventListener("resize", state.onResize);
    documents.delete(document);
};

export const disposeAVColumnWindow = (blockElement: HTMLElement) => {
    const entry = entries.get(blockElement);
    if (!entry) {
        return;
    }
    entry.disposed = true;
    entries.delete(blockElement);
    entry.scroll.removeEventListener("scroll", onScroll, true);
    const document = blockElement.ownerDocument;
    const state = entry.document;
    state.resize?.unobserve(entry.block);
    state.resize?.unobserve(entry.scroll);
    if (entry.frame) {
        document.defaultView.cancelAnimationFrame(entry.frame);
    }
    entry.core.dispose();
    state.entries.delete(entry);
    state.suspensions.forEach(suspension => suspension.entries.delete(entry));
    cleanupDocument(document, state);
};

export const suspendAVColumnWindows = (root: HTMLElement) => {
    const state = getDocument(root.ownerDocument);
    const suspension = {root, entries: new Set<IAVColumnWindowEntry>()};
    state.suspensions.add(suspension);
    state.entries.forEach(entry => {
        if (entry.block === root || root.contains(entry.block)) {
            entry.suspensions++;
            entry.core.setSuspended(true);
            suspension.entries.add(entry);
        }
    });
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        state.suspensions.delete(suspension);
        suspension.entries.forEach(entry => {
            entry.suspensions--;
            if (!entry.disposed && entry.suspensions === 0) {
                entry.core.setSuspended(false);
            }
        });
        cleanupDocument(root.ownerDocument, state);
    };
};
