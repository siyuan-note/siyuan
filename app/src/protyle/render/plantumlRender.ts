import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {genIconHTML} from "./util";
import {hasClosestByClassName} from "../util/hasClosest";
import {getHostCapabilities} from "../../util/hostCapabilities";

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
                const imageElement = document.createElement("img");
                imageElement.src = url;
                if (getHostCapabilities().remoteKernel) {
                    renderElement.replaceChildren(imageElement);
                    renderElement.classList.remove("ft__error");
                    return;
                }
                const objectElement = document.createElement("object");
                objectElement.type = "image/svg+xml";
                objectElement.data = url;
                renderElement.replaceChildren(objectElement);
                renderElement.classList.remove("ft__error");
                objectElement.addEventListener("error", () => {
                    renderElement.replaceChildren(imageElement);
                });
            } catch (error) {
                renderElement.classList.add("ft__error");
                renderElement.textContent = `plantuml render error: ${error}`;
            }
        });
    });
};
