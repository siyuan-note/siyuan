export const genIconHTML = (element?: false|HTMLElement) => {
    let enable = true;
    if (element) {
        const readonly =  element.getAttribute("custom-sy-readonly");
        if (typeof readonly === "string") {
            enable = element.getAttribute("custom-sy-readonly") === "false";
        } else {
            return '<div class="protyle-icons"></div>';
        }
    }
    return `<div class="protyle-icons">
    <span aria-label="${window.siyuan.languages.edit}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-icon--first protyle-action__edit${enable ? "" : " fn__none"}"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span aria-label="${window.siyuan.languages.more}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__menu protyle-icon--last${enable ? "" : " protyle-icon--first"}"><svg><use xlink:href="#iconMore"></use></svg></span>
</div>`;
};
