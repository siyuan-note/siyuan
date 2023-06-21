/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {Dialog} from "../../dialog";
import {isMobile} from "../../util/functions";
import {fetchPost} from "../../util/fetch";

export const setProxy = () => {
    /// #if !BROWSER
    if ("" === window.siyuan.config.system.networkProxy.scheme) {
        console.log("network proxy [system]");
        return;
    }

    const session = getCurrentWindow().webContents.session;
    session.closeAllConnections().then(() => {
        const proxyURL = `${window.siyuan.config.system.networkProxy.scheme}://${window.siyuan.config.system.networkProxy.host}:${window.siyuan.config.system.networkProxy.port}`;
        session.setProxy({proxyRules: proxyURL}).then(
            () => console.log("network proxy [" + proxyURL + "]"),
        );
    });
    /// #endif
};

export const setAccessAuthCode = () => {
    const dialog = new Dialog({
        title: window.siyuan.languages.about5,
        content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.about5}" value="${window.siyuan.config.accessAuthCode}">
    <div class="b3-label__text">${window.siyuan.languages.about6}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(inputElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    inputElement.select();
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        fetchPost("/api/system/setAccessAuthCode", {accessAuthCode: inputElement.value});
    });
};

export const getCloudURL = (key: string) => {
    const origin = window.siyuan.config.cloudRegion === 0 ? "https://ld246.com" : "https://liuyun.io";
    return `${origin}/${key}`;
};
