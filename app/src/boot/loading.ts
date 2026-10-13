import {waitForWindowPaint} from "../util/windowPaint";
import {Constants} from "../constants";

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

// 等当前 Dock 的布局动画结束，避免首次显示后再调整顶部页签。
const waitForLayoutTransitions = async () => {
    const animations = Array.from(document.querySelectorAll<HTMLElement>(".layout__dockl, .layout__dockr, .layout__dockb"))
        .flatMap(element => element.getAnimations())
        .filter(animation => animation.playState === "running" &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime));
    if (!animations.length) return;
    let timer: number;
    try {
        // 自定义动画超过内置过渡时长时继续进入界面，避免动画阻塞加载。
        await Promise.race([
            Promise.all(animations.map(animation => animation.finished.catch(() => {}))),
            new Promise<void>(resolve => { timer = window.setTimeout(resolve, Constants.TIMEOUT_TRANSITION); }),
        ]);
    } finally {
        window.clearTimeout(timer);
    }
};

export const initWindowWithLoading = async (render: () => Promise<void>, finalizeLayout?: () => void) => {
    document.getElementById("loading")?.setAttribute("aria-label", window.siyuan.languages.loading);
    await waitForWindowPaint(async () => {
        await render();
        await waitForInitialEditors();
        await waitForLayoutTransitions();
        finalizeLayout?.();
    });
    document.getElementById("windowAppearanceStyle")?.remove();
    document.getElementById("loading")?.remove();
    document.body.removeAttribute("aria-busy");
};
