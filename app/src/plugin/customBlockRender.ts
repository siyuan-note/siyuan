import {App} from "../index";
import {genIconHTML} from "../protyle/render/util";
import {hasClosestByClassName} from "../protyle/util/hasClosest";

/**
 * 渲染自定义块
 *
 * 遍历 element 内所有未渲染的 [data-type="NodeCustomBlock"] 元素，
 * 查找插件注册的 customBlockRenders 中匹配 data-info 的渲染器并调用。
 */
export const customBlockRender = (app: App, element: Element) => {
    let customElements: Element[] = [];
    if (element.getAttribute("data-type") === "NodeCustomBlock"
        && element.getAttribute("data-render") !== "true") {
        customElements = [element];
    } else {
        customElements = Array.from(
            element.querySelectorAll('[data-type="NodeCustomBlock"]:not([data-render="true"])')
        );
    }
    if (customElements.length === 0) {
        return;
    }

    const wysiwygElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
    for (const item of customElements) {
        const info = item.getAttribute("data-info") || "";
        const content = item.getAttribute("data-content") || "";

        if (!item.querySelector(".protyle-icons")) {
            item.insertAdjacentHTML("afterbegin", genIconHTML(wysiwygElement));
        }

        let rendered = false;
        for (const plugin of (app.plugins || [])) {
            const renderer = plugin.customBlockRenders[info];
            if (renderer) {
                try {
                    renderer.render({app, element: item, content});
                    rendered = true;
                } catch (e) {
                    console.error(`[CustomBlock] plugin ${plugin.name} render error:`, e);
                }
                break;
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

            const iconsEl = item.querySelector(".protyle-icons");
            if (iconsEl?.nextElementSibling) {
                iconsEl.nextElementSibling.remove();
            }
            item.appendChild(fallback);
        }

        item.setAttribute("data-render", "true");
    }
};
