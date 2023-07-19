import {App} from "../index";
import {Constants} from "../constants";
import {genIconHTML} from "../protyle/render/util";

export const customBlockRender = (app: App, element: Element) => {
    // TODO
    let abcElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "abc") {
        // 编辑器内代码块编辑渲染
        abcElements = [element];
    } else {
        abcElements = Array.from(element.querySelectorAll('[data-subtype="abc"]'));
    }
    if (abcElements.length === 0) {
        return;
    }
    if (abcElements.length > 0) {
        abcElements.forEach((e: HTMLDivElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", genIconHTML());
            }
            if (e.childElementCount < 4) {
                e.lastElementChild.insertAdjacentHTML("beforebegin", `<span style="position: absolute">${Constants.ZWSP}</span>`);
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;

            renderElement.setAttribute("contenteditable", "false");
            e.setAttribute("data-render", "true");
        });
    }
};
