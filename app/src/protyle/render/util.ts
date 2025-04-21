import {isInEmbedBlock} from "../util/hasClosest";
import {Constants} from "../../constants";

export const genIconHTML = (element?: false | HTMLElement) => {
    let enable = true;
    if (element) {
        const readonly = element.getAttribute("data-readonly");
        if (typeof readonly === "string") {
            enable = readonly === "false";
        } else {
            return '<div class="protyle-icons"></div>';
        }
    }
    return `<div class="protyle-icons">
    <span aria-label="${window.siyuan.languages.edit}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-icon--first protyle-action__edit${enable ? "" : " fn__none"}"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span aria-label="${window.siyuan.languages.more}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__menu protyle-icon--last${enable ? "" : " protyle-icon--first"}"><svg><use xlink:href="#iconMore"></use></svg></span>
</div>`;
};

export const genRenderFrame = (renderElement: Element) => {
    if (renderElement.querySelector(".protyle-cursor")) {
        return;
    }
    const type = renderElement.getAttribute("data-type");
    if (type === "NodeBlockQueryEmbed") {
        renderElement.insertAdjacentHTML("afterbegin", `<div class="protyle-icons${isInEmbedBlock(renderElement) ? " fn__none" : ""}">
    <span aria-label="${window.siyuan.languages.refresh}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__reload protyle-icon--first"><svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg></span>
    <span aria-label="${window.siyuan.languages.update} SQL" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span aria-label="${window.siyuan.languages.more}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span>
</div><div class="protyle-cursor">${Constants.ZWSP}</div>`);
    } else if (type === "NodeMathBlock" || renderElement.getAttribute("data-subtype") === "math") {
        renderElement.firstElementChild.innerHTML = `<span></span><span class="protyle-cursor">${Constants.ZWSP}</span>`;
    }
};

export const processClonePHElement = (item: Element) => {
    if (item.getAttribute("data-type") === "NodeHTMLBlock") {
        const phElement = item.querySelector("protyle-html");
        phElement.setAttribute("data-content", Lute.UnEscapeHTMLStr(phElement.getAttribute("data-content")));
    }
    return item;
};
