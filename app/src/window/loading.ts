import {waitForWindowPaint} from "../util/windowPaint";

export const initWindowWithLoading = async (render: () => Promise<void>) => {
    document.getElementById("loading")?.setAttribute("aria-label", window.siyuan.languages.loading);
    await waitForWindowPaint(render);
    document.getElementById("windowAppearanceStyle")?.remove();
    document.getElementById("loading")?.remove();
    document.body.removeAttribute("aria-busy");
};
