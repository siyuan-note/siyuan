import {fetchPost} from "../../util/fetch";
import {sanitizeKernelHTML} from "../../util/hostCapabilities";
import {mathRender} from "../render/mathRender";
import {getDocDisplayName} from "../../util/pathName";
import type {DocumentTitleData} from "../../types/api";

export type DocumentTitlePreviewValue = Pick<DocumentTitleData, "id" | "notebook" | "format" | "text" | "empty" | "blockDOM">;

const requests = new WeakMap<HTMLElement, number>();

// 菜单复用页签已清洗的行级预览，公式缓存未就绪时按原生渲染补齐。
export const copyDocumentTitlePreview = (source: HTMLElement, target: HTMLElement) => {
    if (!source?.classList.contains("document-title-preview") || !target) return;
    target.classList.add("b3-typography", "document-title-preview");
    target.dataset.protyleLiteRender = "safe";
    target.replaceChildren(...Array.from(source.childNodes, node => node.cloneNode(true)));
    void mathRender(target);
};

// 同一轮标题更新可直接提供已读取的源；仅在没有后续源投影时补查，避免页签重复读取。
export const scheduleDocumentTitlePreview = (element: HTMLElement, id: string, notebook: string, isCurrent: () => boolean) => {
    const request = requests.get(element);
    queueMicrotask(() => {
        if (element.isConnected && isCurrent() && requests.get(element) === request) {
            renderDocumentTitlePreview(element, id, notebook, isCurrent);
        }
    });
};

// 只更新当前仍连接的预览节点；切换文档、锁定或清空会使迟到响应失效。
export const renderDocumentTitlePreview = (element: HTMLElement, id: string, notebook: string,
                                            isCurrent: () => boolean, value?: DocumentTitlePreviewValue) => {
    if (!element || !id) return;
    const request = (requests.get(element) || 0) + 1;
    requests.set(element, request);
    const apply = (value: DocumentTitlePreviewValue) => {
        if (!element.isConnected || !isCurrent() ||
            requests.get(element) !== request) return;
        if (value.id !== id || notebook && value.notebook !== notebook) return;
        element.dataset.documentTitleId = id;
        element.dataset.notebookId = value.notebook;
        if (value.format !== "inline-ast") {
            element.classList.remove("b3-typography", "document-title-preview");
            delete element.dataset.protyleLiteRender;
            element.textContent = getDocDisplayName(value.text, value.empty);
            return;
        }
        const template = document.createElement("template");
        template.innerHTML = sanitizeKernelHTML(value.blockDOM);
        const content = template.content.querySelector('[data-type="NodeParagraph"] > [contenteditable]');
        if (!content) return;
        if (content.childNodes.length === 0) {
            element.textContent = getDocDisplayName(value.text, value.empty);
            return;
        }
        content.querySelectorAll(".protyle-action, .protyle-icons, .img__alt, .img__name, .protyle-attr, wbr")
            .forEach(item => item.remove());
        content.querySelectorAll("[contenteditable], [spellcheck]").forEach(item => {
            item.removeAttribute("contenteditable");
            item.removeAttribute("spellcheck");
        });
        // 导航预览移除源内容中的字号，跟随所在界面的字号。
        content.querySelectorAll<HTMLElement>("[style]").forEach(item => {
            item.style.removeProperty("font-size");
        });
        element.classList.add("b3-typography", "document-title-preview");
        element.dataset.protyleLiteRender = "safe";
        element.replaceChildren(...Array.from(content.childNodes));
        void mathRender(element);
    };
    if (value) {
        apply(value);
        return;
    }
    fetchPost("/api/block/getDocTitle", {id, notebook}, response => {
        if (response.code === 0 && response.data) apply(response.data);
    });
};
