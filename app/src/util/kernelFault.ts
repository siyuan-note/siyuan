import {Constants} from "../constants";
import {Dialog} from "../dialog";
import {forceQuit} from "../dialog/processSystem";
import {isBrowser, isKernelInContainer, isMobile} from "./functions";
import {isInIOS, isInMobileApp} from "../protyle/util/compatibility";

export const kernelError = () => {
    if (document.querySelector("#errorLog")) {
        return;
    }
    let title: string;
    let content: string;
    if (isInIOS()) {
        title = `🍵 ${window.siyuan.languages.pleaseWait} <small>v${Constants.SIYUAN_VERSION}</small>`;
        content = `<div class="b3-dialog__content">
    <div>${window.siyuan.languages.reconnectPrompt}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button">${window.siyuan.languages.retry}</button>
</div>`;
    } else {
        title = `💔 ${window.siyuan.languages.kernelFault0} <small>v${Constants.SIYUAN_VERSION}</small>`;
        content = `<div class="b3-dialog__content">
    <div>${window.siyuan.languages.kernelFault1}</div>
    <div class="fn__hr"></div>
    <div><strong>${window.siyuan.languages.kernelFault3}</strong></div>
    <div class="fn__hr"></div>
    <ol class="fn__list">
    ${(isKernelInContainer()
        ? [
            [window.siyuan.languages.kernelFault4, window.siyuan.languages.kernelFault5],
            [window.siyuan.languages.kernelFault6, window.siyuan.languages.kernelFault7],
        ]
        : [
            [window.siyuan.languages.kernelFault6, window.siyuan.languages.kernelFault8],
            [window.siyuan.languages.kernelFault9, window.siyuan.languages.kernelFault10],
        ]
    ).map(([tipTitle, tipDesc]) => `<li><strong>${tipTitle}</strong><div class="fn__hr"></div><div>${tipDesc}</div><div class="fn__hr"></div></li>`).join("")}
    </ol>
    <div class="ft__on-surface">${window.siyuan.languages.kernelFault2}</div>
</div>
${isBrowser() && !isInMobileApp() ? "" : `<div class="b3-dialog__action">
    <button class="b3-button">${window.siyuan.languages.safeQuit}</button>
</div>`}`;
    }
    const dialog = new Dialog({
        disableClose: true,
        title: title,
        width: isMobile() ? "92vw" : "560px",
        content,
    });
    dialog.element.id = "errorLog";
    dialog.element.setAttribute("data-key", Constants.DIALOG_KERNELFAULT);
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    if (isInIOS()) {
        btnsElement[0].addEventListener("click", () => {
            dialog.destroy();
            window.webkit.messageHandlers.startKernelFast.postMessage("startKernelFast");
        });
    } else {
        const btn = btnsElement[0];
        if (btn) {
            btn.addEventListener("click", () => {
                dialog.destroy();
                forceQuit();
            });
        }
    }
};
