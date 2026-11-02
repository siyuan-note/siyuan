import {escapeAttr} from "../util/escape";

export const getSheetExpandButtonHTML = () => `<button type="button" class="block__icon block__icon--show block__icon--touch ariaLabel" data-type="sheet-expand" aria-expanded="false" aria-label="${escapeAttr(window.siyuan.languages.fullscreen)}">
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </button>`;

export const getSheetActionsHTML = (dialog = false) => `<div class="${dialog ? "b3-dialog__action" : "b3-menu__actions"}">
    ${getSheetExpandButtonHTML()}${dialog ? '<div class="fn__flex-1"></div>' : ""}
</div>`;

export const setSheetExpanded = (menuElement: HTMLElement, expanded: boolean) => {
    menuElement.classList.toggle("b3-menu--expanded", expanded);
    const button = menuElement.querySelector<HTMLElement>('[data-type="sheet-expand"]');
    button?.setAttribute("aria-expanded", String(expanded));
    button?.setAttribute("aria-label", expanded ? window.siyuan.languages.exitFullscreen : window.siyuan.languages.fullscreen);
    button?.querySelector("use")?.setAttribute("xlink:href", expanded ? "#iconFullscreenExit" : "#iconFullscreen");
};
