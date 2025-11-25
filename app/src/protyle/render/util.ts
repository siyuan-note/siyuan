import { isInEmbedBlock } from "../util/hasClosest";
import { Constants } from "../../constants";

export const genIconHTML = (element?: false | HTMLElement, actions = ["edit", "more"]) => {
    let enable = true;
    if (element) {
        const readonly = element.getAttribute("data-readonly");
        if (typeof readonly === "string") {
            enable = readonly === "false";
        } else {
            return '<div class="protyle-icons"></div>';
        }
    }
    const mapActionToHTML = (action: string, isFirst: boolean, isLast: boolean) => {
        const classList = ["ariaLabel", "protyle-icon"];
        if (isFirst) classList.push("protyle-icon--first");
        if (isLast) classList.push("protyle-icon--last");
        let aria = "";
        let className = "";
        let icon = "";
        switch (action) {
            case "reload":
            case "refresh":
                aria = window.siyuan.languages.refresh;
                className = "protyle-action__reload";
                icon = "iconRefresh";
                break;
            case "home":
            case "fit":
                aria = window.siyuan.languages.reset;
                className = "protyle-action__home";
                icon = "#iconHistory";
                break;
            case "edit":
                aria = window.siyuan.languages.edit;
                className = "protyle-action__edit";
                icon = "iconEdit";
                break;
            case "more":
            default:
                aria = window.siyuan.languages.more;
                className = "protyle-action__menu";
                icon = "iconMore";
                break;
        }
        // Only the edit button honors read-only enable
        const hidden = (action === "edit" && !enable) ? " fn__none" : "";
        return `<span aria-label="${aria}" data-position="4north" class="${classList.join(" ")} ${className}${hidden}"><svg><use xlink:href="#${icon}"></use></svg></span>`;
    };
    const res: string[] = [];
    for (let i = 0; i < actions.length; i++) {
        const isFirst = i === 0;
        const isLast = i === actions.length - 1;
        res.push(mapActionToHTML(actions[i], isFirst, isLast));
    }
    return `<div class="protyle-icons">
    ${res.join("\n    ")}
</div>`;
};

export const genRenderFrame = (renderElement: Element) => {
    if (renderElement.querySelector(".protyle-cursor")) {
        return;
    }
    const type = renderElement.getAttribute("data-type");
    if (type === "NodeBlockQueryEmbed") {
        renderElement.insertAdjacentHTML("afterbegin", `<div class="protyle-icons${isInEmbedBlock(renderElement) ? " fn__none" : ""}">
    <span aria-label="${window.siyuan.languages.refresh}" data-position="4north" class="ariaLabel protyle-icon protyle-action__reload protyle-icon--first"><svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg></span>
    <span aria-label="${window.siyuan.languages.update} SQL" data-position="4north" class="ariaLabel protyle-icon protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span aria-label="${window.siyuan.languages.more}" data-position="4north" class="ariaLabel protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span>
</div><div class="protyle-cursor">${Constants.ZWSP}</div>`);
    } else if (type === "NodeMathBlock" || renderElement.getAttribute("data-subtype") === "math") {
        renderElement.firstElementChild.innerHTML = `<span></span><span class="protyle-cursor">${Constants.ZWSP}</span>`;
    }
};

export const processClonePHElement = (item: Element) => {
    item.querySelectorAll("protyle-html").forEach((phElement) => {
        phElement.setAttribute("data-content", Lute.UnEscapeHTMLStr(phElement.getAttribute("data-content")));
    });
    return item;
};
