import {waitForWindowPaint} from "../../util/windowPaint";

let finishInitialView: (() => void) | undefined;

// 首个文档或空白页就绪时通知启动流程，后续切换仍沿用已有界面显隐逻辑。
export const finishMobileStartup = () => {
    if (finishInitialView) {
        finishInitialView();
        return;
    }
    const loading = document.getElementById("loading");
    if (loading && !loading.classList.contains("startup-error")) {
        loading.remove();
        document.body.style.removeProperty("background-color");
    }
};

export const initMobileWithLoading = async (render: () => Promise<void>) => {
    const initialView = new Promise<void>(resolve => { finishInitialView = resolve; });
    document.body.setAttribute("aria-busy", "true");
    document.getElementById("loading")?.setAttribute("aria-label", window.siyuan.languages.loading);
    try {
        await waitForWindowPaint(async () => {
            await render();
            await initialView;
        });
        finishInitialView = undefined;
        finishMobileStartup();
        document.body.removeAttribute("aria-busy");
    } finally {
        finishInitialView = undefined;
    }
};
