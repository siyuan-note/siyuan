import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {genIconHTML} from "./util";

export const abcRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
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
        addScript(`${cdn}/js/abcjs/abcjs-basic-min.js?v=6.2.2`, "protyleAbcjsScript").then(() => {
            abcElements.forEach((e: HTMLDivElement) => {
                if (e.getAttribute("data-render") === "true") {
                    return;
                }
                if(!e.firstElementChild.classList.contains("protyle-icons")) {
                    e.insertAdjacentHTML("afterbegin", genIconHTML());
                }
                const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
                renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span><div contenteditable="false"></div>`;
                window.ABCJS.renderAbc(renderElement.lastElementChild, Lute.UnEscapeHTMLStr(e.getAttribute("data-content")), {
                    responsive: "resize"
                });
                e.setAttribute("data-render", "true");
            });
        });
    }
};
