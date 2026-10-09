import {Constants} from "../../../constants";
import {syncListMindmapHeight} from "./height";
import {readListMindmap} from "./model";
import {ListMindmapView} from "./view";
import {revealTabsForTarget} from "../tabsRender";

const editorRoots = new WeakMap<Element, {refresh: () => void,
    restoreFocus: (listID: string, candidateIDs: string[]) => void}>();
const previews = new WeakMap<HTMLElement, ListMindmapView>();
const visibleViews = new WeakMap<HTMLElement, {view: ListMindmapView, host: HTMLElement}>();

export const registerListMindmapView = (list: HTMLElement, view: ListMindmapView, host: HTMLElement) => {
    visibleViews.set(list, {view, host});
    return () => {
        if (visibleViews.get(list)?.view === view) {
            visibleViews.delete(list);
        }
    };
};

// 源块隐藏后，将块 ID 定位到派生视图中的节点或正文副本。
export const resolveVisibleListMindmapBlock = (source: Element): {
    carrier: HTMLElement, scrollElement: HTMLElement, reveal: () => void, focus: () => void
} | null | undefined => {
    const view = source.closest(".mindmap-view");
    const editor = source.closest(".protyle-wysiwyg");
    if (view && (!editor || editor.contains(view))) {
        return undefined;
    }
    const list = source.closest<HTMLElement>('[data-mindmap-view-rendered="true"]');
    if (!list) {
        return undefined;
    }
    const registered = visibleViews.get(list);
    if (!registered?.host.isConnected) {
        return null;
    }
    for (let block = source as HTMLElement; block && list.contains(block); block = block.parentElement) {
        const id = block.dataset.nodeId;
        const carrier = id && registered.view.getBlockById(id);
        if (carrier) {
            const node = carrier.closest<HTMLElement>(".mindmap-view__node");
            if (node?.hidden) {
                return null;
            }
            return {
                carrier, scrollElement: registered.host,
                reveal: () => {
                    revealTabsForTarget(carrier, false);
                    if (node) {
                        registered.view.revealNode(node.dataset.mindmapId);
                    }
                },
                focus: () => node ? registered.view.focusNode(node.dataset.mindmapId) :
                    registered.host.focus({preventScroll: true}),
            };
        }
        if (id && block !== list && block.dataset.type !== "NodeList" && block.dataset.type !== "NodeMindmap") {
            return null;
        }
        if (block === list) {
            break;
        }
    }
    if (source === list) {
        return {carrier: registered.host, scrollElement: registered.host,
            reveal: () => {}, focus: () => registered.host.focus({preventScroll: true})};
    }
    return null;
};

export const registerListMindmapRoot = (root: Element, refresh: () => void,
                                       restoreFocus: (listID: string, candidateIDs: string[]) => void) => {
    editorRoots.set(root, {refresh, restoreFocus});
    return () => editorRoots.delete(root);
};

// 撤销回放会替换源块，节点焦点交给编辑器在脑图重新挂载后恢复。
export const restoreListMindmapFocus = (root: Element, source: Element) => {
    const registered = editorRoots.get(root);
    if (!registered || root.contains(source.closest(".mindmap-view"))) {
        return false;
    }
    const list = getListMindmapElements(root).find(item => item.contains(source));
    if (!list) {
        return false;
    }
    const candidateIDs: string[] = [];
    for (let element = source; element && list.contains(element); element = element.parentElement) {
        const id = element.getAttribute("data-node-id");
        if (id) {
            candidateIDs.push(id);
        }
    }
    registered.restoreFocus(list.dataset.nodeId, candidateIDs);
    return true;
};

export const getListMindmapElements = (root: Element) => {
    const selector = `[data-type="NodeMindmap"], [data-type="NodeList"][${Constants.CUSTOM_SY_LIST_MINDMAP}="1"]`;
    const lists = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (root.matches(selector)) {
        lists.unshift(root as HTMLElement);
    }
    return lists.filter(list => (!list.closest(".mindmap-view") ||
        root.matches(".protyle-wysiwyg") && list.closest(".protyle-wysiwyg") === root &&
        !root.contains(list.closest(".mindmap-view"))) &&
        !root.contains(list.parentElement?.closest(selector)));
};

// 导出页面和只读预览共用节点布局，源列表始终保留在文档中。
export const listMindmapRender = (root: Element, cdn?: string) => {
    const editor = root.closest(".protyle-wysiwyg");
    const refresh = editor && editorRoots.get(editor)?.refresh;
    if (refresh) {
        refresh();
        return;
    }
    getListMindmapElements(root).forEach(list => {
        const previous = previews.get(list);
        if (previous) {
            const host = list.querySelector<HTMLElement>(":scope > .mindmap-view");
            if (host) {
                syncListMindmapHeight(list, host);
            }
            previous.refreshLayout();
            return;
        }
        try {
            const model = readListMindmap(list);
            list.querySelector(":scope > .mindmap-view")?.remove();
            const host = document.createElement("div");
            host.className = "mindmap-view";
            syncListMindmapHeight(list, host);
            host.contentEditable = "false";
            list.appendChild(host);
            const view = new ListMindmapView({
                host, model, readOnly: true, labels: window.siyuan?.languages || {}, cdn,
                printLayout: !!list.closest("[data-export-pdf]"),
                onExit: () => {
                    unregisterVisible();
                    view.destroy();
                    host.remove();
                    list.removeAttribute("data-mindmap-view-rendered");
                    previews.delete(list);
                },
            });
            const unregisterVisible = registerListMindmapView(list, view, host);
            previews.set(list, view);
            list.dataset.mindmapViewRendered = "true";
        } catch (error) {
            // 无法识别配置时继续显示原列表，避免隐藏源内容。
            console.error(error);
            list.querySelector(":scope > .mindmap-view")?.remove();
            list.removeAttribute("data-mindmap-view-rendered");
        }
    });
};
