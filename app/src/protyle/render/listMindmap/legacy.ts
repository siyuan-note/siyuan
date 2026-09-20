import {highlightRender} from "../highlightRender";

let parser: Lute;

// 兼容旧内核、历史和导出中的渲染块 DOM，统一交给解析器转换为普通代码块。
export const normalizeLegacyMindmapCodes = (root: Element, cdn?: string) => {
    const selector = '[data-subtype="mindmap"]';
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (root.matches(selector)) {
        blocks.unshift(root as HTMLElement);
    }
    blocks.forEach(block => {
        if (!parser) {
            parser = Lute.New();
            parser.SetProtyleWYSIWYG(true);
            parser.SetKramdownIAL(true);
        }
        const template = document.createElement("template");
        const source = block.cloneNode(true) as HTMLElement;
        source.dataset.type = "NodeCodeBlock";
        source.dataset.nodeId = source.dataset.nodeId || Lute.NewNodeID();
        template.innerHTML = parser.SpinBlockDOM(source.outerHTML);
        const code = template.content.firstElementChild;
        if (!code?.classList.contains("code-block")) {
            return;
        }
        if (!block.hasAttribute("data-type")) {
            code.querySelectorAll<HTMLElement>('[contenteditable="true"]').forEach(element => {
                element.contentEditable = "false";
            });
        }
        block.replaceChildren(...Array.from(code.childNodes));
        block.classList.remove("render-node");
        block.classList.add("code-block");
        block.removeAttribute("data-subtype");
        block.removeAttribute("data-content");
        block.removeAttribute("data-render");
        highlightRender(block, cdn);
    });
};
