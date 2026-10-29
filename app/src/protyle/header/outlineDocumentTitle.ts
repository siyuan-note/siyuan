import {fetchPost} from "../../util/fetch";
import {sanitizeKernelHTML} from "../../util/hostCapabilities";
import {mathRender} from "../render/mathRender";
import {getDocDisplayName} from "../../util/pathName";

// 只更新当前仍在面板内的文字节点；切换文档、锁定或清空会移除旧节点，使迟到响应失效。
export const renderOutlineDocumentTitle = (element: HTMLElement, id: string, notebook: string,
                                            isCurrent: () => boolean) => {
    if (!element || !id) return;
    fetchPost("/api/block/getDocTitle", {id, notebook}, response => {
        if (response.code !== 0 || !response.data || !element.isConnected || !isCurrent()) return;
        const value = response.data;
        if (value.id !== id || notebook && value.notebook !== notebook) return;
        element.dataset.documentTitleId = id;
        if (value.format !== "inline-ast") {
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
        element.classList.add("b3-typography", "outline-document-title");
        element.dataset.protyleLiteRender = "safe";
        element.replaceChildren(...Array.from(content.childNodes));
        void mathRender(element);
    });
};
