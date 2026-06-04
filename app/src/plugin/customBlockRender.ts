import {App} from "../index";
import {genIconHTML} from "../protyle/render/util";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {getAllEditor} from "../layout/getAll";
import {updateTransaction} from "../protyle/wysiwyg/transaction";

/**
 * 将插件名和块名编码为 data-info 值，/ 转义为 \/
 */
export const encodeCustomBlockInfo = (pluginName: string, blockName: string) =>
    pluginName.replace(/\//g, "\\/") + "/" + blockName.replace(/\//g, "\\/");

/**
 * 从 data-info 值解码出插件名和块名
 */
export const decodeCustomBlockInfo = (info: string): { pluginName: string, blockName: string } | null => {
    let slashIdx = -1;
    for (let i = 0; i < info.length; i++) {
        if (info[i] === "/" && (i === 0 || info[i - 1] !== "\\")) {
            slashIdx = i;
            break;
        }
    }
    if (slashIdx === -1) {
        return null;
    }
    return {
        pluginName: info.substring(0, slashIdx).replace(/\\\//g, "/"),
        blockName: info.substring(slashIdx + 1).replace(/\\\//g, "/"),
    };
};

/**
 * 清除自定义块的所有渲染子元素
 */
const clearBlockContent = (item: Element) => {
    for (let i = item.children.length - 1; i >= 0; i--) {
        item.children[i].remove();
    }
};

/**
 * 为自定义块元素创建 setContent 回调
 *
 * 修改 data-content 后重新渲染，发送给后端的是不含渲染子 DOM 的干净 HTML
 */
const createSetContent = (app: App, element: Element) => (newContent: string) => {
    const oldContent = Lute.UnEscapeHTMLStr(element.getAttribute("data-content") || "");
    if (newContent === oldContent) return;

    const id = element.getAttribute("data-node-id") || "";
    if (!id) return;

    /** 找到对应的编辑器 */
    for (const editor of getAllEditor()) {
        if (editor.protyle.wysiwyg?.element.contains(element)) {
            const oldHTML = element.outerHTML;
            element.setAttribute("data-content", Lute.EscapeHTMLStr(newContent));
            clearBlockContent(element);
            renderBlock(app, element, hasClosestByClassName(element, "protyle-wysiwyg", true));
            updateTransaction(editor.protyle, id, element.outerHTML, oldHTML);
            return;
        }
    }
};

/**
 * 渲染单个自定义块元素
 *
 * 统一流程：确保 icons → 清除旧内容 → 调用插件 render 或显示 fallback
 */
const renderBlock = (app: App, item: Element, wysiwygElement: false | HTMLElement) => {
    const info = item.getAttribute("data-info") || "";
    /** data-content 经 Lute.EscapeHTMLStr 转义，需要还原后传给插件 */
    const content = Lute.UnEscapeHTMLStr(item.getAttribute("data-content") || "");

    if (!item.querySelector(".protyle-icons")) {
        item.insertAdjacentHTML("afterbegin", genIconHTML(wysiwygElement));
    }
    clearBlockContent(item);

    const decoded = decodeCustomBlockInfo(info);
    let rendered = false;
    if (decoded) {
        const plugin = (app.plugins || []).find(p => p.name === decoded.pluginName);
        const renderer = plugin?.customBlockRenders[decoded.blockName];
        if (renderer) {
            try {
                renderer.render({app, element: item, content, setContent: createSetContent(app, item)});
                rendered = true;
            } catch (e) {
                console.error(`[CustomBlock] plugin ${plugin.name} render error:`, e);
            }
        }
    }

    if (!rendered) {
        const fallback = document.createElement("div");
        fallback.style.cssText = "padding: 8px; color: var(--b3-theme-on-surface-light); font-size: 12px;";
        const title = document.createElement("div");
        title.style.cssText = "margin-bottom: 4px; font-weight: 500;";
        title.textContent = `Custom Block: ${info}`;
        const pre = document.createElement("pre");
        pre.style.cssText = "margin: 0; white-space: pre-wrap; word-break: break-all;";
        pre.textContent = content;
        fallback.append(title, pre);
        item.appendChild(fallback);
    }
};

/**
 * 渲染 element 内所有自定义块
 *
 * 自定义块不使用 data-render 做持久化标记，每次调用都会重新渲染。
 * 这是因为插件可能随时加载/卸载，渲染结果不应被缓存。
 */
export const customBlockRender = (app: App, element: Element) => {
    let customElements: Element[];
    if (element.getAttribute("data-type") === "NodeCustomBlock") {
        customElements = [element];
    } else {
        customElements = Array.from(
            element.querySelectorAll('[data-type="NodeCustomBlock"]')
        );
    }
    if (customElements.length === 0) {
        return;
    }

    const wysiwygElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
    for (const item of customElements) {
        renderBlock(app, item, wysiwygElement);
    }
};

/**
 * 按插件名重新渲染所有编辑器中属于该插件的自定义块
 *
 * 用于插件启用/禁用时定向刷新，不影响其他插件的自定义块
 */
export const rerenderCustomBlocksByPlugin = (app: App, pluginName: string) => {
    getAllEditor().forEach(editor => {
        const wysiwyg = editor.protyle.wysiwyg;
        if (!wysiwyg) return;
        wysiwyg.element.querySelectorAll('[data-type="NodeCustomBlock"]').forEach((el: Element) => {
            const decoded = decodeCustomBlockInfo(el.getAttribute("data-info") || "");
            if (decoded?.pluginName !== pluginName) return;
            renderBlock(app, el, hasClosestByClassName(el, "protyle-wysiwyg", true));
        });
    });
};
