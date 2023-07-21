export const genIconHTML = () => {
    return `<div class="protyle-icons">
    <span aria-label="${window.siyuan.languages.edit}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
    <span aria-label="${window.siyuan.languages.more}" class="b3-tooltips__nw b3-tooltips protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span>
</div>`;
};
