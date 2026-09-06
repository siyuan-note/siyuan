import {resolveTabID, tabKeyboardTarget} from "./tabsState";
import {bindTabsDrag, cancelTabsDrag, isDraggingTabs} from "./tabsDrag";
import {escapeHtml} from "../../util/escape";

export interface ITabsRenderOptions {
    readonly?: (tabs?: Element) => boolean;
    label?: string;
    addLabel?: string;
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
    const sizes = new WeakMap<Element, string>();
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
    const endTitleEditing = () => {
        const selection = window.getSelection();
        const active = document.activeElement;
        // 工具栏及其弹窗继续使用标题选区，不结束正在进行的富文本编辑。
        if (active?.closest(".protyle-toolbar, .protyle-util, .b3-menu, .b3-dialog")) {
            return;
        }
        let changed = false;
        element.querySelectorAll<HTMLElement>('.tab-item[data-tabs-editing="true"]').forEach(item => {
            const title = getTabTitle(item);
            const selectionInTitle = title?.contains(selection?.anchorNode) &&
                (active === element || element.contains(active));
            if (title && !title.contains(active) && !selectionInTitle) {
                item.dataset.tabsEditing = "false";
                changed = true;
            }
        });
        if (changed) {
            schedule();
        }
    };
    const onFocusOut = () => queueMicrotask(() => {
        endTitleEditing();
        schedule();
    });
    const controller: ITabsRoot = {
        options,
        select(tabs, id, persist) {
            // 文档刚插入时观察器尚未渲染，先初始化状态以支持立即跳转到隐藏页签。
            if (!states.has(tabs)) {
                controller.render();
            }
            const state = states.get(tabs);
            if (!state || !getTabItems(tabs).some(item => itemID(item) === id)) {
                return;
            }
            if (state.active !== id) {
                getTabItems(tabs).forEach(item => item.dataset.tabsEditing = "false");
            }
            state.active = id;
            state.pending = undefined;
            if (persist && !controller.options.readonly?.(tabs)) {
                controller.options.select?.(tabs, id);
            }
            controller.render();
        },
        render() {
            if (isDraggingTabs(element)) {
                return;
            }
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
                const signature = JSON.stringify([readonly, ...items.map(item => [itemID(item),
                    item.dataset.tabsEditing === "true" ? null : getTabTitle(item)?.innerHTML])]);
                if (state.signature !== signature || !header.firstElementChild) {
                    const focusedID = (document.activeElement as HTMLElement)?.dataset?.tabId;
                    header.replaceChildren();
                    const list = document.createElement("div");
                    list.className = "tabs-list";
                    list.setAttribute("role", "tablist");
                    list.setAttribute("aria-label", controller.options.label || "Tabs");
                    header.appendChild(list);
                    bindTabsDrag(list, {
                        tabs,
                        readonly: () => (controller.options.readonly?.(tabs) ?? true) || !controller.options.move ||
                            getTabItems(tabs).some(item => item.dataset.tabsEditing === "true"),
                        move: (source, target, after) => controller.options.move?.(source, target, after),
                        render: schedule,
                    });
                    items.forEach((item, index) => {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = "tabs-tab";
                        button.setAttribute("role", "tab");
                        button.dataset.tabId = itemID(item);
                        button.id = `${state.instance}-tab-${index}`;
                        const title = getTabTitle(item);
                        const label = title?.textContent || controller.options.label || "Tab";
                        if (title?.textContent) {
                            const clone = title.cloneNode(true) as HTMLElement;
                            clone.className = "tabs-tab-label";
                            clone.removeAttribute("contenteditable");
                            clone.removeAttribute("spellcheck");
                            clone.querySelectorAll("br").forEach(br => br.replaceWith(" "));
                            clone.querySelectorAll("[contenteditable], [spellcheck], [id], [data-node-id]").forEach(child => {
                                child.removeAttribute("contenteditable");
                                child.removeAttribute("spellcheck");
                                child.removeAttribute("id");
                                child.removeAttribute("data-node-id");
                            });
                            button.appendChild(clone);
                        } else {
                            button.innerHTML = '<span class="tabs-tab-label"></span>';
                            button.firstElementChild.textContent = label;
                        }
                        button.setAttribute("aria-label", escapeHtml(button.textContent));
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
                        list.appendChild(button);
                    });
                    if (!readonly) {
                        const add = document.createElement("button");
                        add.type = "button";
                        add.className = "tabs-control ariaLabel";
                        add.innerHTML = '<svg><use xlink:href="#iconAdd"></use></svg>';
                        add.setAttribute("aria-label", escapeHtml(controller.options.addLabel || "+"));
                        add.addEventListener("click", event => {
                            event.stopPropagation();
                            controller.options.add?.(tabs);
                        });
                        header.appendChild(add);
                    }
                    state.signature = signature;
                    if (focusedID) {
                        (Array.from(list.children).find(child => (child as HTMLElement).dataset.tabId === focusedID) as HTMLElement)?.focus();
                    }
                }
                const list = header.querySelector<HTMLElement>(".tabs-list");
                list.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
                let editingButton: HTMLElement;
                items.forEach((item, index) => {
                    if (readonly) {
                        item.dataset.tabsEditing = "false";
                    }
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
                    const editing = !readonly && selected && item.dataset.tabsEditing === "true";
                    if (editing && !button.classList.contains("tabs-tab--editing")) {
                        editingButton = button;
                    }
                    button.classList.toggle("tabs-tab--editing", editing);
                    button.draggable = !readonly && !editing && !!controller.options.move;
                    const info = item.querySelector<HTMLElement>(":scope > .tab-item-info");
                    if (info) {
                        info.classList.toggle("tabs-title-editor", editing);
                        if (!editing) {
                            info.removeAttribute("style");
                        }
                    }
                });
                tabs.setAttribute("data-tabs-ready", "true");
                if (editingButton && !vertical) {
                    // 展开编辑标签后滚动到完整可见的位置，避免右侧页签的输入区域被裁切。
                    const listRect = list.getBoundingClientRect();
                    const rect = editingButton.getBoundingClientRect();
                    list.scrollLeft += rect.left < listRect.left ? rect.left - listRect.left :
                        Math.max(0, rect.right - listRect.right);
                }
                items.forEach((item, index) => {
                    const info = item.querySelector<HTMLElement>(":scope > .tabs-title-editor");
                    if (!info) {
                        return;
                    }
                    // 原始标题保留在页签项内，仅将显示位置对齐到导航标签，沿用块编辑和撤销事务。
                    const button = list.children[index] as HTMLElement;
                    const rect = button.getBoundingClientRect();
                    const parentRect = item.getBoundingClientRect();
                    const listRect = list.getBoundingClientRect();
                    const scale = parentRect.width ? item.offsetWidth / parentRect.width : 1;
                    info.style.left = `${(rect.left - parentRect.left) * scale - item.clientLeft}px`;
                    info.style.top = `${(rect.top - parentRect.top) * scale - item.clientTop}px`;
                    info.style.width = `${rect.width * scale}px`;
                    info.style.height = `${rect.height * scale}px`;
                    info.style.clipPath = `inset(${Math.max(0, listRect.top - rect.top) * scale}px ` +
                        `${Math.max(0, rect.right - listRect.right) * scale}px ` +
                        `${Math.max(0, rect.bottom - listRect.bottom) * scale}px ` +
                        `${Math.max(0, listRect.left - rect.left) * scale}px)`;
                });
                list.querySelectorAll<HTMLElement>(".tabs-tab-label").forEach(label => {
                    label.parentElement.classList.toggle("ariaLabel", label.scrollWidth > label.clientWidth);
                });
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
            let changed = false;
            entries.forEach(entry => {
                const target = entry.target as HTMLElement;
                const size = `${target.clientWidth}:${target.clientHeight}`;
                if (sizes.get(target) !== size) {
                    sizes.set(target, size);
                    changed = true;
                }
            });
            if (changed) {
                schedule();
            }
        }),
        destroy() {
            cancelTabsDrag(element);
            destroyed = true;
            controller.observer.disconnect();
            controller.resize.disconnect();
            element.removeEventListener("focusout", onFocusOut);
            element.removeEventListener("scroll", schedule, true);
            document.removeEventListener("selectionchange", endTitleEditing);
            roots.delete(element);
        },
    };
    roots.set(element, controller);
    element.addEventListener("focusout", onFocusOut);
    element.addEventListener("scroll", schedule, true);
    document.addEventListener("selectionchange", endTitleEditing);
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
