import {isInEmbedBlock} from "../util/hasClosest";
import {Constants} from "../../constants";
import {addStyle} from "../util/addStyle";

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
    if (actions.length === 3) {
        return `<div class="protyle-icons">
    <span aria-label="${window.siyuan.languages.refresh}" data-position="4north" class="ariaLabel protyle-icon protyle-icon--first protyle-action__reload"><svg><use xlink:href="#iconRefresh"></use></svg></span>
    <span aria-label="${window.siyuan.languages.edit}" data-position="4north" class="ariaLabel protyle-icon protyle-action__edit${enable ? "" : " fn__none"}"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span aria-label="${window.siyuan.languages.more}" data-position="4north" class="ariaLabel protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span>
</div>`;
    } else {
        return `<div class="protyle-icons">
    <span aria-label="${window.siyuan.languages.edit}" data-position="4north" class="ariaLabel protyle-icon protyle-icon--first protyle-action__edit${enable ? "" : " fn__none"}"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span aria-label="${window.siyuan.languages.more}" data-position="4north" class="ariaLabel protyle-icon protyle-action__menu protyle-icon--last${enable ? "" : " protyle-icon--first"}"><svg><use xlink:href="#iconMore"></use></svg></span>
</div>`;
    }
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

export const setCodeTheme = (cdn = Constants.PROTYLE_CDN) => {
    const protyleHljsStyle = document.getElementById("protyleHljsStyle") as HTMLLinkElement;
    let css;
    if (window.siyuan.config.appearance.mode === 0) {
        css = window.siyuan.config.appearance.codeBlockThemeLight;
        if (!Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE.includes(css)) {
            css = "default";
        }
    } else {
        css = window.siyuan.config.appearance.codeBlockThemeDark;
        if (!Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE.includes(css)) {
            css = "github-dark";
        }
    }
    const href = `${cdn}/js/highlight.js/styles/${css}.min.css?v=11.11.1`;
    if (!protyleHljsStyle) {
        addStyle(href, "protyleHljsStyle");
    } else if (!protyleHljsStyle.href.includes(href)) {
        protyleHljsStyle.remove();
        addStyle(href, "protyleHljsStyle");
    }
};
