import type {SettingTabBuilder} from "../setting/builder";
import {registerAccountGroup} from "./accountUi";
import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {processSync} from "../../dialog/processSystem";
import {writeText} from "../../protyle/util/compatibility";
import {bindSyncCloudListEvent, renderSyncCloudList, setKey} from "../../sync/syncGuide";
import {Dialog} from "../../dialog";
import {genConfigItemMainHtml, genConfigItemName} from "../render/fragments";
import {getSyncProviderConfigKeywords} from "./syncUi";
import {patchSyncConfig} from "./syncRuntime";
import {openHistory} from "../../history/history";

const registerSyncGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("sync", window.siyuan.languages.configGroupSync);

    group.select("sync.provider", {
        title: window.siyuan.languages.syncProvider,
        desc: window.siyuan.languages.syncProviderTip,
        options: [
            {value: 0, label: "SiYuan"},
            {value: 2, label: "S3"},
            {value: 3, label: "WebDAV"},
            ...(["std", "docker"].includes(window.siyuan.config.system.container) ? [{value: 4, label: window.siyuan.languages.localFileSystem}] : []),
        ],
        save: (value) => patchSyncConfig("sync.provider", value),
    });
    group.slot({
        key: "syncProviderConfig",
        keywords: getSyncProviderConfigKeywords(),
        html: () => '<div id="syncProviderConfig" class="b3-label config-item"></div>',
    });
    group.slot({
        key: "cloudSpace",
        keywords: [window.siyuan.languages.cloudStorage, window.siyuan.languages.trafficStat, window.siyuan.languages.backup],
        html: () => '<div id="cloudSpace" class="b3-label config-item"></div>',
    });
    group.switch("sync.enabled", {
        title: window.siyuan.languages.openSyncTip1,
        desc: window.siyuan.languages.openSyncTip2,
        save: (value) => patchSyncConfig("sync.enabled", value),
    });
    group.switch("sync.generateConflictDoc", {
        title: window.siyuan.languages.generateConflictDoc,
        desc: window.siyuan.languages.generateConflictDocTip,
        save: (value) => patchSyncConfig("sync.generateConflictDoc", value),
    });
    group.select("sync.mode", {
        title: window.siyuan.languages.syncMode,
        desc: window.siyuan.languages.syncModeTip,
        options: [
            {value: 1, label: window.siyuan.languages.syncMode1},
            {value: 2, label: window.siyuan.languages.syncMode2},
            {value: 3, label: window.siyuan.languages.syncMode3},
        ],
        save: (value) => patchSyncConfig("sync.mode", value),
    });
    group.number("sync.interval", {
        title: window.siyuan.languages.syncInterval,
        desc: window.siyuan.languages.syncIntervalTip,
        min: 30,
        max: 43200,
        unit: window.siyuan.languages.second,
        save: (value) => patchSyncConfig("sync.interval", value),
    });
    group.switch("sync.perception", {
        title: window.siyuan.languages.syncPerception,
        desc: window.siyuan.languages.syncPerceptionTip,
        save: (value) => patchSyncConfig("sync.perception", value),
    });
    group.slot({
        key: "syncCloudDir",
        keywords: [window.siyuan.languages.cloudSyncDir, window.siyuan.languages.cloudSyncDirTip, window.siyuan.languages.config],
        html: () => `<div class="b3-label config-item" id="syncCloudDirBlock">
    <div class="fn__flex config-wrap">
        ${genConfigItemMainHtml(window.siyuan.languages.cloudSyncDir, window.siyuan.languages.cloudSyncDirTip)}
        <div class="fn__space"></div>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="config">
            <svg><use xlink:href="#iconSettings"></use></svg>${window.siyuan.languages.config}
        </button>
    </div>
    <div id="syncCloudList" class="fn__none"></div>
</div>`,
        afterMount: mountSyncCloudDir,
    });
    group.slot({
        key: "syncCloudBackup",
        keywords: [
            window.siyuan.languages.cloudBackup,
            window.siyuan.languages.cloudBackupTip,
            window.siyuan.languages.dataSnapshot,
        ],
        html: () => `<div class="b3-label config-item" id="syncCloudBackupBlock">
    <div class="fn__flex config-wrap">
        ${genConfigItemMainHtml(window.siyuan.languages.cloudBackup, window.siyuan.languages.cloudBackupTip)}
        <div class="fn__space"></div>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" id="openCloudBackup">
            <svg><use xlink:href="#iconHistory"></use></svg>${window.siyuan.languages.dataSnapshot}
        </button>
    </div>
</div>`,
        afterMount: (root) => {
            root.querySelector("#openCloudBackup")?.addEventListener("click", () => {
                openHistory(window.siyuan.ws.app, "repo");
            });
        },
    });
};

const mountSyncCloudDir = (root: HTMLElement) => {
    const cloudListElement = root.querySelector("#syncCloudList");
    if (cloudListElement) {
        bindSyncCloudListEvent(cloudListElement);
        root.querySelector('#syncCloudDirBlock [data-action="config"]')?.addEventListener("click", () => {
            const hidden = cloudListElement.classList.toggle("fn__none");
            if (!hidden) {
                renderSyncCloudList(cloudListElement, true);
            }
        });
    }
};

const registerRepoGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("repo", window.siyuan.languages.configGroupLocalDataRepo);

    group.slot({
        key: "repoKey",
        keywords: [
            window.siyuan.languages.dataRepoKey,
            window.siyuan.languages.dataRepoKeyTip1,
            window.siyuan.languages.dataRepoKeyTip2,
            window.siyuan.languages.importKey,
            window.siyuan.languages.genKey,
            window.siyuan.languages.genKeyByPW,
            window.siyuan.languages.copyKey,
            window.siyuan.languages.resetRepo,
        ],
        html: () => `<div class="fn__flex b3-label config-item config-wrap">
    <div class="fn__flex-1 fn__flex-center">
        ${genConfigItemName(window.siyuan.languages.dataRepoKey)}
        <div class="fn__hr--small"></div>
        <div class="b3-label__text">
            ${window.siyuan.languages.dataRepoKeyTip1}
            <div class="fn__hr--small"></div>
            <span class="ft__error">${window.siyuan.languages.dataRepoKeyTip2}</span>
        </div>
    </div>
    <div class="fn__space"></div>
    <div class="fn__size200 fn__flex-center fn__none" id="repoKeyActionsEmpty">
        <button class="b3-button b3-button--outline fn__block" id="importKey"><svg><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.importKey}</button>
        <div class="fn__hr"></div>
        <button class="b3-button b3-button--outline fn__block" id="initKey"><svg><use xlink:href="#iconLock"></use></svg>${window.siyuan.languages.genKey}</button>
        <div class="fn__hr"></div>
        <button class="b3-button b3-button--outline fn__block" id="initKeyByPW"><svg><use xlink:href="#iconHand"></use></svg>${window.siyuan.languages.genKeyByPW}</button>
    </div>
    <div class="fn__size200 fn__flex-center fn__none" id="repoKeyActionsSet">
        <button class="b3-button b3-button--outline fn__block" id="copyKey"><svg><use xlink:href="#iconCopy"></use></svg>${window.siyuan.languages.copyKey}</button>
        <div class="fn__hr"></div>
        <button class="b3-button b3-button--outline fn__block" id="resetRepo"><svg><use xlink:href="#iconUndo"></use></svg>${window.siyuan.languages.resetRepo}</button>
    </div>
</div>`,
        afterMount: mountRepoKey,
    });
    group.stack({
        key: "repoPurge",
        keywords: [
            window.siyuan.languages.dataRepoPurge,
            window.siyuan.languages.dataRepoPurgeTip,
            window.siyuan.languages.dataRepoAutoPurgeIndexRetentionDays,
            window.siyuan.languages.dataRepoAutoPurgeRetentionIndexesDaily,
        ],
        afterMount: (root) => {
            root.querySelector("#purgeRepo")?.addEventListener("click", () => {
                confirmDialog("♻️ " + window.siyuan.languages.dataRepoPurge, window.siyuan.languages.dataRepoPurgeConfirm, () => {
                    fetchPost("/api/repo/purgeRepo");
                });
            });
        },
    }, (stack) => {
        stack.title(window.siyuan.languages.dataRepoPurge);
        stack.desc(window.siyuan.languages.dataRepoPurgeTip);
        stack.button({
            id: "purgeRepo",
            label: window.siyuan.languages.purge,
            icon: "iconTrashcan",
        });
        stack.number("repo.indexRetentionDays", {
            desc: window.siyuan.languages.dataRepoAutoPurgeIndexRetentionDays,
            min: 1,
        });
        stack.number("repo.retentionIndexesDaily", {
            desc: window.siyuan.languages.dataRepoAutoPurgeRetentionIndexesDaily,
            min: 1,
        });
    });
};

const mountRepoKey = (root: HTMLElement) => {
    const emptyElement = root.querySelector("#repoKeyActionsEmpty");
    const setElement = root.querySelector("#repoKeyActionsSet");
    const toggleRepoKeyActions = () => {
        const hasKey = Boolean(window.siyuan.config.repo.key);
        emptyElement?.classList.toggle("fn__none", hasKey);
        setElement?.classList.toggle("fn__none", !hasKey);
    };
    toggleRepoKeyActions();
    root.querySelector("#importKey")?.addEventListener("click", () => {
        const passwordDialog = new Dialog({
            title: "🔑 " + window.siyuan.languages.key,
            content: `<div class="b3-dialog__content" style="display:flex">
    <textarea spellcheck="false" style="resize: none;flex:1" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.keyPlaceholder}"></textarea>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: "520px",
            height: "260px",
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
                toggleRepoKeyActions();
                passwordDialog.destroy();
            });
        });
    });
    root.querySelector("#initKey")?.addEventListener("click", () => {
        confirmDialog("🔑 " + window.siyuan.languages.genKey, window.siyuan.languages.initRepoKeyTip, () => {
            fetchPost("/api/repo/initRepoKey", {}, (response) => {
                window.siyuan.config.repo.key = response.data.key;
                toggleRepoKeyActions();
            });
        });
    });
    root.querySelector("#initKeyByPW")?.addEventListener("click", () => {
        setKey(false, () => {
            toggleRepoKeyActions();
        });
    });
    root.querySelector("#copyKey")?.addEventListener("click", () => {
        writeText(window.siyuan.config.repo.key);
        showMessage(window.siyuan.languages.copied);
    });
    root.querySelector("#resetRepo")?.addEventListener("click", () => {
        confirmDialog("⚠️ " + window.siyuan.languages.resetRepo, window.siyuan.languages.resetRepoTip, () => {
            fetchPost("/api/repo/resetRepo", {}, () => {
                window.siyuan.config.repo.key = "";
                window.siyuan.config.sync.enabled = false;
                processSync();
                toggleRepoKeyActions();
            });
        });
    });
};

export const registerSyncTab = (tab: SettingTabBuilder) => {
    registerAccountGroup(tab);
    registerSyncGroup(tab);
    registerRepoGroup(tab);
};
