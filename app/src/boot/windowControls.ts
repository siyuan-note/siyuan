import {ipcRenderer} from "electron";
import {Constants} from "../constants";
import {setToolbarLeftMac} from "../util/functions";

// 主窗口和设置窗口共用本机窗口控件及其命令，关闭行为由各窗口提供。
export const initWindowControls = (container: HTMLElement, close: () => void) => {
    container.insertAdjacentHTML("beforeend", `<div class="toolbar__item ariaLabel toolbar__item--win" aria-label="${window.siyuan.languages.min}" id="minWindow">
    <svg><use xlink:href="#iconMin"></use></svg>
</div>
<div aria-label="${window.siyuan.languages.max}" class="ariaLabel toolbar__item toolbar__item--win" id="maxWindow">
    <svg><use xlink:href="#iconMax"></use></svg>
</div>
<div aria-label="${window.siyuan.languages.restore}" class="ariaLabel toolbar__item toolbar__item--win" id="restoreWindow">
    <svg><use xlink:href="#iconRestore"></use></svg>
</div>
<div aria-label="${window.siyuan.languages.close}" class="ariaLabel toolbar__item toolbar__item--close" id="closeWindow">
    <svg><use xlink:href="#iconClose"></use></svg>
</div>`);
    container.querySelector("#restoreWindow").addEventListener("click", () => {
        ipcRenderer.send(Constants.SIYUAN_CMD, "restore");
    });
    container.querySelector("#maxWindow").addEventListener("click", () => {
        ipcRenderer.send(Constants.SIYUAN_CMD, "maximize");
    });
    const minimize = container.querySelector("#minWindow");
    minimize.addEventListener("click", () => {
        if (!minimize.classList.contains("window-controls__item--disabled")) {
            ipcRenderer.send(Constants.SIYUAN_CMD, "minimize");
        }
    });
    container.querySelector("#closeWindow").addEventListener("click", close);
};

export const applyWindowState = (command: string) => {
    switch (command) {
        case "focus": document.body.classList.remove("body--blur"); break;
        case "blur": document.body.classList.add("body--blur"); break;
        case "maximize": document.body.classList.add("body--maximize"); break;
        case "unmaximize": document.body.classList.remove("body--maximize"); break;
        case "enter-full-screen":
        case "leave-full-screen":
            document.body.classList.toggle("body--fullscreen", command === "enter-full-screen");
            setToolbarLeftMac(window.siyuan.storage[Constants.LOCAL_ZOOM]);
            break;
    }
};
