import {waitForWindowPaint} from "../util/windowPaint";

const INITIAL_EDITOR_WAIT_LIMIT = 5000;

// 等待当前可见文档的首次渲染，加载失败或未完成时仍允许用户进入窗口处理。
const waitForInitialEditors = async () => {
    const layouts = document.getElementById("layouts");
    if (!layouts) return;
    const editors = Array.from(layouts.querySelectorAll<HTMLElement>(".layout-tab-container > .protyle"))
        .filter(editor => !editor.closest(".fn__none"));
    const isPending = () => editors.some(editor => editor.isConnected &&
        !editor.closest(".fn__none") && editor.dataset.loading !== "finished");
    if (!isPending()) return;
    await new Promise<void>(resolve => {
        const finish = () => {
            observer.disconnect();
            window.clearTimeout(timer);
            resolve();
        };
        const observer = new MutationObserver(() => {
            if (!isPending()) finish();
        });
        const timer = window.setTimeout(finish, INITIAL_EDITOR_WAIT_LIMIT);
        observer.observe(layouts, {attributes: true, attributeFilter: ["data-loading", "class"], childList: true, subtree: true});
        if (!isPending()) finish();
    });
};

export const initWindowWithLoading = async (render: () => Promise<void>) => {
    document.getElementById("loading")?.setAttribute("aria-label", window.siyuan.languages.loading);
    await waitForWindowPaint(async () => {
        await render();
        await waitForInitialEditors();
    });
    document.getElementById("windowAppearanceStyle")?.remove();
    document.getElementById("loading")?.remove();
    document.body.removeAttribute("aria-busy");
};
