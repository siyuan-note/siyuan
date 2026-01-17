import {Constants} from "../constants";
/// #if !BROWSER
import {ipcRenderer, shell} from "electron";
/// #endif
import {isBrowser} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {setAccessAuthCode} from "./util/about";
import {exportLayout} from "../layout/util";
import {exitSiYuan, processSync} from "../dialog/processSystem";
import {isInAndroid, isInHarmony, isInIOS, isIPad, isMac, openByMobile, writeText} from "../protyle/util/compatibility";
import {showMessage} from "../dialog/message";
import {Dialog} from "../dialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {setKey} from "../sync/syncGuide";
import {useShell} from "../util/pathName";

export const about = {
    element: undefined as Element,
    genHTML: () => {
        const checkUpdateHTML = window.siyuan.config.system.isMicrosoftStore ? `<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.currentVer} v${Constants.SIYUAN_VERSION}
        <span id="isInsider"></span>
        <div class="b3-label__text">${window.siyuan.languages.isMsStoreVerTip}</div>
    </div>
</div>` : `<div class="fn__flex b3-label config__item">
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
    </div>
</div>`;
        return `<div class="fn__flex b3-label config__item${isBrowser() || window.siyuan.config.system.isMicrosoftStore || "std" !== window.siyuan.config.system.container || "linux" === window.siyuan.config.system.os ? " fn__none" : ""}">
    <div class="fn__flex-1">
        ${window.siyuan.languages.autoLaunch}
        <div class="b3-label__text">${window.siyuan.languages.autoLaunchTip}</div>
    </div>
    <span class="fn__space"></span>
    <select class="b3-select fn__flex-center fn__size200" id="autoLaunch">
      <option value="0" ${window.siyuan.config.system.autoLaunch2 === 0 ? "selected" : ""}>${window.siyuan.languages.autoLaunchMode0}</option>
      <option value="1" ${window.siyuan.config.system.autoLaunch2 === 1 ? "selected" : ""}>${window.siyuan.languages.autoLaunchMode1}</option>
      ${isMac() ? "" : `<option value="2" ${window.siyuan.config.system.autoLaunch2 === 2 ? "selected" : ""}>${window.siyuan.languages.autoLaunchMode2}</option>`}
    </select>    
</div>
<label class="fn__flex b3-label${isBrowser() || window.siyuan.config.system.isMicrosoftStore || window.siyuan.config.system.container !== "std" || "linux" === window.siyuan.config.system.os ? " fn__none" : ""}">
    <div class="fn__flex-1">
        ${window.siyuan.languages.autoDownloadUpdatePkg}
        <div class="b3-label__text">${window.siyuan.languages.autoDownloadUpdatePkgTip}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="downloadInstallPkg" type="checkbox"${window.siyuan.config.system.downloadInstallPkg ? " checked" : ""}>
</label>
<label class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about11}
        <div class="b3-label__text">${window.siyuan.languages.about12}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="networkServe" type="checkbox"${window.siyuan.config.system.networkServe ? " checked" : ""}>
</label>
<div class="b3-label${(window.siyuan.config.readonly || (isBrowser() && !isInIOS() && !isInAndroid() && !isIPad() && !isInHarmony())) ? " fn__none" : ""}">
    <div class="fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.about5}
            <div class="b3-label__text">${window.siyuan.languages.about6}</div>
        </div>
        <div class="fn__space"></div>
        <button class="fn__flex-center b3-button b3-button--outline fn__size200" id="authCode">
            <svg><use xlink:href="#iconLock"></use></svg>${window.siyuan.languages.config}
        </button>
    </div>
    <label class="b3-label fn__flex${!window.siyuan.config.accessAuthCode || isBrowser() ? " fn__none" : ""}">
        <div class="fn__flex-1">
            ${window.siyuan.languages.about7}
            <div class="b3-label__text">${window.siyuan.languages.about8}</div>
        </div>
        <div class="fn__space"></div>
        <input class="b3-switch fn__flex-center" id="lockScreenMode" type="checkbox"${window.siyuan.config.system.lockScreenMode === 1 ? " checked" : ""}>
    </label>
</div>
<div class="b3-label config__item${(isBrowser() && !isInAndroid() && !isInIOS() && !isInHarmony()) ? " fn__none" : " fn__flex"}">
    <div class="fn__flex-1">
       ${window.siyuan.languages.about2}
        <div class="b3-label__text">${window.siyuan.languages.about3.replace("${port}", location.port)}</div>
        ${(() => {
            const serverAddrs: string[] = [];
            for (const serverAddr of window.siyuan.config.serverAddrs) {
                if (!serverAddr.trim()) {
                    break;
                }

                serverAddrs.push(`<code class="fn__code">${serverAddr}</code>`);
            }
            return `<div class="b3-label__text">${serverAddrs.join(" ")}</div>`;
        })()}
        <div class="b3-label__text">${window.siyuan.languages.about18}</div>
    </div>
    <div class="fn__space"></div>
    <button data-type="open" data-url="${window.siyuan.config.system.networkServe ? window.siyuan.config.serverAddrs[0] : "http://127.0.0.1:"+ location.port}" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconLink"></use></svg>${window.siyuan.languages.about4}
    </button>
</div>
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
            <svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.resetRepo}
        </button>
    </div>
</div>
<div class="b3-label">
    <div>
        ${window.siyuan.languages.dataRepoPurge}
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex config__item">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.dataRepoPurgeTip}</div>
        <span class="fn__space"></span>
        <button id="purgeRepo" class="b3-button b3-button--outline fn__size200 fn__flex-center">
            <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.purge}
        </button>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex config__item">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.dataRepoAutoPurgeIndexRetentionDays}</div>
        <span class="fn__space"></span>
        <input class="b3-text-field fn__flex-center fn__size200" min="1" type="number" id="indexRetentionDays" value="${window.siyuan.config.repo.indexRetentionDays}">
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex config__item">
        <div class="fn__flex-center fn__flex-1 ft__on-surface">${window.siyuan.languages.dataRepoAutoPurgeRetentionIndexesDaily}</div>
        <span class="fn__space"></span>
        <input class="b3-text-field fn__flex-center fn__size200" min="1" type="number" id="retentionIndexesDaily" value="${window.siyuan.config.repo.retentionIndexesDaily}">
    </div>
</div>
<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.vacuumDataIndex}
        <div class="b3-label__text">${window.siyuan.languages.vacuumDataIndexTip}</div>
    </div>
    <div class="fn__space"></div>
    <button id="vacuumDataIndex" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.vacuumDataIndex}
    </button>
</div>
<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.rebuildDataIndex}
        <div class="b3-label__text">${window.siyuan.languages.rebuildDataIndexTip}</div>
    </div>
    <div class="fn__space"></div>
    <button id="rebuildDataIndex" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.rebuildDataIndex}
    </button>
</div>
<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.clearTempFiles}
        <div class="b3-label__text">${window.siyuan.languages.clearTempFilesTip}</div>
    </div>
    <div class="fn__space"></div>
    <button id="clearTempFiles" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.purge}
    </button>
</div>
<div class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${window.siyuan.languages.systemLog}
        <div class="b3-label__text">${window.siyuan.languages.systemLogTip}</div>
    </div>
    <div class="fn__space"></div>
    <button id="exportLog" class="b3-button b3-button--outline fn__size200 fn__flex-center">
        <svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.export}
    </button>
</div>
${checkUpdateHTML}
<div class="fn__flex config__item  b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about13}
         <div class="b3-label__text" id="tokenTip">${window.siyuan.languages.about14.replace("${token}", window.siyuan.config.api.token)}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="token" value="${window.siyuan.config.api.token}">
</div>
<div class="b3-label">
    ${window.siyuan.languages.networkProxy}
    <div class="b3-label__text">
        ${window.siyuan.languages.about17}
    </div>
    <div class="b3-label__text fn__flex config__item">
        <select id="aboutScheme" class="b3-select">
            <option value="" ${window.siyuan.config.system.networkProxy.scheme === "" ? "selected" : ""}>${window.siyuan.languages.directConnection}</option>
            <option value="socks5" ${window.siyuan.config.system.networkProxy.scheme === "socks5" ? "selected" : ""}>SOCKS5</option>
            <option value="https" ${window.siyuan.config.system.networkProxy.scheme === "https" ? "selected" : ""}>HTTPS</option>
            <option value="http" ${window.siyuan.config.system.networkProxy.scheme === "http" ? "selected" : ""}>HTTP</option>
        </select>
        <span class="fn__space"></span>
        <input id="aboutHost" placeholder="user:pass@IP" class="b3-text-field fn__block" value="${window.siyuan.config.system.networkProxy.host}"/>
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
    ${window.siyuan.languages.about1} ${"harmony" === window.siyuan.config.system.container ? " • " + window.siyuan.languages.feedback + " 845765@qq.com" : ""} 
</div>`;
    },
    bindEvent: () => {
        if (window.siyuan.config.system.isInsider) {
            about.element.querySelector("#isInsider").innerHTML = "<span class='ft__secondary'>Insider Preview</span>";
        }
        const indexRetentionDaysElement = about.element.querySelector("#indexRetentionDays") as HTMLInputElement;
        indexRetentionDaysElement.addEventListener("change", () => {
            fetchPost("/api/repo/setRepoIndexRetentionDays", {days: parseInt(indexRetentionDaysElement.value)}, () => {
                window.siyuan.config.repo.indexRetentionDays = parseInt(indexRetentionDaysElement.value);
            });
        });
        const retentionIndexesDailyElement = about.element.querySelector("#retentionIndexesDaily") as HTMLInputElement;
        retentionIndexesDailyElement.addEventListener("change", () => {
            fetchPost("/api/repo/setRetentionIndexesDaily", {indexes: parseInt(retentionIndexesDailyElement.value)}, () => {
                window.siyuan.config.repo.retentionIndexesDaily = parseInt(retentionIndexesDailyElement.value);
            });
        });
        const tokenElement = about.element.querySelector("#token") as HTMLInputElement;
        tokenElement.addEventListener("click", () => {
            tokenElement.select();
        });
        tokenElement.addEventListener("change", () => {
            fetchPost("/api/system/setAPIToken", {token: tokenElement.value}, () => {
                window.siyuan.config.api.token = tokenElement.value;
                about.element.querySelector("#tokenTip").innerHTML = window.siyuan.languages.about14.replace("${token}", window.siyuan.config.api.token);
            });
        });
        about.element.querySelector("#vacuumDataIndex").addEventListener("click", () => {
            fetchPost("/api/system/vacuumDataIndex", {}, () => {
            });
        });
        about.element.querySelector("#rebuildDataIndex").addEventListener("click", () => {
            fetchPost("/api/system/rebuildDataIndex", {}, () => {
            });
        });
        about.element.querySelector("#clearTempFiles").addEventListener("click", () => {
            fetchPost("/api/system/clearTempFiles", {}, () => {
            });
        });
        about.element.querySelector("#exportLog").addEventListener("click", () => {
            fetchPost("/api/system/exportLog", {}, (response) => {
                openByMobile(response.data.zip);
            });
        });
        const updateElement = about.element.querySelector("#checkUpdateBtn");
        updateElement?.addEventListener("click", () => {
            if (updateElement.firstElementChild.classList.contains("fn__rotate")) {
                return;
            }
            updateElement.innerHTML = `<svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.checkUpdate}`;
            fetchPost("/api/system/checkUpdate", {showMsg: true}, () => {
                updateElement.innerHTML = `<svg><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.checkUpdate}`;
            });
        });
        about.element.querySelectorAll('[data-type="open"]').forEach(item => {
            item.addEventListener("click", () => {
                const url = item.getAttribute("data-url");
                /// #if !BROWSER
                if (url.startsWith("http")) {
                    shell.openExternal(url);
                } else {
                    useShell("openPath", url);
                }
                /// #else
                window.open(url);
                /// #endif
            });
        });

        about.element.querySelector("#authCode").addEventListener("click", () => {
            setAccessAuthCode();
        });
        const importKeyElement = about.element.querySelector("#importKey");
        importKeyElement.addEventListener("click", () => {
            const passwordDialog = new Dialog({
                title: "🔑 " + window.siyuan.languages.key,
                content: `<div class="b3-dialog__content">
    <textarea spellcheck="false" style="resize: vertical;" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.keyPlaceholder}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                width: "520px",
            });
            passwordDialog.element.setAttribute("data-key", Constants.DIALOG_PASSWORD);
            const textAreaElement = passwordDialog.element.querySelector("textarea");
            textAreaElement.focus();
            const btnsElement = passwordDialog.element.querySelectorAll(".b3-button");
            btnsElement[0].addEventListener("click", () => {
                passwordDialog.destroy();
            });
            btnsElement[1].addEventListener("click", () => {
                fetchPost("/api/repo/importRepoKey", {key: textAreaElement.value}, (response) => {
                    window.siyuan.config.repo.key = response.data.key;
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
                    errorExit: true,
                    cb: exitSiYuan
                });
            });
        });
        const lockScreenModeElement = about.element.querySelector("#lockScreenMode") as HTMLInputElement;
        lockScreenModeElement.addEventListener("change", () => {
            fetchPost("/api/system/setFollowSystemLockScreen", {lockScreenMode: lockScreenModeElement.checked ? 1 : 0}, () => {
                window.siyuan.config.system.lockScreenMode = lockScreenModeElement.checked ? 1 : 0;
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
            const autoLaunchMode = parseInt(autoLaunchElement.value);
            fetchPost("/api/system/setAutoLaunch", {autoLaunch: autoLaunchMode}, () => {
                window.siyuan.config.system.autoLaunch2 = autoLaunchMode;
                ipcRenderer.send(Constants.SIYUAN_AUTO_LAUNCH, {
                    openAtLogin: 0 !== autoLaunchMode,
                    openAsHidden: 2 === autoLaunchMode
                });
            });
        });
        /// #endif
        about.element.querySelector("#aboutConfirm").addEventListener("click", () => {
            const scheme = (about.element.querySelector("#aboutScheme") as HTMLInputElement).value as Config.TSystemNetworkProxyScheme;
            const host = (about.element.querySelector("#aboutHost") as HTMLInputElement).value;
            const port = (about.element.querySelector("#aboutPort") as HTMLInputElement).value;
            fetchPost("/api/system/setNetworkProxy", {scheme, host, port}, async () => {
                window.siyuan.config.system.networkProxy.scheme = scheme;
                window.siyuan.config.system.networkProxy.host = host;
                window.siyuan.config.system.networkProxy.port = port;
                /// #if !BROWSER
                ipcRenderer.invoke(Constants.SIYUAN_GET, {
                    cmd: "setProxy",
                    proxyURL: `${window.siyuan.config.system.networkProxy.scheme}://${window.siyuan.config.system.networkProxy.host}:${window.siyuan.config.system.networkProxy.port}`,
                }).then(() => {
                    exportLayout({
                        errorExit: false,
                        cb() {
                            window.location.reload();
                        },
                    });
                });
                /// #endif
            });
        });
    }
};
