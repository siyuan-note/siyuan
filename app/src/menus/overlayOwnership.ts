interface IMenuOverlay {
    owner: HTMLElement;
    close: () => void;
}
// 同一文档的菜单与浮层可能来自不同窗口的模块实例，需要共享归属及清理状态。
const registryKey = Symbol.for("siyuan.menu.overlayOwnership");
interface IOverlayDocument extends Document {
    [registryKey]?: {overlays: Map<HTMLElement, IMenuOverlay>; observer: MutationObserver};
}

const findOverlay = (target: Node): IMenuOverlay | undefined => {
    const overlays = (target?.ownerDocument as IOverlayDocument)?.[registryKey]?.overlays;
    if (!overlays) { return; }
    let element = target.nodeType === 1 ? target as HTMLElement : target.parentElement;
    while (element) {
        const overlay = overlays.get(element);
        if (overlay) { return overlay; }
        element = element.parentElement;
    }
};

export const isMenuOverlayTarget = (menu: HTMLElement, target: Node) => {
    if (!target || target.ownerDocument !== menu.ownerDocument) { return false; }
    const visited = new Set<Node>();
    while (target && !visited.has(target)) {
        if (menu.contains(target)) { return true; }
        visited.add(target);
        target = findOverlay(target)?.owner;
    }
    return false;
};

export const getMenuOwnerElement = (target: Element): HTMLElement | undefined => {
    const visited = new Set<Element>();
    while (target && !visited.has(target)) {
        visited.add(target);
        const menu = target.closest<HTMLElement>(".b3-menu");
        if (menu) { return menu; }
        target = findOverlay(target)?.owner;
    }
};

export const closeMenuOverlays = (menu: HTMLElement) => {
    const doc = menu.ownerDocument as IOverlayDocument;
    const state = doc[registryKey];
    if (!state) { return; }
    const owned = Array.from(state.overlays).filter(([, overlay]) => isMenuOverlayTarget(menu, overlay.owner));
    owned.forEach(([element, overlay]) => {
        state.overlays.delete(element);
        overlay.close();
    });
    if (!state.overlays.size) {
        state.observer.disconnect();
        if (doc[registryKey] === state) { delete doc[registryKey]; }
    }
};

export const registerMenuOverlay = (owner: HTMLElement, element: HTMLElement, close: () => void) => {
    const doc = owner?.ownerDocument as IOverlayDocument;
    if (!doc || element?.ownerDocument !== doc || !owner.isConnected || !element.isConnected ||
        isMenuOverlayTarget(element, owner)) {
        throw new TypeError("Menu overlay requires connected owners in the same document without cycles");
    }
    let state = doc[registryKey];
    if (!state) {
        const overlays = new Map<HTMLElement, IMenuOverlay>();
        const observer = new doc.defaultView.MutationObserver(() => {
            Array.from(overlays).forEach(([root, overlay]) => {
                if (!root.isConnected || root.ownerDocument !== doc || !overlay.owner.isConnected || overlay.owner.ownerDocument !== doc) {
                    overlays.delete(root);
                    overlay.close();
                }
            });
            if (!overlays.size) {
                observer.disconnect();
                if (doc[registryKey] === state) { delete doc[registryKey]; }
            }
        });
        state = {overlays, observer};
        doc[registryKey] = state;
        observer.observe(doc.documentElement, {childList: true, subtree: true});
    }
    if (state.overlays.has(element)) { throw new TypeError("Menu overlay is already registered"); }
    const overlay = {owner, close};
    state.overlays.set(element, overlay);
    return () => {
        if (state.overlays.get(element) !== overlay) { return; }
        state.overlays.delete(element);
        if (!state.overlays.size) {
            state.observer.disconnect();
            if (doc[registryKey] === state) { delete doc[registryKey]; }
        }
    };
};
