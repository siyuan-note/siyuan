import {Constants} from "../../../constants";
import {readListMindmap} from "./model";
import {ListMindmapView} from "./view";

const previews = new WeakMap<HTMLElement, {source: string, view?: ListMindmapView}>();
const mountedPreviews = new Map<HTMLElement, {view: ListMindmapView, connected: boolean}>();
let removalObserver: MutationObserver;
let parser: Lute;

const trackPreview = (block: HTMLElement, view: ListMindmapView) => {
    mountedPreviews.set(block, {view, connected: block.isConnected});
    if (removalObserver) {
        return;
    }
    // 预览随文档或历史窗口关闭时释放全局事件，避免隐藏视图继续响应键盘和打印。
    removalObserver = new MutationObserver(() => {
        mountedPreviews.forEach((preview, element) => {
            if (element.isConnected) {
                preview.connected = true;
            } else if (preview.connected) {
                preview.view.destroy();
                mountedPreviews.delete(element);
                previews.delete(element);
                element.removeAttribute("data-render");
            }
        });
        if (mountedPreviews.size === 0) {
            removalObserver.disconnect();
            removalObserver = undefined;
        }
    });
    removalObserver.observe(block.ownerDocument.documentElement, {childList: true, subtree: true});
};

export const parseLegacyMindmap = (source: string, lute: Lute): HTMLElement | undefined => {
    if (!source.trim()) {
        return;
    }
    const template = document.createElement("template");
    template.innerHTML = lute.Md2BlockDOM(source);
    const blocks = Array.from(template.content.children);
    if (blocks.length !== 1 || blocks[0].getAttribute("data-type") !== "NodeList") {
        return;
    }
    const list = blocks[0] as HTMLElement;
    if (list.hasAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA)) {
        return;
    }
    list.setAttribute(Constants.CUSTOM_SY_LIST_MINDMAP, "1");
    return list;
};

const getParser = () => {
    if (!parser) {
        parser = Lute.New();
        parser.SetTextMark(true);
        parser.SetKramdownIAL(true);
        parser.SetProtyleWYSIWYG(true);
        parser.SetBlockRef(true);
        parser.SetFileAnnotationRef(true);
        parser.SetHTMLTag2TextMark(true);
        parser.SetHeadingID(false);
        parser.SetYamlFrontMatter(false);
        parser.SetToC(false);
        parser.SetSetext(false);
        parser.SetFootnotes(false);
        parser.SetLinkRef(false);
        parser.SetIndentCodeBlock(false);
        parser.SetGFMStrikethrough1(false);
        parser.SetArbitraryTaskListItemMarker(true);
        parser.SetEnsureListItemParagraph(true);
        parser.SetDataTask(true);
        parser.SetExportNormalizeTaskListMarker(false);
    }
    return parser;
};

// 旧数据仅作为迁移输入；预览保留代码块身份和原文，派生节点不参与编辑、复制和保存。
export const renderLegacyMindmaps = (root: Element, cdn?: string) => {
    const selector = '[data-subtype="mindmap"]:not([data-render="true"])';
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (root.getAttribute("data-subtype") === "mindmap" && root.getAttribute("data-render") !== "true") {
        blocks.unshift(root as HTMLElement);
    }
    blocks.forEach(block => {
        if (block.closest(".list-mindmap")) {
            return;
        }
        const source = Lute.UnEscapeHTMLStr(block.getAttribute("data-content") || "");
        const previous = previews.get(block);
        if (previous?.source === source) {
            previous.view?.refreshLayout();
            block.dataset.render = "true";
            return;
        }
        previous?.view?.destroy();
        mountedPreviews.delete(block);
        block.querySelectorAll(":scope > .list-mindmap").forEach(item => item.remove());
        const host = document.createElement("div");
        host.className = "list-mindmap";
        host.contentEditable = "false";
        block.appendChild(host);
        const showSource = (invalid: boolean) => {
            host.classList.add("list-mindmap--source");
            const message = document.createElement("div");
            message.className = "ft__secondary";
            message.textContent = invalid ? window.siyuan?.languages?.listMindmapMigrationInvalid || "" : "";
            const code = document.createElement("pre");
            code.textContent = source;
            host.replaceChildren(message, code);
            previews.set(block, {source});
        };
        try {
            const list = parseLegacyMindmap(source, getParser());
            if (!list) {
                throw new Error("Mind map source must contain one complete list");
            }
            const view = new ListMindmapView({
                host, model: readListMindmap(list), readOnly: true, cdn,
                labels: window.siyuan?.languages || {}, printLayout: !!block.closest("[data-export-pdf]"),
                onExit: () => {
                    view.destroy();
                    mountedPreviews.delete(block);
                    showSource(false);
                },
            });
            previews.set(block, {source, view});
            trackPreview(block, view);
        } catch {
            showSource(true);
        }
        block.dataset.render = "true";
    });
};
