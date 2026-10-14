import {Dialog} from "./index";
import {fetchSyncPost} from "../util/fetch";
import {withFetchTimeout} from "../util/fetchTimeout";
import {escapeHtml} from "../util/escape";
import {progressLoading} from "./progress";

let pendingExit: Promise<void>;

// 保留退出结果的接收窗口，慢同步不会直接关闭宿主。
export const requestSystemExit = (options: {
    force: boolean,
    setCurrentWorkspace: boolean,
    execInstallPkg?: number,
}, onResponse: (response: IWebSocketData) => void): Promise<void> => {
    if (pendingExit) {
        return pendingExit;
    }
    const languages = window.siyuan.languages;
    const progressID = "exitProgress";
    progressLoading({code: 1, msg: languages.exitWaiting}, progressID);
    // 等待退出时阻止输入，避免遮罩下仍有编辑器保留焦点并接收修改。
    const blockInput = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    const inputEvents = ["keydown", "beforeinput", "paste", "drop"];
    inputEvents.forEach(type => window.addEventListener(type, blockInput, true));
    pendingExit = withFetchTimeout(signal => fetchSyncPost("/api/system/exit", options, undefined, false, signal),
        undefined, 10 * 60 * 1000).then(response => {
        if (!response || ![0, 1, 2].includes(response.code)) {
            throw new Error(response?.msg || languages.exitWaitFailed);
        }
        progressLoading({code: 2, msg: ""}, progressID);
        return response;
    }).catch(error => {
        console.warn("exit request failed", error);
        // 请求失败不代表内核已经停止；保留界面供用户重试，并继续接收内核退出事件。
        progressLoading({code: 2, msg: ""}, progressID);
        const errorDialog = new Dialog({
            disableClose: true,
            disableAnimation: true,
            width: "480px",
            content: `<div class="b3-dialog__content" role="alert">${escapeHtml(languages.exitWaitFailed)}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${escapeHtml(languages.close)}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text">${escapeHtml(languages.retry)}</button>
</div>`,
        });
        const buttons = errorDialog.element.querySelectorAll("button");
        buttons[0].addEventListener("click", () => errorDialog.destroy());
        buttons[1].addEventListener("click", () => {
            errorDialog.destroy();
            void requestSystemExit(options, onResponse);
        });
        buttons[1].focus();
        return undefined;
    }).finally(() => {
        inputEvents.forEach(type => window.removeEventListener(type, blockInput, true));
        pendingExit = undefined;
    }).then(response => {
        if (response) {
            onResponse(response);
        }
    });
    return pendingExit;
};
