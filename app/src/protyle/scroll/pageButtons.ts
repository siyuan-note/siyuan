export const PAGE_SCROLL_BUTTONS_CHANGED_EVENT = "siyuan-page-scroll-buttons-changed";

export const isPageScrollButtonsEnabled = () =>
    window.siyuan.config.editor.pageScrollButtons === true;

export const updatePageScrollButtons = () => {
    document.querySelectorAll(".protyle-scroll__page").forEach(element => {
        element.dispatchEvent(new Event(PAGE_SCROLL_BUTTONS_CHANGED_EVENT));
    });
    document.querySelectorAll<HTMLInputElement>('input[id="editor.pageScrollButtons"]').forEach(input => {
        input.checked = isPageScrollButtonsEnabled();
    });
};
