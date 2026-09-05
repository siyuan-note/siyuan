import {getTabContent, getTabItems, getTabTitle, getTabTitleBlock, revealTabAncestors, tabsRender} from "../render/tabsRender";
import {repairActiveTab} from "./tabsRemoval";
import {transaction} from "./transaction";
import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {focusBlock} from "../util/selection";
import {genEmptyElement, genSBElement} from "../../block/util";
import {Menu} from "../../plugin/Menu";
import {processRender} from "../util/processCode";
import {avRender} from "../render/av/render";
import {isHiddenTabContent} from "../render/tabsVisibility";
import {queueTransaction} from "../util/transactionQueue";
import {remapTabsDOMIDs} from "../util/tabsCopy";
import {Dialog} from "../../dialog";
import {isMobile} from "../../util/functions";
import {getTabsTitleMarkdown, renderTabsTitleMarkdown} from "./tabsTitle";

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
    const title = getTabTitle(item);
    const initialTitle = getTabsTitleMarkdown(protyle.lute, title);
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    const input = dialog.element.querySelector("input") as HTMLInputElement;
    const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-button");
    const confirm = () => {
        const value = input.value.trim();
        if (value !== initialTitle) {
            changeTabs(protyle, [item.parentElement], () => {
                title.innerHTML = renderTabsTitleMarkdown(protyle.lute, value);
            });
        }
        dialog.destroy();
    };
    dialog.bindInput(input, confirm);
    input.value = initialTitle;
    input.focus();
    input.select();
    buttons[0].addEventListener("click", () => dialog.destroy());
    buttons[1].addEventListener("click", confirm);
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

export const openTabsMenu = (protyle: IProtyle, tabs: HTMLElement, item: HTMLElement, anchor: HTMLElement) => {
    if (!canEdit(protyle, tabs)) {
        return;
    }
    const lang = window.siyuan.languages;
    const menu = new Menu();
    if (item) {
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
    } else {
        ["top", "left"].forEach(position => menu.addItem({
            label: position === "top" ? lang.tabsPositionTop : lang.tabsPositionLeft,
            icon: (tabs.getAttribute("tabs-position") || "top") === position ? "iconSelect" : undefined,
            click: () => changeTabs(protyle, [tabs], () => tabs.setAttribute("tabs-position", position)),
        }));
        menu.addItem({icon: "iconSuper", label: lang.tabsUnwrap, click: () => unwrapTabs(protyle, tabs)});
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
        menuLabel: window.siyuan.languages.more,
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
    root.addEventListener("focusout", event => {
        const title = (event.target as Element).closest(".tab-item-title");
        if (title && !title.contains(event.relatedTarget as Node)) {
            title.closest<HTMLElement>(".tab-item").dataset.tabsEditing = "false";
        }
    });
};
