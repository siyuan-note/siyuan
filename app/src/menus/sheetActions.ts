import {escapeAttr, escapeHtml} from "../util/escape";

export const getSheetActionsHTML = () => `<div class="b3-menu__actions">
    <button type="button" class="block__icon block__icon--show block__icon--touch ariaLabel" data-type="sheet-expand" aria-expanded="false" aria-label="${escapeAttr(window.siyuan.languages.fullscreen)}">
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </button>
    <button type="button" class="b3-button b3-button--text" data-type="sheet-close">${escapeHtml(window.siyuan.languages.close)}</button>
</div>`;

export const setSheetExpanded = (menuElement: HTMLElement, expanded: boolean) => {
    menuElement.classList.toggle("b3-menu--expanded", expanded);
    const button = menuElement.querySelector<HTMLElement>('[data-type="sheet-expand"]');
    button?.setAttribute("aria-expanded", String(expanded));
    button?.setAttribute("aria-label", expanded ? window.siyuan.languages.exitFullscreen : window.siyuan.languages.fullscreen);
    button?.querySelector("use")?.setAttribute("xlink:href", expanded ? "#iconFullscreenExit" : "#iconFullscreen");
};
