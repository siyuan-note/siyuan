import {getTabContent, getTabItems, getTabTitle, getTabTitleBlock, revealTabAncestors, tabsRender} from "../render/tabsRender";
import {repairActiveTab} from "./tabsRemoval";
import {transaction} from "./transaction";
import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {focusBlock, focusByRange} from "../util/selection";
import {genEmptyElement, genSBElement} from "../../block/util";
import {Menu} from "../../plugin/Menu";
import {processRender} from "../util/processCode";
import {avRender} from "../render/av/render";
import {isHiddenTabContent} from "../render/tabsVisibility";
import {queueTransaction} from "../util/transactionQueue";
import {remapTabsDOMIDs} from "../util/tabsCopy";
import {copyTextByType} from "../toolbar/util";

const canEdit = (protyle: IProtyle, element: Element) => !protyle.disabled &&
    !protyle.options.action.includes(Constants.CB_GET_HISTORY) && !element.closest(".protyle-wysiwyg__embed");

// 同一事务提交受影响的最外层容器，嵌套移动时避免父子更新相互覆盖。
const changeTabs = (protyle: IProtyle, elements: HTMLElement[], change: () => void) => {
    if (elements.some(element => !canEdit(protyle, element))) {
        return;
    }
    const roots = Array.from(new Set(elements)).filter(element =>
        !elements.some(other => other !== element && other.contains(element)));
    const before = roots.map(element => element.outerHTML);
    change();
    transaction(protyle, roots.map(element => {
        element.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        return {action: "update", id: element.dataset.nodeId, data: element.outerHTML};
    }), roots.map((element, index) => ({action: "update", id: element.dataset.nodeId, data: before[index]})));
};

const newTab = (protyle: IProtyle) => {
    const template = document.createElement("template");
    template.innerHTML = protyle.lute.Md2BlockDOM("::: tabs\n@tab\n\n:::\n");
    return template.content.querySelector<HTMLElement>(".tab-item");
};

export const renameTab = (protyle: IProtyle, item: HTMLElement) => {
    if (!canEdit(protyle, item)) {
        return;
    }
    revealTabAncestors(protyle.wysiwyg.element, item);
    item.dataset.tabsEditing = "true";
    initEditorTabs(protyle);
    const title = getTabTitle(item);
    const range = document.createRange();
    range.selectNodeContents(title);
    title.focus();
    focusByRange(range);
};

const addTab = (protyle: IProtyle, tabs: HTMLElement) => {
    const item = newTab(protyle);
    changeTabs(protyle, [tabs], () => {
        tabs.insertBefore(item, tabs.querySelector(":scope > .protyle-attr"));
        tabs.setAttribute("tabs-active-id", item.dataset.nodeId);
    });
    renameTab(protyle, item);
};

export const moveTab = (protyle: IProtyle, source: HTMLElement, target: HTMLElement, after = false) => {
    if (source === target || source.contains(target)) {
        return;
    }
    const from = source.parentElement;
    const to = target.parentElement;
    if (!from.classList.contains("tabs") || !to.classList.contains("tabs")) {
        return;
    }
    const ids = getTabItems(from).map(item => item.dataset.nodeId);
    changeTabs(protyle, [from, to], () => {
        to.insertBefore(source, after ? target.nextSibling : target);
        if (from !== to) {
            repairActiveTab(from, ids, source.dataset.nodeId);
        }
        to.setAttribute("tabs-active-id", source.dataset.nodeId);
    });
};

export const unwrapTabs = (protyle: IProtyle, tabs: HTMLElement) => {
    changeTabs(protyle, [tabs], () => {
        getTabItems(tabs).forEach(item => {
            const content = getTabContent(item);
            const title = getTabTitle(item);
            const blocks = Array.from(content.children);
            const titleBlock = getTabTitleBlock(item);
            if (titleBlock) {
                titleBlock.removeAttribute("tabs-title");
                title.classList.remove("tab-item-title", "callout-title");
                blocks.unshift(titleBlock);
            } else if (title.innerHTML) {
                const paragraph = genEmptyElement(false, false);
                paragraph.firstElementChild.innerHTML = title.innerHTML;
                blocks.unshift(paragraph);
            }
            item.className = "sb";
            item.dataset.type = "NodeSuperBlock";
            item.dataset.sbLayout = "row";
            item.removeAttribute("data-tabs-hidden");
            item.replaceChildren(...blocks, genSBElement("row").lastElementChild);
        });
        tabs.querySelector(":scope > .tabs-header")?.remove();
        tabs.className = "sb";
        tabs.dataset.type = "NodeSuperBlock";
        tabs.dataset.sbLayout = "row";
        tabs.removeAttribute("tabs-active-id");
        tabs.removeAttribute("tabs-position");
    });
};

export const setTabsPosition = (protyle: IProtyle, tabs: HTMLElement, position: "top" | "left") => {
    if ((tabs.getAttribute("tabs-position") || "top") !== position) {
        changeTabs(protyle, [tabs], () => tabs.setAttribute("tabs-position", position));
    }
};

export const openTabsMenu = (protyle: IProtyle, tabs: HTMLElement, item: HTMLElement, anchor: HTMLElement) => {
    if (!item) {
        return;
    }
    const lang = window.siyuan.languages;
    const menu = new Menu();
    menu.addItem({icon: "iconCopy", label: lang.copy, submenu: [{
        icon: "iconRef",
        label: lang.copyBlockRef,
        click: () => {copyTextByType([item.dataset.nodeId], "ref");},
    }]});
    if (canEdit(protyle, tabs)) {
        menu.addItem({icon: "iconEdit", label: lang.rename, click: () => renameTab(protyle, item)});
        menu.addItem({icon: "iconCopy", label: lang.duplicateCopy, click: () => {
            const copy = item.cloneNode(true) as HTMLElement;
            const ids = new Map<string, string>();
            [copy, ...Array.from(copy.querySelectorAll<HTMLElement>("[data-node-id]"))].forEach(block => {
                const id = Lute.NewNodeID();
                ids.set(block.dataset.nodeId, id);
                block.dataset.nodeId = id;
                block.setAttribute("updated", id.substring(0, 14));
            });
            remapTabsDOMIDs(copy, ids);
            changeTabs(protyle, [tabs], () => {
                item.after(copy);
                tabs.setAttribute("tabs-active-id", copy.dataset.nodeId);
            });
        }});
        menu.addItem({icon: "iconTrashcan", label: lang.delete, click: () => {
            const ids = getTabItems(tabs).map(entry => entry.dataset.nodeId);
            changeTabs(protyle, [tabs], () => {
                item.remove();
                repairActiveTab(tabs, ids, item.dataset.nodeId);
            });
            focusBlock(tabs);
        }});
    }
    const rect = anchor.getBoundingClientRect();
    menu.open({x: rect.left, y: rect.bottom});
};

export const initEditorTabs = (protyle: IProtyle) => {
    const root = protyle.wysiwyg.element;
    const measured = new WeakSet<Element>();
    tabsRender(root, {
        readonly: tabs => !canEdit(protyle, tabs || root),
        label: window.siyuan.languages.tabItem,
        addLabel: window.siyuan.languages.tabItem,
        select: (tabs, id) => {
            if (!canEdit(protyle, tabs) || tabs.getAttribute("tabs-active-id") === id) {
                return;
            }
            tabs.setAttribute("tabs-active-id", id);
            if (!protyle.lite) {
                queueTransaction(protyle, () => fetchPost("/api/attr/setBlockAttrs", {
                    id: tabs.dataset.nodeId, attrs: {"tabs-active-id": id},
                }));
            }
        },
        rename: item => renameTab(protyle, item),
        add: tabs => addTab(protyle, tabs),
        menu: (tabs, item, anchor) => openTabsMenu(protyle, tabs, item, anchor),
        move: (source, target, after) => moveTab(protyle, source, target, after),
        shown: item => requestAnimationFrame(() => {
            if (!item.isConnected || isHiddenTabContent(item)) {
                return;
            }
            item.querySelectorAll(".render-node[data-subtype]").forEach(element => {
                if (!isHiddenTabContent(element) && !measured.has(element)) {
                    element.removeAttribute("data-render");
                    measured.add(element);
                }
            });
            processRender(item);
            avRender(item, protyle);
            protyle.contentElement?.dispatchEvent(new Event("scroll"));
        }),
    });
};
