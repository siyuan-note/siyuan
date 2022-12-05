import {needSubscribe} from "../util/needSubscribe";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {showMessage} from "../dialog/message";
import {bindSyncCloudListEvent, getSyncCloudList} from "../sync/syncGuide";
import {hasClosestByClassName} from "../protyle/util/hasClosest";

const renderProvider = (provider: number) => {
    if (provider === 0) {
        if (needSubscribe("")) {
            return `<div class="b3-label b3-label--inner">${window.siyuan.config.system.container === "ios" ? window.siyuan.languages._kernel[122] : window.siyuan.languages._kernel[29]}</div>
<div class="b3-label b3-label--noborder">
    ${window.siyuan.languages.cloudIntro1}
    <div class="b3-label__text">
        <ul class="fn__list">
            <li>${window.siyuan.languages.cloudIntro2}</li>
            <li>${window.siyuan.languages.cloudIntro3}</li>
            <li>${window.siyuan.languages.cloudIntro4}</li>
            <li>${window.siyuan.languages.cloudIntro5}</li>
            <li>${window.siyuan.languages.cloudIntro6}</li>
            <li>${window.siyuan.languages.cloudIntro7}</li>
            <li>${window.siyuan.languages.cloudIntro8}</li>
        </ul>
    </div>
</div>
<div class="b3-label b3-label--noborder">
    ${window.siyuan.languages.cloudIntro9}
    <div class="b3-label__text">
        <ul style="padding-left: 2em">
            <li>${window.siyuan.languages.cloudIntro10}</li>
            <li>${window.siyuan.languages.cloudIntro11}</li>
        </ul>
    </div>
</div>`;
        }
        return `<div class="b3-label b3-label--inner">
    ${window.siyuan.languages.syncOfficialProviderIntro}
</div>`;
    } else if (provider === 2) {
        const tip = `<div class="b3-label b3-label--inner">
    ${window.siyuan.languages.syncThirdPartyProviderS3Intro}
    <div class="fn__hr"></div>
    ${window.siyuan.languages.featureBetaStage}
    <div class="fn__hr"></div>
    ${window.siyuan.languages.syncThirdPartyProviderTip}
</div>`;
        if (isMobile()) {
            return `${tip}
<div class="b3-label b3-label--noborder">
    <div>Endpoint</div>
    <div class="fn__hr"></div>
    <input id="endpoint" class="b3-text-field fn__block" value="${window.siyuan.config.sync.s3.endpoint}">
</div>
<div class="b3-label b3-label--noborder">
    <div>Access Key</div>
    <div class="fn__hr"></div>
    <input id="accessKey" class="b3-text-field fn__block" value="${window.siyuan.config.sync.s3.accessKey}">
</div>
<div class="b3-label b3-label--noborder">
    <div>Secret Key</div>
    <div class="fn__hr"></div>
    <div class="b3-form__icona">
        <input id="secretKey" type="password" class="b3-text-field b3-form__icona-input" value="${window.siyuan.config.sync.s3.secretKey}">
        <svg class="b3-form__icona-icon"><use xlink:href="#iconEye"></use></svg>
    </div>
</div>
<div class="b3-label b3-label--noborder">
    <div>Bucket</div>
    <div class="fn__hr"></div>
    <input id="bucket" class="b3-text-field fn__block" value="${window.siyuan.config.sync.s3.bucket}">
</div>
<div class="b3-label b3-label--noborder">
    <div>Region</div>
    <div class="fn__hr"></div>
    <input id="region" class="b3-text-field fn__block" value="${window.siyuan.config.sync.s3.region}">
</div>
<div class="b3-label b3-label--noborder">
    <div>Timeout (s)</div>
    <div class="fn__hr"></div>
    <input id="timeout" class="b3-text-field fn__block" type="number" min="7" max="300" value="${window.siyuan.config.sync.s3.timeout}">
</div>
<div class="b3-label b3-label--noborder">
    <div>Addressing</div>
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="pathStyle">
        <option ${window.siyuan.config.sync.s3.pathStyle ? "" : "selected"} value="false">Virtual-hosted-style</option>
        <option ${window.siyuan.config.sync.s3.pathStyle ? "selected" : ""} value="true">Path-style</option>
    </select>
</div>
<div class="b3-label b3-label--noborder">
    <div>TLS verify</div>
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="s3SkipTlsVerify">
        <option ${window.siyuan.config.sync.s3.skipTlsVerify ? "" : "selected"} value="false">Verify</option>
        <option ${window.siyuan.config.sync.s3.skipTlsVerify ? "selected" : ""} value="true">Skip</option>
    </select>
</div>`;
        }
        return `${tip}
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Endpoint</div>
    <div class="fn__space"></div>
    <input id="endpoint" class="b3-text-field fn__flex-1" value="${window.siyuan.config.sync.s3.endpoint}">
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Access Key</div>
    <div class="fn__space"></div>
    <input id="accessKey" class="b3-text-field fn__flex-1" value="${window.siyuan.config.sync.s3.accessKey}">
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Secret Key</div>
    <div class="fn__space"></div>
    <div class="b3-form__icona">
        <input id="secretKey" type="password" class="b3-text-field b3-form__icona-input" value="${window.siyuan.config.sync.s3.secretKey}">
        <svg class="b3-form__icona-icon"><use xlink:href="#iconEye"></use></svg>
    </div>
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Bucket</div>
    <div class="fn__space"></div>
    <input id="bucket" class="b3-text-field fn__flex-1" value="${window.siyuan.config.sync.s3.bucket}">
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Region</div>
    <div class="fn__space"></div>
    <input id="region" class="b3-text-field fn__flex-1" value="${window.siyuan.config.sync.s3.region}">
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Timeout (s)</div>
    <div class="fn__space"></div>
    <input id="timeout" class="b3-text-field fn__flex-1" type="number" min="7" max="300" value="${window.siyuan.config.sync.s3.timeout}">
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Addressing</div>
    <div class="fn__space"></div>
    <select class="b3-select fn__flex-1" id="pathStyle">
        <option ${window.siyuan.config.sync.s3.pathStyle ? "" : "selected"} value="false">Virtual-hosted-style</option>
        <option ${window.siyuan.config.sync.s3.pathStyle ? "selected" : ""} value="true">Path-style</option>
    </select>
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">TLS Verify</div>
    <div class="fn__space"></div>
    <select class="b3-select fn__flex-1" id="s3SkipTlsVerify">
        <option ${window.siyuan.config.sync.s3.skipTlsVerify ? "" : "selected"} value="false">Verify</option>
        <option ${window.siyuan.config.sync.s3.skipTlsVerify ? "selected" : ""} value="true">Skip</option>
    </select>
</label>`;
    } else if (provider === 3) {
        const tip = `<div class="b3-label b3-label--inner">
    ${window.siyuan.languages.syncThirdPartyProviderWebDAVIntro}
    <div class="fn__hr"></div>
    ${window.siyuan.languages.featureBetaStage}
    <div class="fn__hr"></div>    
    ${window.siyuan.languages.syncThirdPartyProviderTip}
</div>`;
        if (isMobile()) {
            return `${tip}
<div class="b3-label b3-label--noborder">
    <div>Endpoint</div>
    <div class="fn__hr"></div>
    <input id="endpoint" class="b3-text-field fn__block" value="${window.siyuan.config.sync.webdav.endpoint}">
</div>
<div class="b3-label b3-label--noborder">
    <div>Username</div>
    <div class="fn__hr"></div>
    <input id="username" class="b3-text-field fn__block" value="${window.siyuan.config.sync.webdav.username}">
</div>
<div class="b3-label b3-label--noborder">
    <div>Password</div>
    <div class="fn__hr"></div>
    <div class="b3-form__icona">
        <input id="password" type="password" class="b3-text-field b3-form__icona-input" value="${window.siyuan.config.sync.webdav.password}">
        <svg class="b3-form__icona-icon"><use xlink:href="#iconEye"></use></svg>
    </div>
</div>
<div class="b3-label b3-label--noborder">
    <div>Timeout (s)</div>
    <div class="fn__hr"></div>
    <input id="timeout" class="b3-text-field fn__block" type="number" min="7" max="300" value="${window.siyuan.config.sync.webdav.timeout}">
</div>
<div class="b3-label b3-label--noborder">
    <div>TLS verify</div>
    <div class="fn__hr"></div>
    <select class="b3-select fn__block" id="webdavSkipTlsVerify">
        <option ${window.siyuan.config.sync.webdav.skipTlsVerify ? "" : "selected"} value="false">Verify</option>
        <option ${window.siyuan.config.sync.webdav.skipTlsVerify ? "selected" : ""} value="true">Skip</option>
    </select>
</div>`;
        }
        return `${tip}
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Endpoint</div>
    <div class="fn__space"></div>
    <input id="endpoint" class="b3-text-field fn__flex-1" value="${window.siyuan.config.sync.webdav.endpoint}">
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Username</div>
    <div class="fn__space"></div>
    <input id="username" class="b3-text-field fn__flex-1" value="${window.siyuan.config.sync.webdav.username}">
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Password</div>
    <div class="fn__space"></div>
    <div class="b3-form__icona">
        <input id="password" type="password" class="b3-text-field b3-form__icona-input" value="${window.siyuan.config.sync.webdav.password}">
        <svg class="b3-form__icona-icon"><use xlink:href="#iconEye"></use></svg>
    </div>
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">Timeout (s)</div>
    <div class="fn__space"></div>
    <input id="timeout" class="b3-text-field fn__flex-1" type="number" min="7" max="300" value="${window.siyuan.config.sync.webdav.timeout}">
</label>
<label class="b3-label b3-label--noborder fn__flex">
    <div class="fn__flex-center fn__size200">TLS Verify</div>
    <div class="fn__space"></div>
    <select class="b3-select fn__flex-1" id="webdavSkipTlsVerify">
        <option ${window.siyuan.config.sync.webdav.skipTlsVerify ? "" : "selected"} value="false">Verify</option>
        <option ${window.siyuan.config.sync.webdav.skipTlsVerify ? "selected" : ""} value="true">Skip</option>
    </select>
</label>`;
    }
    return "";
};

const bindProviderEvent = () => {
    const reposDataElement = repos.element.querySelector("#reposData");
    const loadingElement = repos.element.querySelector("#reposLoading");
    if (window.siyuan.config.sync.provider === 0) {
        if (needSubscribe("")) {
            loadingElement.classList.add("fn__none");
            let nextElement = reposDataElement;
            while (nextElement) {
                nextElement.classList.add("fn__none");
                nextElement = nextElement.nextElementSibling;
            }
            return;
        }
        fetchPost("/api/cloud/getCloudSpace", {}, (response) => {
            loadingElement.classList.add("fn__none");
            if (response.code === 1) {
                reposDataElement.innerHTML = response.msg;
                return;
            } else {
                reposDataElement.innerHTML = `<div class="fn__flex">
    <div class="fn__flex-1">
        ${window.siyuan.languages.cloudStorage}
        <div class="fn__hr"></div>
        <ul class="b3-list">
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.sync}<span class="b3-list-item__meta">${response.data.sync ? response.data.sync.hSize : "0B"}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.backup}<span class="b3-list-item__meta">${response.data.backup ? response.data.backup.hSize : "0B"}</span></li>
            <li class="b3-list-item" style="cursor: auto;"><a href="https://ld246.com/settings/file?type=3" target="_blank">${window.siyuan.languages.cdn}</a><span class="b3-list-item__meta">${response.data.hAssetSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.total}<span class="b3-list-item__meta">${response.data.hSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.sizeLimit}<span class="b3-list-item__meta">${response.data.hTotalSize}</span></li>
        </ul>
    </div>
    <div class="fn__flex-1">
        ${window.siyuan.languages.trafficStat}
        <div class="fn__hr"></div>
        <ul class="b3-list">
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.upload}<span class="fn__space"></span><span class="ft__on-surface">${response.data.hTrafficUploadSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.download}<span class="fn__space"></span><span class="ft__on-surface">${response.data.hTrafficDownloadSize}</span></li>
        </ul>
    </div>
</div>`;
            }
        });
        reposDataElement.classList.remove("fn__none");
        return;
    }

    loadingElement.classList.add("fn__none");
    let nextElement = reposDataElement.nextElementSibling;
    while (nextElement) {
        nextElement.classList.remove("fn__none");
        nextElement = nextElement.nextElementSibling;
    }
    reposDataElement.classList.add("fn__none");
    const providerPanelElement = repos.element.querySelector("#syncProviderPanel");
    providerPanelElement.querySelectorAll(".b3-text-field, .b3-select").forEach(item => {
        item.addEventListener("blur", () => {
            if (window.siyuan.config.sync.provider === 2) {
                let timeout = parseInt((providerPanelElement.querySelector("#timeout") as HTMLInputElement).value, 10);
                if (7 > timeout) {
                    if (1 > timeout) {
                        timeout = 30
                    } else {
                        timeout = 7;
                    }
                }
                if (300 < timeout) {
                    timeout = 300;
                }
                (providerPanelElement.querySelector("#timeout") as HTMLInputElement).value = timeout.toString();
                const s3 = {
                    endpoint: (providerPanelElement.querySelector("#endpoint") as HTMLInputElement).value,
                    accessKey: (providerPanelElement.querySelector("#accessKey") as HTMLInputElement).value,
                    secretKey: (providerPanelElement.querySelector("#secretKey") as HTMLInputElement).value,
                    bucket: (providerPanelElement.querySelector("#bucket") as HTMLInputElement).value,
                    pathStyle: (providerPanelElement.querySelector("#pathStyle") as HTMLInputElement).value === "true",
                    region: (providerPanelElement.querySelector("#region") as HTMLInputElement).value,
                    skipTlsVerify: (providerPanelElement.querySelector("#s3SkipTlsVerify") as HTMLInputElement).value === "true",
                    timeout: timeout,
                };
                fetchPost("/api/sync/setSyncProviderS3", {s3}, () => {
                    window.siyuan.config.sync.s3 = s3;
                });
            } else if (window.siyuan.config.sync.provider === 3) {
                let timeout = parseInt((providerPanelElement.querySelector("#timeout") as HTMLInputElement).value, 10)
                if (7 > timeout) {
                    timeout = 7;
                }
                if (300 < timeout) {
                    timeout = 300;
                }
                (providerPanelElement.querySelector("#timeout") as HTMLInputElement).value = timeout.toString();
                const webdav = {
                    endpoint: (providerPanelElement.querySelector("#endpoint") as HTMLInputElement).value,
                    username: (providerPanelElement.querySelector("#username") as HTMLInputElement).value,
                    password: (providerPanelElement.querySelector("#password") as HTMLInputElement).value,
                    skipTlsVerify: (providerPanelElement.querySelector("#webdavSkipTlsVerify") as HTMLInputElement).value === "true",
                    timeout: timeout,
                };
                fetchPost("/api/sync/setSyncProviderWebDAV", {webdav}, () => {
                    window.siyuan.config.sync.webdav = webdav;
                });
            }
        });
    });
};

export const repos = {
    element: undefined as Element,
    genHTML: () => {
        let syncModeHTML = "";
        let syncProviderHTML = "";
        if (isMobile()) {
            syncModeHTML = `<div class="b3-label">
    ${window.siyuan.languages.syncMode}
    <div class="fn__hr"></div>
    <select id="syncMode" class="b3-select fn__block">
        <option value="1" ${window.siyuan.config.sync.mode === 1 ? "selected" : ""}>${window.siyuan.languages.syncMode1}</option>
        <option value="2" ${window.siyuan.config.sync.mode === 2 ? "selected" : ""}>${window.siyuan.languages.syncMode2}</option>
    </select>
    <div class="b3-label__text">${window.siyuan.languages.syncModeTip}</div>
</div>`;
            syncProviderHTML = `<div class="b3-label">
    ${window.siyuan.languages.syncProvider}
    <div class="fn__hr"></div>
    <select id="syncProvider" class="b3-select fn__block">
        <option value="0" ${window.siyuan.config.sync.provider === 0 ? "selected" : ""}>SiYuan</option>
        <option value="2" ${window.siyuan.config.sync.provider === 2 ? "selected" : ""}>S3</option>
        <option value="3" ${window.siyuan.config.sync.provider === 3 ? "selected" : ""}>WebDAV</option>
    </select>
    <div class="b3-label__text">${window.siyuan.languages.syncProviderTip}</div>
</div>`;
        } else {
            syncModeHTML = `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.syncMode}
        <div class="b3-label__text">${window.siyuan.languages.syncModeTip}</div>
    </div>
    <span class="fn__space"></span>
    <select id="syncMode" class="b3-select fn__flex-center fn__size200">
        <option value="1" ${window.siyuan.config.sync.mode === 1 ? "selected" : ""}>${window.siyuan.languages.syncMode1}</option>
        <option value="2" ${window.siyuan.config.sync.mode === 2 ? "selected" : ""}>${window.siyuan.languages.syncMode2}</option>
    </select>
</label>`;
            syncProviderHTML = `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.syncProvider}
        <div class="b3-label__text">${window.siyuan.languages.syncProviderTip}</div>
    </div>
    <span class="fn__space"></span>
    <select id="syncProvider" class="b3-select fn__flex-center fn__size200">
        <option value="0" ${window.siyuan.config.sync.provider === 0 ? "selected" : ""}>SiYuan</option>
        <option value="2" ${window.siyuan.config.sync.provider === 2 ? "selected" : ""}>S3</option>
        <option value="3" ${window.siyuan.config.sync.provider === 3 ? "selected" : ""}>WebDAV</option>
    </select>
</label>`;
        }
        return `<div><div style="position: fixed;width: 800px;height: 434px;box-sizing: border-box;text-align: center;display: flex;align-items: center;justify-content: center;z-index: 1;" id="reposLoading">
    <img src="/stage/loading-pure.svg">
</div>
${syncProviderHTML}
<div id="syncProviderPanel" class="b3-label">
    ${renderProvider(window.siyuan.config.sync.provider)}
</div>
<div id="reposData" class="b3-label">
    <div class="fn__flex">
        <div class="fn__flex-1">
            ${window.siyuan.languages.cloudStorage}
        </div>
        <div class="fn__flex-1">
            ${window.siyuan.languages.trafficStat}
        </div>
    </div>
</div>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.openSyncTip1}
        <div class="b3-label__text">${window.siyuan.languages.openSyncTip2}</div>
    </div>
    <span class="fn__space"></span>
    <input type="checkbox" id="reposCloudSyncSwitch"${window.siyuan.config.sync.enabled ? " checked='checked'" : ""} class="b3-switch fn__flex-center">
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.generateConflictDoc}
        <div class="b3-label__text">${window.siyuan.languages.generateConflictDocTip}</div>
    </div>
    <span class="fn__space"></span>
    <input type="checkbox" id="generateConflictDoc"${window.siyuan.config.sync.generateConflictDoc ? " checked='checked'" : ""} class="b3-switch fn__flex-center">
</label>
${syncModeHTML}
<div class="b3-label">
    <label class="fn__flex">
        <div class="fn__flex-center">${window.siyuan.languages.cloudSyncDir}</div>
        <div class="fn__flex-1"></div>
        <button class="b3-button b3-button--outline fn__flex-center${isMobile() ? "" : " fn__size200"}" data-type="config">
            <svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.config}
        </button>
    </label>
    <div id="reposCloudSyncList" class="fn__none config-repos__sync"><img style="margin: 0 auto;display: block;width: 64px;height: 100%" src="/stage/loading-pure.svg"></div>
</div>
<div class="b3-label fn__flex">
    <div class="fn__flex-center">${window.siyuan.languages.cloudBackup}</div>
    <div class="b3-list-item__meta fn__flex-center">${window.siyuan.languages.cloudBackupTip}</div>
</div>
</div>`;
    },
    bindEvent: () => {
        bindProviderEvent();
        const switchElement = repos.element.querySelector("#reposCloudSyncSwitch") as HTMLInputElement;
        switchElement.addEventListener("change", () => {
            if (switchElement.checked && window.siyuan.config.sync.cloudName === "") {
                switchElement.checked = false;
                showMessage(window.siyuan.languages._kernel[123]);
                return;
            }
            fetchPost("/api/sync/setSyncEnable", {enabled: switchElement.checked}, (response) => {
                if (response.code === 1) {
                    showMessage(response.msg);
                    switchElement.checked = false;
                } else {
                    window.siyuan.config.sync.enabled = switchElement.checked;
                }
            });
        });
        const switchConflictElement = repos.element.querySelector("#generateConflictDoc") as HTMLInputElement;
        switchConflictElement.addEventListener("change", () => {
            fetchPost("/api/sync/setSyncGenerateConflictDoc", {enabled: switchConflictElement.checked}, () => {
                window.siyuan.config.sync.generateConflictDoc = switchConflictElement.checked;
            });
        });
        const syncModeElement = repos.element.querySelector("#syncMode") as HTMLSelectElement;
        syncModeElement.addEventListener("change", () => {
            fetchPost("/api/sync/setSyncMode", {mode: parseInt(syncModeElement.value, 10)}, (response) => {
                if (response.code === 1) {
                    showMessage(response.msg);
                    syncModeElement.value = "1";
                } else {
                    window.siyuan.config.sync.mode = parseInt(syncModeElement.value, 10);
                }
            });
        });
        const syncConfigElement = repos.element.querySelector("#reposCloudSyncList");
        const syncProviderElement = repos.element.querySelector("#syncProvider") as HTMLSelectElement;
        syncProviderElement.addEventListener("change", () => {
            fetchPost("/api/sync/setSyncProvider", {provider: parseInt(syncProviderElement.value, 10)}, (response) => {
                if (response.code === 1) {
                    showMessage(response.msg);
                    syncProviderElement.value = "0";
                    window.siyuan.config.sync.provider = 0;
                } else {
                    window.siyuan.config.sync.provider = parseInt(syncProviderElement.value, 10);
                }
                repos.element.querySelector("#syncProviderPanel").innerHTML = renderProvider(window.siyuan.config.sync.provider);
                bindProviderEvent();
                syncConfigElement.innerHTML = "";
            });
        });
        const loadingElement = repos.element.querySelector("#reposLoading") as HTMLElement;
        loadingElement.style.width = repos.element.clientWidth + "px";
        loadingElement.style.height = repos.element.clientHeight + "px";
        bindSyncCloudListEvent(syncConfigElement);
        repos.element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (target.getAttribute("data-type") === "config") {
                if (syncConfigElement.classList.contains("fn__none")) {
                    getSyncCloudList(syncConfigElement, true);
                    syncConfigElement.classList.remove("fn__none");
                } else {
                    syncConfigElement.classList.add("fn__none");
                }
                return;
            }
            const eyeElement = hasClosestByClassName(target, "b3-form__icona-icon");
            if (eyeElement) {
                const isEye = eyeElement.firstElementChild.getAttribute("xlink:href") === "#iconEye";
                eyeElement.firstElementChild.setAttribute("xlink:href", isEye ? "#iconEyeoff" : "#iconEye");
                eyeElement.previousElementSibling.setAttribute("type", isEye ? "text" : "password");
            }
        });
    },
};
