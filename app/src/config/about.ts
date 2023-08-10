import {Constants} from "../constants";
/// #if !BROWSER
import {ipcRenderer, shell} from "electron";
/// #endif
import {isBrowser} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {setAccessAuthCode, setProxy} from "./util/about";
import {exportLayout} from "../layout/util";
import {exitSiYuan, processSync} from "../dialog/processSystem";
import {openByMobile, writeText} from "../protyle/util/compatibility";
import {showMessage} from "../dialog/message";
import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {setKey} from "../sync/syncGuide";

export const about = {
    element: undefined as Element,
    genHTML: () => {
        return `<label class="fn__flex b3-label${isBrowser() || "std" !== window.siyuan.config.system.container || "linux" === window.siyuan.config.system.os ? " fn__none" : ""}">
    <div class="fn__flex-1">
        ${window.siyuan.languages.autoLaunch}
        <div class="b3-label__text">${window.siyuan.languages.autoLaunchTip}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="autoLaunch" type="checkbox"${window.siyuan.config.system.autoLaunch ? " checked" : ""}>
</label>
<label class="fn__flex b3-label${isBrowser() || window.siyuan.config.system.isMicrosoftStore || window.siyuan.config.system.container !== "std" ? " fn__none" : ""}">
    <div class="fn__flex-1">
        ${window.siyuan.languages.autoDownloadUpdatePkg}
        <div class="b3-label__text">${window.siyuan.languages.autoDownloadUpdatePkgTip}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="downloadInstallPkg" type="checkbox"${window.siyuan.config.system.downloadInstallPkg ? " checked" : ""}>
</label>
<label class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.googleAnalytics}
        <div class="b3-label__text">${window.siyuan.languages.googleAnalyticsTip}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="googleAnalytics" type="checkbox"${window.siyuan.config.system.disableGoogleAnalytics ? "" : " checked"}>
</label>
<label class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about9}
        <div class="b3-label__text">${window.siyuan.languages.about10}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="uploadErrLog" type="checkbox"${window.siyuan.config.system.uploadErrLog ? " checked" : ""}>
</label>
<label class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about11}
        <div class="b3-label__text">${window.siyuan.languages.about12}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="networkServe" type="checkbox"${window.siyuan.config.system.networkServe ? " checked" : ""}>
</label>
<label class="b3-label config__item${isBrowser() ? " fn__none" : " fn__flex"}">
    <div class="fn__flex-1">
       ${window.siyuan.languages.about2}
        <div class="b3-label__text">${window.siyuan.languages.about3.replace("${port}", location.port)}</div>
        <span class="b3-label__text"><code class="fn__code">${window.siyuan.config.localIPs.join("</code> <code class='fn__code'>")}</code></span>
      
    </div>
    <div class="fn__space"></div>
    <button data-type="open" data-url="http://${window.siyuan.config.system.networkServe ? window.siyuan.config.localIPs[0] : "127.0.0.1"}:${location.port}" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconLink"></use></svg>${window.siyuan.languages.about4}
    </button>
</label>
<label class="b3-label fn__flex config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about5}
        <div class="b3-label__text">${window.siyuan.languages.about6}</div>
    </div>
    <div class="fn__space"></div>
    <button class="fn__flex-center b3-button b3-button--outline fn__size200" id="authCode">
        <svg><use xlink:href="#iconLock"></use></svg>${window.siyuan.languages.config}
    </button>
</label>
<div class="b3-label fn__flex config__item">
    <div class="fn__flex-1 fn__flex-center">
        ${window.siyuan.languages.dataRepoKey}
        <div class="b3-label__text">${window.siyuan.languages.dataRepoKeyTip1}</div>
        <div class="b3-label__text"><span class="ft__error">${window.siyuan.languages.dataRepoKeyTip2}</span></div>
    </div>
    <div class="fn__space"></div>
    <div class="fn__size200 config__item-line fn__flex-center${window.siyuan.config.repo.key ? " fn__none" : ""}">
        <button class="b3-button b3-button--outline fn__block" id="importKey">
            <svg><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.importKey}
        </button>
        <div class="fn__hr"></div>
        <button class="b3-button b3-button--outline fn__block" id="initKey">
            <svg><use xlink:href="#iconLock"></use></svg>${window.siyuan.languages.genKey}
        </button>
        <div class="fn__hr"></div>
        <button class="b3-button b3-button--outline fn__block" id="initKeyByPW">
            <svg><use xlink:href="#iconHand"></use></svg>${window.siyuan.languages.genKeyByPW}
        </button>
    </div>
    <div class="fn__size200 config__item-line fn__flex-center${window.siyuan.config.repo.key ? "" : " fn__none"}">
        <button class="b3-button b3-button--outline fn__block" id="copyKey">
            <svg><use xlink:href="#iconCopy"></use></svg>${window.siyuan.languages.copyKey}
        </button>
        <div class="fn__hr"></div>
        <button class="b3-button b3-button--outline fn__block" id="resetRepo">
            <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.resetRepo}
        </button>
    </div>
</div>
<label class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.dataRepoPurge}
        <div class="b3-label__text">${window.siyuan.languages.dataRepoPurgeTip}</div>
    </div>
    <div class="fn__space"></div>
    <button id="purgeRepo" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.purge}
    </button>
</label>
<label class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.systemLog}
        <div class="b3-label__text">${window.siyuan.languages.systemLogTip}</div>
    </div>
    <div class="fn__space"></div>
    <button id="exportLog" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.export}
    </button>
</label>
<label class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.currentVer} v${Constants.SIYUAN_VERSION}
        <span id="isInsider"></span>
        <div class="b3-label__text">${window.siyuan.languages.downloadLatestVer}</div>
    </div>
    <div class="fn__space"></div>
    <div class="fn__flex-center fn__size200 config__item-line">
        <button id="checkUpdateBtn" class="b3-button b3-button--outline fn__block">
            <svg><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.checkUpdate}
        </button>
        <div class="fn__hr${isBrowser() ? "" : " fn__none"}"></div>
        <button id="menuSafeQuit" class="b3-button b3-button--outline fn__block${(window.webkit?.messageHandlers || window.JSAndroid) ? "" : " fn__none"}">
            <svg><use xlink:href="#iconQuit"></use></svg>${window.siyuan.languages.safeQuit}
        </button>
    </div>
</label>
<label class="fn__flex config__item  b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about13}
         <div class="b3-label__text">${window.siyuan.languages.about14}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="token" value="${window.siyuan.config.api.token}" readonly="readonly">
</label>
<div class="b3-label${(window.siyuan.config.system.container === "std" || window.siyuan.config.system.container === "docker") ? "" : " fn__none"}">
    ${window.siyuan.languages.networkProxy}
    <div class="b3-label__text">
        ${window.siyuan.languages.about17}
    </div>
    <div class="b3-label__text fn__flex config__item" style="padding: 4px 0 4px 4px;">
        <select id="aboutScheme" class="b3-select">
            <option value="" ${window.siyuan.config.system.networkProxy.scheme === "" ? "selected" : ""}>${window.siyuan.languages.directConnection}</option>
            <option value="socks5" ${window.siyuan.config.system.networkProxy.scheme === "socks5" ? "selected" : ""}>SOCKS5</option>
            <option value="https" ${window.siyuan.config.system.networkProxy.scheme === "https" ? "selected" : ""}>HTTPS</option>
            <option value="http" ${window.siyuan.config.system.networkProxy.scheme === "http" ? "selected" : ""}>HTTP</option>
        </select>
        <span class="fn__space"></span>
        <input id="aboutHost" placeholder="Host/IP" class="b3-text-field fn__block" value="${window.siyuan.config.system.networkProxy.host}"/>
        <span class="fn__space"></span>
        <input id="aboutPort" placeholder="Port" class="b3-text-field fn__block" value="${window.siyuan.config.system.networkProxy.port}" type="number"/>
        <span class="fn__space"></span>
        <button id="aboutConfirm" class="b3-button fn__size200 b3-button--outline">${window.siyuan.languages.confirm}</button>
    </div>
</div>
<div class="b3-label">
    <div class="config-about__logo">
        <img src="/stage/icon.png">
        <span>${window.siyuan.languages.siyuanNote}</span>
        <span class="fn__space"></span>
        <span class="ft__on-surface">${window.siyuan.languages.slogan}</span>
        <span class="fn__space"></span>
        <span style="color:var(--b3-theme-background);font-family: cursive;">会泽百家&nbsp;至公天下</span>
    </div>
    <div class='fn__hr'></div>
    ${window.siyuan.languages.about1}
</div>`;
    },
    bindEvent: () => {
        if (window.siyuan.config.system.isInsider) {
            about.element.querySelector("#isInsider").innerHTML = "<span class='ft__secondary'>Insider Preview</span>";
        }
        const tokenElement = about.element.querySelector("#token") as HTMLInputElement;
        tokenElement.addEventListener("click", () => {
            tokenElement.select();
        });
        about.element.querySelector("#exportLog").addEventListener("click", () => {
            fetchPost("/api/system/exportLog", {}, (response) => {
                openByMobile(response.data.zip);
            });
        });
        about.element.querySelector("#menuSafeQuit").addEventListener("click", () => {
            exitSiYuan();
        });
        const updateElement = about.element.querySelector("#checkUpdateBtn");
        updateElement.addEventListener("click", () => {
            if (updateElement.firstElementChild.classList.contains("fn__rotate")) {
                return;
            }
            updateElement.innerHTML = `<svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.checkUpdate}`;
            fetchPost("/api/system/checkUpdate", {showMsg: true}, () => {
                updateElement.innerHTML = `<svg><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.checkUpdate}`;
            });
        });
        /// #if !BROWSER
        about.element.querySelectorAll('[data-type="open"]').forEach(item => {
            item.addEventListener("click", () => {
                const url = item.getAttribute("data-url");
                if (url.startsWith("http")) {
                    shell.openExternal(url);
                } else {
                    shell.openPath(url);
                }
            });
        });
        /// #endif
        about.element.querySelector("#authCode").addEventListener("click", () => {
            setAccessAuthCode();
        });
        const importKeyElement = about.element.querySelector("#importKey");
        importKeyElement.addEventListener("click", () => {
            const passwordDialog = new Dialog({
                title: "🔑 " + window.siyuan.languages.key,
                content: `<div class="b3-dialog__content">
    <textarea class="b3-text-field fn__block" placeholder="${window.siyuan.languages.keyPlaceholder}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                width: "520px",
            });
            const textAreaElement = passwordDialog.element.querySelector("textarea");
            textAreaElement.focus();
            const btnsElement = passwordDialog.element.querySelectorAll(".b3-button");
            btnsElement[0].addEventListener("click", () => {
                passwordDialog.destroy();
            });
            btnsElement[1].addEventListener("click", () => {
                fetchPost("/api/repo/importRepoKey", {key: textAreaElement.value}, () => {
                    window.siyuan.config.repo.key = textAreaElement.value;
                    importKeyElement.parentElement.classList.add("fn__none");
                    importKeyElement.parentElement.nextElementSibling.classList.remove("fn__none");
                    passwordDialog.destroy();
                });
            });
        });
        about.element.querySelector("#initKey").addEventListener("click", () => {
            confirmDialog("🔑 " + window.siyuan.languages.genKey, window.siyuan.languages.initRepoKeyTip, () => {
                fetchPost("/api/repo/initRepoKey", {}, (response) => {
                    window.siyuan.config.repo.key = response.data.key;
                    importKeyElement.parentElement.classList.add("fn__none");
                    importKeyElement.parentElement.nextElementSibling.classList.remove("fn__none");
                });
            });
        });
        about.element.querySelector("#initKeyByPW").addEventListener("click", () => {
            setKey(false, () => {
                importKeyElement.parentElement.classList.add("fn__none");
                importKeyElement.parentElement.nextElementSibling.classList.remove("fn__none");
            });
        });
        about.element.querySelector("#copyKey").addEventListener("click", () => {
            showMessage(window.siyuan.languages.copied);
            writeText(window.siyuan.config.repo.key);
        });
        about.element.querySelector("#resetRepo").addEventListener("click", () => {
            confirmDialog("⚠️ " + window.siyuan.languages.resetRepo, window.siyuan.languages.resetRepoTip, () => {
                fetchPost("/api/repo/resetRepo", {}, () => {
                    window.siyuan.config.repo.key = "";
                    window.siyuan.config.sync.enabled = false;
                    processSync();
                    importKeyElement.parentElement.classList.remove("fn__none");
                    importKeyElement.parentElement.nextElementSibling.classList.add("fn__none");
                });
            });
        });
        about.element.querySelector("#purgeRepo").addEventListener("click", () => {
            confirmDialog("♻️ " + window.siyuan.languages.dataRepoPurge, window.siyuan.languages.dataRepoPurgeConfirm, () => {
                fetchPost("/api/repo/purgeRepo");
            });
        });
        const networkServeElement = about.element.querySelector("#networkServe") as HTMLInputElement;
        networkServeElement.addEventListener("change", () => {
            fetchPost("/api/system/setNetworkServe", {networkServe: networkServeElement.checked}, () => {
                exportLayout({
                    reload: false,
                    onlyData: false,
                    errorExit: true,
                    cb: exitSiYuan
                });
            });
        });
        const googleAnalyticsElement = about.element.querySelector("#googleAnalytics") as HTMLInputElement;
        googleAnalyticsElement.addEventListener("change", () => {
            fetchPost("/api/system/setGoogleAnalytics", {googleAnalytics: googleAnalyticsElement.checked}, () => {
                exportLayout({
                    reload: true,
                    onlyData: false,
                    errorExit: false,
                });
            });
        });
        const uploadErrLogElement = about.element.querySelector("#uploadErrLog") as HTMLInputElement;
        uploadErrLogElement.addEventListener("change", () => {
            fetchPost("/api/system/setUploadErrLog", {uploadErrLog: uploadErrLogElement.checked}, () => {
                exportLayout({
                    reload: false,
                    onlyData: false,
                    errorExit: true,
                    cb: exitSiYuan
                });
            });
        });
        const downloadInstallPkgElement = about.element.querySelector("#downloadInstallPkg") as HTMLInputElement;
        downloadInstallPkgElement.addEventListener("change", () => {
            fetchPost("/api/system/setDownloadInstallPkg", {downloadInstallPkg: downloadInstallPkgElement.checked}, () => {
                window.siyuan.config.system.downloadInstallPkg = downloadInstallPkgElement.checked;
            });
        });
        /// #if !BROWSER
        const autoLaunchElement = about.element.querySelector("#autoLaunch") as HTMLInputElement;
        autoLaunchElement.addEventListener("change", () => {
            fetchPost("/api/system/setAutoLaunch", {autoLaunch: autoLaunchElement.checked}, () => {
                window.siyuan.config.system.autoLaunch = autoLaunchElement.checked;
                ipcRenderer.send(Constants.SIYUAN_AUTO_LAUNCH, {openAtLogin: autoLaunchElement.checked});
            });
        });
        /// #endif
        about.element.querySelector("#aboutConfirm").addEventListener("click", () => {
            const scheme = (about.element.querySelector("#aboutScheme") as HTMLInputElement).value;
            const host = (about.element.querySelector("#aboutHost") as HTMLInputElement).value;
            const port = (about.element.querySelector("#aboutPort") as HTMLInputElement).value;
            fetchPost("/api/system/setNetworkProxy", {scheme, host, port}, () => {
                window.siyuan.config.system.networkProxy.scheme = scheme;
                window.siyuan.config.system.networkProxy.host = host;
                window.siyuan.config.system.networkProxy.port = port;
                setProxy();
            });
        });
    }
};
