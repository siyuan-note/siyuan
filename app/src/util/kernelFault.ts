import {Constants} from "../constants";
import {Dialog} from "../dialog";
import {isKernelInContainer, isMobile} from "./functions";
import {isInIOS} from "../protyle/util/compatibility";

export const kernelError = () => {
    if (document.querySelector("#errorLog")) {
        return;
    }
    let title = `💔 ${window.siyuan.languages.kernelFault0} <small>v${Constants.SIYUAN_VERSION}</small>`;
    let body = `<div>${window.siyuan.languages.kernelFault1}</div>
<div class="fn__hr"></div>
<div>${window.siyuan.languages.kernelFault3}</div>
<div>${isKernelInContainer() ? window.siyuan.languages.kernelFault4 : window.siyuan.languages.kernelFault5}</div>
<div class="fn__hr"></div>
<div>${window.siyuan.languages.kernelFault2}</div>
<div class="b3-dialog__action">
    <div class="fn__flex-1"></div>
    <button class="b3-button">${window.siyuan.languages.kernelFault6}</button>
</div>`;
    if (isInIOS()) {
        title = `🍵 ${window.siyuan.languages.pleaseWait} <small>v${Constants.SIYUAN_VERSION}</small>`;
        body = `<div>${window.siyuan.languages.reconnectPrompt}</div><div class="fn__hr"></div><div class="fn__flex"><div class="fn__flex-1"></div><button class="b3-button">${window.siyuan.languages.retry}</button></div>`;
    }
    const dialog = new Dialog({
        disableClose: true,
        title: title,
        width: isMobile() ? "92vw" : "520px",
        content: `<div class="b3-dialog__content">
<div class="ft__breakword">
    ${body}
</div>
</div>`
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
        btnsElement[0].addEventListener("click", () => {
            dialog.destroy();
            window.location.reload();
        });
    }
};
