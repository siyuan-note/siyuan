import {isFoldedRenderContent, registerFoldedRenderRoot, unregisterFoldedRenderRoot} from "../render/foldedContent";
import {processRender} from "./processCode";
import {highlightRender} from "../render/highlightRender";
import {avRender} from "../render/av/render";
import {blockRender} from "../render/blockRender";

const roots = new WeakMap<IProtyle, () => void>();

export const initFoldedRender = (protyle: IProtyle) => {
    if (roots.has(protyle)) {
        return;
    }
    const root = protyle.wysiwyg.element;
    registerFoldedRenderRoot(root);
    const pending = new Set<Element>();
    let frame = 0;
    const observer = new MutationObserver(records => {
        records.forEach(record => {
            const element = record.target as Element;
            if (record.oldValue === "1" && element.getAttribute("fold") !== "1") {
                pending.add(element);
            }
        });
        if (pending.size === 0 || frame) {
            return;
        }
        frame = requestAnimationFrame(() => {
            frame = 0;
            const elements = Array.from(pending);
            pending.clear();
            elements.forEach(element => {
                if (!root.contains(element) || element.getAttribute("fold") === "1" ||
                    isFoldedRenderContent(element) || elements.some(parent => parent !== element && parent.contains(element))) {
                    return;
                }
                processRender(element);
                highlightRender(element);
                void avRender(element, protyle);
                blockRender(protyle, element);
                protyle.contentElement?.dispatchEvent(new Event("scroll"));
            });
        });
    });
    observer.observe(root, {subtree: true, attributes: true, attributeFilter: ["fold"], attributeOldValue: true});
    roots.set(protyle, () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
        pending.clear();
        unregisterFoldedRenderRoot(root);
    });
};

export const destroyFoldedRender = (protyle: IProtyle) => {
    roots.get(protyle)?.();
    roots.delete(protyle);
};
