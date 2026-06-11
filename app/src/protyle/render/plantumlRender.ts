import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {genIconHTML} from "./util";
import {hasClosestByClassName} from "../util/hasClosest";

export const plantumlRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let plantumlElements: Element[] | NodeListOf<Element> = [];
    if (element.getAttribute("data-subtype") === "plantuml" && element.getAttribute("data-render") !== "true") {
        plantumlElements = [element];
    } else {
        plantumlElements = element.querySelectorAll('[data-subtype="plantuml"]:not([data-render="true"])');
    }
    if (plantumlElements.length === 0) {
        return;
    }
    addScript(`${cdn}/js/plantuml/plantuml-encoder.min.js?v=0.0.0`, "protylePlantumlScript").then(() => {
        const wysiswgElement = hasClosestByClassName(element, "protyle-wysiwyg", true);
        plantumlElements.forEach((e: HTMLDivElement) => {
            e.setAttribute("data-render", "true");
            if (!e.firstElementChild.classList.contains("protyle-icons")) {
                e.insertAdjacentHTML("afterbegin", genIconHTML(wysiswgElement));
            }
            const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
            if (!e.getAttribute("data-content")) {
                renderElement.innerHTML = `<span style="position: absolute;left:0;top:0;width: 1px;">${Constants.ZWSP}</span>`;
                return;
            }
            try {
                const url = `${window.siyuan.config.editor.plantUMLServePath}${window.plantumlEncoder.encode(Lute.UnEscapeHTMLStr(e.getAttribute("data-content")))}`;
                renderElement.innerHTML = `<object type="image/svg+xml" data="${url}"/>`;
                renderElement.classList.remove("ft__error");
                renderElement.firstElementChild.addEventListener("error", () => {
                    renderElement.innerHTML = `<img src=${url}">`;
                });
            } catch (error) {
                renderElement.classList.add("ft__error");
                renderElement.innerHTML = `plantuml render error: <br>${error}`;
            }
        });
    });
};
