import {getTabContent, getTabItems} from "../render/tabsRender";
import {adjacentTabID} from "../render/tabsState";
import {genEmptyElement} from "../../block/util";
import {Constants} from "../../constants";

export const repairActiveTab = (tabs: HTMLElement, oldIDs: string[], removedID: string) => {
    const items = getTabItems(tabs);
    if (items.length === 0) {
        const paragraph = genEmptyElement(false, false, tabs.dataset.nodeId);
        tabs.className = paragraph.className;
        tabs.dataset.type = "NodeParagraph";
        tabs.innerHTML = paragraph.innerHTML;
        tabs.removeAttribute("tabs-active-id");
        tabs.removeAttribute("tabs-position");
    } else if (!items.some(item => item.dataset.nodeId === tabs.getAttribute("tabs-active-id"))) {
        const remainingIDs = items.map(item => item.dataset.nodeId);
        const index = oldIDs.indexOf(removedID);
        const following = oldIDs.slice(index + 1).find(id => remainingIDs.includes(id));
        const preceding = oldIDs.slice(0, index).reverse().find(id => remainingIDs.includes(id));
        tabs.setAttribute("tabs-active-id", following || preceding || adjacentTabID(remainingIDs, removedID));
    }
};

// 块标删除可能同时涉及页签及其正文，按最外层受影响容器保存完整撤销快照。
export const captureTabsRemoval = (elements: Element[]) => {
    const candidates = Array.from(new Set(elements.map(element => element.parentElement?.closest<HTMLElement>(".tabs"))))
        .filter(tabs => tabs && !elements.some(element => element === tabs || element.contains(tabs)));
    const roots = candidates.filter(tabs => !candidates.some(other => other !== tabs && other.contains(tabs)));
    const snapshots = roots.map(root => ({
        root,
        html: root.outerHTML,
        ids: new Set([root.dataset.nodeId, ...Array.from(root.querySelectorAll<HTMLElement>("[data-node-id]"))
            .map(block => block.dataset.nodeId)]),
        groups: [root, ...Array.from(root.querySelectorAll<HTMLElement>(".tabs"))].map(tabs => ({
            tabs,
            active: tabs.getAttribute("tabs-active-id"),
            ids: getTabItems(tabs).map(item => item.dataset.nodeId),
        })),
    }));
    return {
        normalize() {
            snapshots.forEach(snapshot => {
                snapshot.groups.slice().reverse().forEach(({tabs, ids, active}) => {
                    if (!snapshot.root.contains(tabs)) {
                        return;
                    }
                    getTabItems(tabs).forEach(item => {
                        const content = getTabContent(item);
                        if (content && !content.querySelector(":scope > [data-node-id]")) {
                            content.appendChild(genEmptyElement(false, false));
                        }
                    });
                    repairActiveTab(tabs, ids, active);
                });
            });
        },
        operations(doOperations: IOperation[], undoOperations: IOperation[]) {
            snapshots.filter(snapshot => snapshot.root.isConnected).forEach(snapshot => {
                snapshot.root.querySelectorAll<HTMLElement>("[data-node-id]").forEach(block => snapshot.ids.add(block.dataset.nodeId));
                doOperations = doOperations.filter(operation => !snapshot.ids.has(operation.id));
                undoOperations = undoOperations.filter(operation => !snapshot.ids.has(operation.id));
                snapshot.root.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
                doOperations.push({action: "update", id: snapshot.root.dataset.nodeId, data: snapshot.root.outerHTML});
                undoOperations.push({action: "update", id: snapshot.root.dataset.nodeId, data: snapshot.html});
            });
            return {doOperations, undoOperations};
        },
    };
};
