import {addListMindmapNode, cleanListMindmapHTML, deleteListMindmapNode, moveListMindmapNode, readListMindmap, replaceListMindmapContent} from "./model";
import type {ListMindmapNode} from "./model";

export interface ListMindmapListInput {
    kind: "split" | "before" | "indent" | "outdent" | "mergePrevious" | "mergeNext";
    html: string;
    before?: string;
    after?: string;
}

export const getListMindmapListInputTarget = (node: ListMindmapNode, kind: ListMindmapListInput["kind"]) => {
    const element = node?.element;
    const isItem = (element?: Element) => element &&
        ["NodeListItem", "NodeMindmapItem"].includes(element.getAttribute("data-type"));
    if (!element) {
        return;
    }
    const target = kind === "outdent" ? element.parentElement?.parentElement :
        kind === "mergeNext" ? element.nextElementSibling : element.previousElementSibling;
    return isItem(target) ? target as HTMLElement : undefined;
};

// 调用方在克隆的完整源树上规划，再以一次可撤销事务替换正文。
export const applyListMindmapListInput = (list: HTMLElement, id: string, input: ListMindmapListInput,
                                         item?: HTMLElement) => {
    const model = readListMindmap(list);
    const node = model.nodes.get(id);
    if (!node?.element || node.contentBlocks.map(block => cleanListMindmapHTML(block.outerHTML)).join("") !== input.html) {
        return;
    }
    const target = getListMindmapListInputTarget(node, input.kind);
    const focus = (id: string, block?: Element) => ({id, selection: block ? {
        undoFocusId: block.getAttribute("data-node-id"), undoFocusStart: "0", undoFocusEnd: "0",
    } : undefined});
    if (input.kind === "indent" || input.kind === "outdent") {
        if (target && moveListMindmapNode(list, id, target.dataset.nodeId, input.kind === "indent" ? "child" : "after")) {
            return focus(id);
        }
        return;
    }
    if (input.kind === "split" || input.kind === "before") {
        if (!item) {
            return;
        }
        if (input.kind === "split") {
            if (!input.before || !input.after || !replaceListMindmapContent(list, id, input.before)) {
                return;
            }
            const template = list.ownerDocument.createElement("template");
            template.innerHTML = input.after;
            const paragraph = Array.from(item.children).find(child => child.hasAttribute("data-node-id"));
            paragraph.replaceWith(...Array.from(template.content.children));
        }
        if (addListMindmapNode(list, id, input.kind === "before" ? "before" : "after", item)) {
            return focus(item.dataset.nodeId, item.querySelector("[data-node-id]"));
        }
        return;
    }
    if (!target) {
        return;
    }
    const destination = input.kind === "mergePrevious" ? target : node.element;
    const source = input.kind === "mergePrevious" ? node.element : target;
    const sourceNode = model.nodes.get(source.dataset.nodeId);
    const content = sourceNode.contentBlocks;
    const boundary = Array.from(destination.children).find(child =>
        child.getAttribute("data-type") === (list.dataset.type === "NodeMindmap" ? "NodeMindmap" : "NodeList") ||
        child.classList.contains("protyle-attr"));
    content.forEach(block => destination.insertBefore(block, boundary || null));
    sourceNode.children.forEach(child => moveListMindmapNode(list, child.id, destination.dataset.nodeId, "child"));
    if (deleteListMindmapNode(list, source.dataset.nodeId)) {
        return focus(destination.dataset.nodeId, content[0]);
    }
};

