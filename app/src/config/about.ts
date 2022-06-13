import {Constants} from "../constants";
/// #if !BROWSER
import {shell} from "electron";
import {dialog} from "@electron/remote";
/// #endif
import {isBrowser} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {setAccessAuthCode} from "./util";
import {exportLayout} from "../layout/util";
import {exitSiYuan} from "../dialog/processSystem";

export const about = {
    element: undefined as Element,
    genHTML: () => {
        return `
<div class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about11}
        <div class="b3-label__text">${window.siyuan.languages.about12}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="networkServe" type="checkbox"${window.siyuan.config.system.networkServe ? " checked" : ""}>
</div>
<div class="fn__flex b3-label${isBrowser() ? " fn__none" : ""}">
    <div class="fn__flex-1">
       ${window.siyuan.languages.about2}
        <div class="b3-label__text b3-typography">${window.siyuan.languages.about3}</div>
        <div class='fn__hr'></div>
        <span class="b3-label__text b3-typography"><code>${window.siyuan.config.localIPs.join("</code> <code>")}</code></span>
    </div>
    <div class="fn__space"></div>
    <button data-type="open" data-url="http://${window.siyuan.config.system.networkServe ? window.siyuan.config.localIPs[0] : "127.0.0.1"}:6806" class="b3-button b3-button--outline fn__size200 fn__flex-center">${window.siyuan.languages.about4}</button>
</div>
<div class="b3-label${(window.siyuan.config.system.container === "std" || window.siyuan.config.system.container === "docker") ? "" : " fn__none"}">
    ${window.siyuan.languages.networkProxy}
    <div class="b3-label__text b3-typography">
        ${window.siyuan.languages.about17}
    </div>
    <div class="b3-label__text fn__flex" style="padding: 4px 0 4px 4px;">
        <select id="aboutScheme" class="b3-select">
            <option value="" ${window.siyuan.config.system.networkProxy.scheme === "" ? "selected" : ""}>${window.siyuan.languages.directConnection}</option>
            <option value="socks5" ${window.siyuan.config.system.networkProxy.scheme === "socks5" ? "selected" : ""}>SOCKS5</option>
            <option value="http" ${window.siyuan.config.system.networkProxy.scheme === "http" ? "selected" : ""}>HTTP</option>
        </select>
        <span class="fn__space"></span>
        <input id="aboutHost" placeholder="Host/IP" class="b3-text-field fn__flex-1 fn__block" value="${window.siyuan.config.system.networkProxy.host}"/>
        <span class="fn__space"></span>
        <input id="aboutPort" placeholder="Port" class="b3-text-field fn__flex-1 fn__block" value="${window.siyuan.config.system.networkProxy.port}" type="number"/>
        <span class="fn__space"></span>
        <button id="aboutConfim" class="b3-button b3-button--outline">${window.siyuan.languages.confirm}</button>
    </div>
</div>
<div class="fn__flex b3-label${isBrowser() ? " fn__none" : ""}">
    <div class="fn__flex-1">
        <div class="fn__flex">
            ${window.siyuan.languages.about7}
            <span class="fn__space"></span>
            <a href="javascript:void(0)" data-type="open" data-url="${window.siyuan.config.system.workspaceDir}">${window.siyuan.config.system.workspaceDir}</a>
        </div>
        <div class="b3-label__text">${window.siyuan.languages.about8}</div>
    </div>
    <div class="fn__space"></div>
    <select id="workspaceDir" class="fn__flex-center b3-select fn__size200"></select>
</div>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about13}
         <div class="b3-label__text">${window.siyuan.languages.about14}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center fn__size200" id="token" value="${window.siyuan.config.api.token}" readonly="readonly">
</label>
<div class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about5}
        <div class="b3-label__text">${window.siyuan.languages.about6}</div>
    </div>
    <div class="fn__space"></div>
    <button class="fn__flex-center b3-button b3-button--outline fn__size200" id="authCode">
        <svg><use xlink:href="#iconLock"></use></svg>${window.siyuan.languages.config}
    </button>
</div>
<div class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.snapshotPassword}
        <div class="b3-label__text">${window.siyuan.languages.snapshotPasswordTip}</div>
    </div>
    <div class="fn__space"></div>
    <button class="fn__flex-center b3-button b3-button--outline fn__size200" id="snapshotPassword">
        <svg><use xlink:href="#iconLock"></use></svg>${window.siyuan.languages.config}
    </button>
</div>
<div class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.currentVer} v${Constants.SIYUAN_VERSION}
        <span id="isInsider"></span>
        <div class="b3-label__text">${window.siyuan.languages.visitAnnouncements}</div>
    </div>
    <div class="fn__space"></div>
    <button id="checkUpdateBtn" class="b3-button b3-button--outline fn__size200 fn__flex-center">${window.siyuan.languages.checkUpdate}</button>
</div>
<div class="b3-label fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.about9}
        <div class="b3-label__text">${window.siyuan.languages.about10}</div>
    </div>
    <div class="fn__space"></div>
    <input class="b3-switch fn__flex-center" id="uploadErrLog" type="checkbox"${window.siyuan.config.system.uploadErrLog ? " checked" : ""}>
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
        const updateElement = about.element.querySelector("#checkUpdateBtn");
        updateElement.addEventListener("click", () => {
            const svgElement = updateElement.firstElementChild;
            if (svgElement) {
                return;
            }
            updateElement.innerHTML = `<svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg>${window.siyuan.languages.checkUpdate}`;
            fetchPost("/api/system/checkUpdate", {showMsg: true}, () => {
                updateElement.innerHTML = `${window.siyuan.languages.checkUpdate}`;
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

        const workspaceDirElement = about.element.querySelector("#workspaceDir") as HTMLInputElement;
        workspaceDirElement.addEventListener("change", async () => {
            let workspace = workspaceDirElement.value;
            if (workspaceDirElement.value === "0") {
                const localPath = await dialog.showOpenDialog({
                    defaultPath: window.siyuan.config.system.homeDir,
                    properties: ["openDirectory", "createDirectory"],
                });
                if (localPath.filePaths.length === 0) {
                    workspaceDirElement.value = window.siyuan.config.system.workspaceDir;
                    return;
                }
                workspace = localPath.filePaths[0];
            }
            fetchPost("/api/system/setWorkspaceDir", {
                path: workspace
            }, () => {
                const searchData = JSON.parse(localStorage.getItem(Constants.LOCAL_SEARCHEDATA) || "{}");
                if (searchData.hPath) {
                    searchData.hPath = "";
                    localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(searchData));
                }
                exportLayout(false, () => {
                    exitSiYuan();
                });
            });
        });

        fetchPost("/api/system/listWorkspaceDirs", {}, (response) => {
            let optionsHTML = "";
            response.data.forEach((item: string) => {
                optionsHTML += `<option value="${item}">${item}</option>`;
            });
            workspaceDirElement.innerHTML = optionsHTML + `<option value="0">${window.siyuan.languages.updatePath}</option>`;
            workspaceDirElement.value = window.siyuan.config.system.workspaceDir;
        });
        /// #endif
        const authCodeElement = about.element.querySelector("#authCode") as HTMLInputElement;
        authCodeElement.addEventListener("click", () => {
            setAccessAuthCode();
        });
        const networkServeElement = about.element.querySelector("#networkServe") as HTMLInputElement;
        networkServeElement.addEventListener("change", () => {
            fetchPost("/api/system/setNetworkServe", {networkServe: networkServeElement.checked}, () => {
                exportLayout(false, () => {
                    exitSiYuan();
                });
            });
        });
        const uploadErrLogElement = about.element.querySelector("#uploadErrLog") as HTMLInputElement;
        uploadErrLogElement.addEventListener("change", () => {
            fetchPost("/api/system/setUploadErrLog", {uploadErrLog: uploadErrLogElement.checked}, () => {
                exportLayout(false, () => {
                    exitSiYuan();
                });
            });
        });
        about.element.querySelector("#aboutConfim").addEventListener("click", () => {
            fetchPost("/api/system/setNetworkProxy", {
                scheme: (about.element.querySelector("#aboutScheme") as HTMLInputElement).value,
                host: (about.element.querySelector("#aboutHost") as HTMLInputElement).value,
                port: (about.element.querySelector("#aboutPort") as HTMLInputElement).value
            }, () => {
                exportLayout(false, () => {
                    exitSiYuan();
                });
            });
        });
    }
};
