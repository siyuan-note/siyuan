import {Constants} from "../../../constants";
import {readListMindmap} from "./model";
import {ListMindmapView} from "./view";

const editorRoots = new WeakMap<Element, () => void>();
const previews = new WeakMap<HTMLElement, ListMindmapView>();

export const registerListMindmapRoot = (root: Element, refresh: () => void) => {
    editorRoots.set(root, refresh);
    return () => editorRoots.delete(root);
};

export const getListMindmapElements = (root: Element) => {
    const selector = `[data-type="NodeList"][${Constants.CUSTOM_SY_LIST_MINDMAP}="1"]`;
    const lists = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (root.matches(selector)) {
        lists.unshift(root as HTMLElement);
    }
    return lists.filter(list => !list.closest(".list-mindmap") &&
        !list.parentElement?.closest(selector));
};

// 导出页面和只读预览共用节点布局，源列表始终保留在文档中。
export const listMindmapRender = (root: Element, cdn?: string) => {
    const editor = root.closest(".protyle-wysiwyg");
    const refresh = editor && editorRoots.get(editor);
    if (refresh) {
        refresh();
        return;
    }
    getListMindmapElements(root).forEach(list => {
        const previous = previews.get(list);
        if (previous) {
            previous.refreshLayout();
            return;
        }
        try {
            const model = readListMindmap(list);
            list.querySelector(":scope > .list-mindmap")?.remove();
            const host = document.createElement("div");
            host.className = "list-mindmap";
            host.contentEditable = "false";
            list.appendChild(host);
            const view = new ListMindmapView({
                host, model, readOnly: true, labels: window.siyuan?.languages || {}, cdn,
                printLayout: !!list.closest("[data-export-pdf]"),
                onExit: () => {
                    view.destroy();
                    host.remove();
                    list.removeAttribute("data-list-mindmap-rendered");
                    previews.delete(list);
                },
            });
            previews.set(list, view);
            list.dataset.listMindmapRendered = "true";
        } catch (error) {
            // 无法识别配置时继续显示原列表，避免隐藏源内容。
            console.error(error);
            list.querySelector(":scope > .list-mindmap")?.remove();
            list.removeAttribute("data-list-mindmap-rendered");
        }
    });
};
