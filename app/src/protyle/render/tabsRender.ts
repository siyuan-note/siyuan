import {resolveTabID, tabKeyboardTarget} from "./tabsState";

export interface ITabsRenderOptions {
    readonly?: (tabs?: Element) => boolean;
    label?: string;
    addLabel?: string;
    menuLabel?: string;
    select?: (tabs: HTMLElement, id: string) => void;
    rename?: (item: HTMLElement) => void;
    add?: (tabs: HTMLElement) => void;
    menu?: (tabs: HTMLElement, item: HTMLElement, anchor: HTMLElement) => void;
    move?: (source: HTMLElement, target: HTMLElement, after?: boolean) => void;
    shown?: (item: HTMLElement) => void;
}

interface ITabState {
    owner: ITabsRoot;
    active: string;
    source: string;
    pending?: string;
    signature?: string;
    instance: string;
    renderedActive?: string;
}

interface ITabsRoot {
    options: ITabsRenderOptions;
    render: () => void;
    observer: MutationObserver;
    resize: ResizeObserver;
    destroy: () => void;
    select: (tabs: HTMLElement, id: string, persist: boolean) => void;
}

const roots = new WeakMap<Element, ITabsRoot>();
const states = new WeakMap<HTMLElement, ITabState>();
const boundHeaders = new WeakSet<Element>();
let instanceID = 0;
let draggedTab: HTMLElement;

export const getTabItems = (tabs: Element): HTMLElement[] =>
    Array.from(tabs.children).filter(item => item.classList.contains("tab-item")) as HTMLElement[];

export const getTabTitle = (item: Element) =>
    item.querySelector<HTMLElement>(":scope > .tab-item-info > .tab-item-title, :scope > .tab-item-info > [tabs-title] > .tab-item-title");

export const getTabTitleBlock = (item: Element) =>
    item.querySelector<HTMLElement>(':scope > .tab-item-info > [data-type="NodeParagraph"][tabs-title="true"]');

export const getTabContent = (item: Element) => item.querySelector<HTMLElement>(":scope > .tab-item-content");

const itemID = (item: HTMLElement) => item.getAttribute("data-node-id") || item.id;

const panelHasFocus = (panel: HTMLElement) => {
    const active = document.activeElement;
    const editor = panel.closest(".protyle-wysiwyg");
    if (!active || !editor || (active !== editor && !panel.contains(active))) {
        return false;
    }
    const selection = window.getSelection();
    return panel.contains(active) || (selection?.anchorNode && panel.contains(selection.anchorNode));
};

// 控件是渲染结果；原始标题始终保留在对应页签项中。
export const tabsRender = (element: Element, options: ITabsRenderOptions = {}) => {
    const existing = roots.get(element);
    if (existing) {
        existing.options = options;
        existing.render();
        return;
    }
    const getTabs = () => [
        ...(element.matches('.tabs[data-type="NodeTabs"]') ? [element as HTMLElement] : []),
        ...Array.from(element.querySelectorAll<HTMLElement>('.tabs[data-type="NodeTabs"]')),
    ];
    let scheduled = false;
    let destroyed = false;
    const schedule = () => {
        if (scheduled || destroyed) {
            return;
        }
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            if (!destroyed) {
                controller.render();
            }
        });
    };
    const controller: ITabsRoot = {
        options,
        select(tabs, id, persist) {
            const state = states.get(tabs);
            if (!state || !getTabItems(tabs).some(item => itemID(item) === id)) {
                return;
            }
            state.active = id;
            state.pending = undefined;
            if (persist && !controller.options.readonly?.(tabs)) {
                controller.options.select?.(tabs, id);
            }
            controller.render();
        },
        render() {
            controller.observer.disconnect();
            controller.resize.disconnect();
            const shown: HTMLElement[] = [];
            getTabs().forEach(tabs => {
                const items = getTabItems(tabs);
                const ids = items.map(itemID);
                if (ids.length === 0) {
                    return;
                }
                const source = resolveTabID(ids, tabs.getAttribute("tabs-active-id"));
                let state = states.get(tabs);
                if (!state || state.owner !== controller) {
                    state = {owner: controller, active: source, source, instance: `siyuan-tabs-${++instanceID}`};
                    states.set(tabs, state);
                }
                const current = items.find(item => itemID(item) === state.active);
                if (source !== state.source) {
                    state.source = source;
                    if (current && source !== state.active && panelHasFocus(current)) {
                        state.pending = source;
                    } else {
                        state.active = source;
                        state.pending = undefined;
                    }
                }
                if (state.pending && (!current || !panelHasFocus(current))) {
                    state.active = state.pending;
                    state.pending = undefined;
                }
                state.active = resolveTabID(ids, state.active);
                const readonly = controller.options.readonly?.(tabs) ?? true;
                const narrow = tabs.clientWidth < 420;
                const vertical = tabs.getAttribute("tabs-position") === "left" && !narrow;
                tabs.setAttribute("data-tabs-orientation", vertical ? "vertical" : "horizontal");
                let header = tabs.querySelector<HTMLElement>(":scope > .tabs-header");
                if (!header) {
                    header = document.createElement("div");
                    header.className = "tabs-header protyle-action";
                    tabs.prepend(header);
                }
                header.setAttribute("contenteditable", "false");
                if (!boundHeaders.has(header)) {
                    boundHeaders.add(header);
                    ["pointerdown", "mousedown", "mouseup", "click", "keydown"].forEach(type => {
                        header.addEventListener(type, event => event.stopPropagation());
                    });
                    header.addEventListener("selectstart", event => event.preventDefault());
                }
                const signature = JSON.stringify([readonly, ...items.map(item => [itemID(item), getTabTitle(item)?.innerHTML])]);
                if (state.signature !== signature || !header.firstElementChild) {
                    const focusedID = (document.activeElement as HTMLElement)?.dataset?.tabId;
                    header.replaceChildren();
                    const list = document.createElement("div");
                    list.className = "tabs-list";
                    list.setAttribute("role", "tablist");
                    list.setAttribute("aria-label", controller.options.label || "Tabs");
                    header.appendChild(list);
                    items.forEach((item, index) => {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = "tabs-tab";
                        button.setAttribute("role", "tab");
                        button.dataset.tabId = itemID(item);
                        button.id = `${state.instance}-tab-${index}`;
                        const title = getTabTitle(item);
                        button.title = title?.textContent || controller.options.label || "Tab";
                        if (title?.textContent) {
                            const clone = title.cloneNode(true) as HTMLElement;
                            clone.className = "tabs-tab-label";
                            clone.removeAttribute("contenteditable");
                            clone.querySelectorAll("[contenteditable], [id], [data-node-id]").forEach(child => {
                                child.removeAttribute("contenteditable");
                                child.removeAttribute("id");
                                child.removeAttribute("data-node-id");
                            });
                            button.appendChild(clone);
                        } else {
                            button.textContent = button.title;
                        }
                        button.addEventListener("click", event => {
                            event.preventDefault();
                            event.stopPropagation();
                            controller.select(tabs, itemID(item), true);
                        });
                        button.addEventListener("dblclick", event => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (!controller.options.readonly?.(tabs)) {
                                controller.options.rename?.(item);
                            }
                        });
                        button.addEventListener("contextmenu", event => {
                            event.preventDefault();
                            event.stopPropagation();
                            controller.select(tabs, itemID(item), true);
                            controller.options.menu?.(tabs, item, button);
                        });
                        button.addEventListener("keydown", event => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                controller.select(tabs, itemID(item), true);
                                return;
                            }
                            const target = tabKeyboardTarget(ids, itemID(item), event.key,
                                tabs.getAttribute("data-tabs-orientation") === "vertical");
                            if (!target) {
                                return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            Array.from(list.children).find(child => (child as HTMLElement).dataset.tabId === target)
                                ?.scrollIntoView({block: "nearest", inline: "nearest"});
                            (Array.from(list.children).find(child => (child as HTMLElement).dataset.tabId === target) as HTMLElement)?.focus();
                        });
                        button.draggable = !readonly && !!controller.options.move;
                        button.addEventListener("dragstart", event => {
                            draggedTab = item;
                            event.dataTransfer.setData("application/x-siyuan-tab", itemID(item));
                            event.dataTransfer.effectAllowed = "move";
                            event.stopPropagation();
                        });
                        button.addEventListener("dragover", event => {
                            if (draggedTab && !readonly) {
                                event.preventDefault();
                                event.stopPropagation();
                            }
                        });
                        button.addEventListener("drop", event => {
                            if (draggedTab && !readonly) {
                                event.preventDefault();
                                event.stopPropagation();
                                const rect = button.getBoundingClientRect();
                                const after = tabs.getAttribute("data-tabs-orientation") === "vertical" ?
                                    event.clientY > rect.top + rect.height / 2 : event.clientX > rect.left + rect.width / 2;
                                controller.options.move?.(draggedTab, item, after);
                                draggedTab = undefined;
                            }
                        });
                        button.addEventListener("dragend", () => draggedTab = undefined);
                        list.appendChild(button);
                    });
                    if (!readonly) {
                        const add = document.createElement("button");
                        add.type = "button";
                        add.className = "tabs-control";
                        add.textContent = "+";
                        add.title = controller.options.addLabel || "+";
                        add.setAttribute("aria-label", add.title);
                        add.addEventListener("click", event => {
                            event.stopPropagation();
                            controller.options.add?.(tabs);
                        });
                        header.appendChild(add);
                        const menu = document.createElement("button");
                        menu.type = "button";
                        menu.className = "tabs-control";
                        menu.innerHTML = '<svg><use xlink:href="#iconMore"></use></svg>';
                        menu.title = controller.options.menuLabel || "...";
                        menu.setAttribute("aria-label", menu.title);
                        menu.addEventListener("click", event => {
                            event.stopPropagation();
                            controller.options.menu?.(tabs, items.find(item => itemID(item) === state.active), menu);
                        });
                        header.appendChild(menu);
                    }
                    state.signature = signature;
                    if (focusedID) {
                        (Array.from(list.children).find(child => (child as HTMLElement).dataset.tabId === focusedID) as HTMLElement)?.focus();
                    }
                }
                const list = header.querySelector<HTMLElement>(".tabs-list");
                list.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
                items.forEach((item, index) => {
                    const selected = itemID(item) === state.active;
                    const button = list.children[index] as HTMLElement;
                    const panelID = `${state.instance}-panel-${index}`;
                    button.setAttribute("aria-selected", String(selected));
                    button.setAttribute("aria-controls", panelID);
                    button.tabIndex = selected ? 0 : -1;
                    // 页签项原有块 ID 用于引用；面板的辅助 ID 仅标记正文包装元素。
                    const content = getTabContent(item);
                    if (content) {
                        content.id = panelID;
                        content.setAttribute("role", "tabpanel");
                        content.setAttribute("aria-labelledby", button.id);
                        if (readonly) {
                            content.tabIndex = 0;
                        } else {
                            content.removeAttribute("tabindex");
                        }
                    }
                    item.setAttribute("data-tabs-hidden", selected ? "false" : "true");
                    const title = getTabTitle(item);
                    if (title && !readonly && item.dataset.tabsEditing === "true") {
                        title.setAttribute("contenteditable", "true");
                    }
                });
                tabs.setAttribute("data-tabs-ready", "true");
                controller.resize.observe(tabs);
                if (!tabs.closest('.tab-item[data-tabs-hidden="true"]') && state.renderedActive !== state.active) {
                    state.renderedActive = state.active;
                    const button = list.querySelector<HTMLElement>('[aria-selected="true"]');
                    const listRect = list.getBoundingClientRect();
                    const buttonRect = button.getBoundingClientRect();
                    if (vertical) {
                        list.scrollTop += buttonRect.top < listRect.top ? buttonRect.top - listRect.top :
                            Math.max(0, buttonRect.bottom - listRect.bottom);
                    } else {
                        list.scrollLeft += buttonRect.left < listRect.left ? buttonRect.left - listRect.left :
                            Math.max(0, buttonRect.right - listRect.right);
                    }
                    shown.push(items.find(item => itemID(item) === state.active));
                }
            });
            controller.observer.observe(element, {
                childList: true, subtree: true, characterData: true, attributes: true,
                attributeFilter: ["tabs-active-id", "tabs-position", "data-readonly", "data-tabs-editing", "contenteditable"],
            });
            shown.forEach(item => controller.options.shown?.(item));
        },
        observer: new MutationObserver(schedule),
        resize: new ResizeObserver(entries => {
            if (entries.some(entry => {
                const tabs = entry.target;
                const vertical = tabs.getAttribute("tabs-position") === "left" && (tabs as HTMLElement).clientWidth >= 420;
                return tabs.getAttribute("data-tabs-orientation") !== (vertical ? "vertical" : "horizontal");
            })) {
                schedule();
            }
        }),
        destroy() {
            destroyed = true;
            controller.observer.disconnect();
            controller.resize.disconnect();
            element.removeEventListener("focusout", schedule);
            roots.delete(element);
        },
    };
    roots.set(element, controller);
    element.addEventListener("focusout", schedule);
    controller.render();
};

export const destroyTabsRender = (element: Element) => roots.get(element)?.destroy();

export const revealTabsForTarget = (target: Element, persist = true) => {
    for (let root = target; root; root = root.parentElement) {
        if (roots.has(root)) {
            revealTabAncestors(root, target, persist);
            return;
        }
    }
};

export const revealTabAncestors = (root: Element, target: Element, persist = true) => {
    const titleBlock = target.closest('[tabs-title="true"]');
    if (titleBlock) {
        const owner = titleBlock.closest<HTMLElement>(".tab-item");
        if (owner && root.contains(owner)) {
            owner.dataset.tabsEditing = "true";
        }
    }
    const path: HTMLElement[] = [];
    let item = target.closest<HTMLElement>(".tab-item");
    while (item && root.contains(item)) {
        path.unshift(item);
        item = item.parentElement.closest<HTMLElement>(".tab-item");
    }
    path.forEach(panel => {
        const tabs = panel.parentElement;
        if (tabs.classList.contains("tabs") && panel.getAttribute("data-tabs-hidden") !== "false") {
            roots.get(root)?.select(tabs, itemID(panel), persist);
        }
    });
};
