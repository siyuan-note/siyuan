import {App} from "../index";
import {Constants} from "../constants";
import {genIconHTML} from "../protyle/render/util";

export const customBlockRender = (app: App, element: Element) => {
    // TODO
    let abcElements: Element[] | NodeListOf<Element> = [];
    if (element.getAttribute("data-subtype") === "abc" && element.getAttribute("data-render") !== "true") {
        abcElements = [element];
    } else {
        abcElements = element.querySelectorAll('[data-subtype="abc"]:not([data-render="true"])');
    }
    if (abcElements.length === 0) {
        return;
    }
    abcElements.forEach((e: HTMLDivElement) => {
        e.setAttribute("data-render", "true");
        if (!e.firstElementChild.classList.contains("protyle-icons")) {
            e.insertAdjacentHTML("afterbegin", genIconHTML());
        }
        if (e.childElementCount < 4) {
            e.lastElementChild.insertAdjacentHTML("beforebegin", `<span style="position: absolute">${Constants.ZWSP}</span>`);
        }
        const renderElement = e.firstElementChild.nextElementSibling as HTMLElement;
        renderElement.setAttribute("contenteditable", "false");
    });
};
