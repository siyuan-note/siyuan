import {addScript} from "../util/addScript";
import {Constants} from "../../constants";

declare const plantumlEncoder: {
    encode(options: string): string,
};

export const plantumlRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let plantumlElements: Element[] = [];
    if (element.getAttribute("data-subtype") === "plantuml") {
        // 编辑器内代码块编辑渲染
        plantumlElements = [element];
    } else {
        plantumlElements = Array.from(element.querySelectorAll('[data-subtype="plantuml"]'));
    }
    if (plantumlElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/plantuml/plantuml-encoder.min.js?v=0.0.0`, "protylePlantumlScript").then(() => {
        plantumlElements.forEach((e: HTMLDivElement) => {
            if (e.getAttribute("data-render") === "true") {
                return;
            }
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", '<div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div>');
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
            try {
                renderElement.innerHTML = `<img src=${window.siyuan.config.editor.plantUMLServePath}${plantumlEncoder.encode(Lute.UnEscapeHTMLStr(e.getAttribute("data-content")))}">`;
                renderElement.classList.remove("ft__error");
                e.setAttribute("data-render", "true");
            } catch (error) {
                renderElement.classList.add("ft__error");
                renderElement.innerHTML = `plantuml render error: <br>${error}`;
            }
        });
    });
};
