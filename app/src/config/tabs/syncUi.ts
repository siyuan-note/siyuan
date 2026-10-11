import {config as configApi} from "../util/configApi";
import {showMessage} from "../../dialog/message";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {ContractFormData} from "../../util/contractFormData";
import type {APICallbackResponse, APIPOSTRoutes} from "../../types/api";
import {confirmDialog} from "../../dialog/confirmDialog";
import {isInIOS, saveExportFile} from "../../protyle/util/compatibility";
import {isPaidUser, needSubscribe} from "../../util/needSubscribe";
import {getCloudURL} from "../util/about";
import {getHostCapabilities, sanitizeKernelHTML} from "../../util/hostCapabilities";
import {Dialog} from "../../dialog";
import {escapeHtml} from "../../util/escape";
import {isMobile} from "../../util/functions";

/** 按当前配置刷新同步 Tab 可见性与动态面板（供 syncRuntime 调用） */
export const refreshSyncTabPanels = (root: Element) => {
    setSyncConfigItemVisible(root);
    setSyncModeRelatedConfigItemVisible(root);
    renderProviderConfig(root);
    renderCloudSpace(root);
};

/** 仅刷新与同步模式相关的配置项可见性（供 syncRuntime 调用） */
export const refreshSyncModeRelatedItems = (root: Element) => {
    setSyncModeRelatedConfigItemVisible(root);
};

/** 根据云端同步和运行环境刷新局域网同步配置项可见性 */
export const refreshLANSyncConfigItemVisibility = (root: Element) => {
    const visible = window.siyuan.config.sync.provider === 0 ? !needSubscribe("") : isPaidUser();
    root.querySelector(`#${CSS.escape("sync.lan.enabled")}`)?.closest(".config-item")?.classList.toggle(
        "fn__none", !visible || !window.siyuan.config.sync.enabled || window.siyuan.config.system.container === "docker");
};

/** 搜索时区分局域网同步的前置条件和硬性使用限制 */
export const getLANSyncSearchAvailability = () => {
    const entitled = window.siyuan.config.sync.provider === 0 ? !needSubscribe("") : isPaidUser();
    if (!entitled || window.siyuan.config.system.container === "docker") {
        return {available: false};
    }
    if (!window.siyuan.config.sync.enabled) {
        return {available: false, reason: window.siyuan.languages._kernel[53]};
    }
    return {available: true};
};

const setSyncConfigItemVisible = (root: Element) => {
    const visible = window.siyuan.config.sync.provider === 0 ? !needSubscribe("") : isPaidUser();
    [
        "cloudSpace",
        "sync.enabled",
        "sync.generateConflictDoc",
        "sync.mode",
        "sync.assetDownloadMode",
        "sync.interval",
        "sync.perception",
        "sync.lan.enabled",
        "syncCloudDirBlock",
        "syncCloudBackupBlock",
    ]
    .forEach((id) => {
        root.querySelector(`#${CSS.escape(id)}`)?.closest(".config-item")?.classList.toggle("fn__none", !visible);
    });
    refreshLANSyncConfigItemVisibility(root);
};

const setSyncModeRelatedConfigItemVisible = (root: Element) => {
    const syncModeElement = root.querySelector(`#${CSS.escape("sync.mode")}`) as HTMLSelectElement | null;
    if (!syncModeElement) {
        return;
    }
    const syncMode: Config.ISync["mode"] = Number(syncModeElement.value);
    const isProviderOfficialAutoSync = syncMode === 1 && !needSubscribe("");
    root.querySelector(`#${CSS.escape("sync.interval")}`)?.closest(".config-item")?.classList.toggle("fn__none", !isProviderOfficialAutoSync);
    root.querySelector(`#${CSS.escape("sync.perception")}`)?.closest(".config-item")?.classList.toggle("fn__none", !(isProviderOfficialAutoSync && window.siyuan.config.sync.provider === 0 && window.siyuan.config.system.container !== "docker"));
};

/** 同步提供商配置区检索关键词（供 syncTab 注册 slot） */
export const getSyncProviderConfigKeywords = (): string[] => buildProviderConfigKeywords();

type SyncProviderConfigKey = Extract<keyof Config.ISync, "s3" | "webdav" | "local">;

type SyncProviderFieldDef =
    | {type: "input"; label: string; id: string; attrs?: string}
    | {type: "password"; label: string; id: string}
    | {type: "select"; label: string; id: string; options: {value: string; label: string}[]};

type SyncProviderIntroDef = {
    genIntro: () => string;
    genUnpaidIntro: () => string;
    isProviderConfigAllowed: () => boolean;
};

type SyncThirdPartyProviderDef = SyncProviderIntroDef & {
    configKey: SyncProviderConfigKey;
    requiredFields: string[];
    api: string;
    getConfig: () => Config.ISync[SyncProviderConfigKey];
    fields: SyncProviderFieldDef[];
};

type SyncProviderDef = SyncProviderIntroDef | SyncThirdPartyProviderDef;

const isThirdPartySyncProviderDef = (def: SyncProviderDef): def is SyncThirdPartyProviderDef => {
    return "configKey" in def;
};

const genThirdPartyUnpaidIntro = (): string => {
    const accountServer = getCloudURL("");
    return `<div>
    ${window.siyuan.languages._kernel[214].replaceAll("${accountServer}", accountServer)}
</div>`;
};

const SYNC_PROVIDER_DEFS: Record<Config.ISync["provider"], SyncProviderDef> = {
    0: {
        isProviderConfigAllowed: () => !needSubscribe(""),
        genIntro: () => `<div class="b3-label b3-label--inner">${window.siyuan.languages.syncOfficialProviderIntro}</div>`,
        genUnpaidIntro: () => {
            const accountServer = getCloudURL("");
            return `<div class="b3-label b3-label--inner">
    ${isInIOS() ? window.siyuan.languages._kernel[295] : window.siyuan.languages._kernel[29].replaceAll("${accountServer}", accountServer)}
</div>
<div class="b3-label b3-label--inner">
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
<div class="b3-label b3-label--inner">
    ${window.siyuan.languages.cloudIntro9}
    <div class="b3-label__text">
        <ul style="padding-left: 2em">
            <li>${window.siyuan.languages.cloudIntro10}</li>
            <li>${window.siyuan.languages.cloudIntro11}</li>
        </ul>
    </div>
</div>`;
        },
    },
    2: {
        isProviderConfigAllowed: isPaidUser,
        configKey: "s3",
        requiredFields: ["endpoint", "accessKey", "secretKey", "bucket", "region"],

        getConfig: () => window.siyuan.config.sync.s3,
        genIntro: () => `<div class="b3-label b3-label--inner">
    ${window.siyuan.languages.syncThirdPartyProviderS3Intro}
    <div class="fn__hr"></div>
    <em>${window.siyuan.languages.proFeature}</em>
    <div class="fn__hr"></div>
    ${window.siyuan.languages.syncThirdPartyProviderTip}
</div>`,
        genUnpaidIntro: genThirdPartyUnpaidIntro,
        fields: [
            {type: "input", label: "Endpoint", id: "endpoint"},
            {type: "input", label: "Access Key", id: "accessKey"},
            {type: "password", label: "Secret Key", id: "secretKey"},
            {type: "input", label: "Bucket", id: "bucket"},
            {type: "input", label: "Region ID", id: "region"},
            {type: "input", label: "Timeout (s)", id: "timeout", attrs: 'type="number" min="7" max="300"'},
            {type: "select", label: "Addressing", id: "pathStyle", options: [
                {value: "true", label: "Path-style"},
                {value: "false", label: "Virtual-hosted-style"},
            ]},
            {type: "select", label: "TLS Verify", id: "skipTlsVerify", options: [
                {value: "false", label: "Verify"},
                {value: "true", label: "Skip"},
            ]},
            {type: "input", label: "Concurrent Reqs", id: "concurrentReqs", attrs: 'type="number" min="1" max="16"'},
        ],
    },
    3: {
        isProviderConfigAllowed: isPaidUser,
        configKey: "webdav",
        requiredFields: ["endpoint"],

        getConfig: () => window.siyuan.config.sync.webdav,
        genIntro: () => `<div class="b3-label b3-label--inner">
    ${window.siyuan.languages.syncThirdPartyProviderWebDAVIntro}
    <div class="fn__hr"></div>
    <em>${window.siyuan.languages.proFeature}</em>
    <div class="fn__hr"></div>
    ${window.siyuan.languages.syncThirdPartyProviderTip}
</div>`,
        genUnpaidIntro: genThirdPartyUnpaidIntro,
        fields: [
            {type: "input", label: "Endpoint", id: "endpoint"},
            {type: "input", label: "Username", id: "username"},
            {type: "password", label: "Password", id: "password"},
            {type: "input", label: "Timeout (s)", id: "timeout", attrs: 'type="number" min="7" max="300"'},
            {type: "select", label: "TLS Verify", id: "skipTlsVerify", options: [
                {value: "false", label: "Verify"},
                {value: "true", label: "Skip"},
            ]},
            {type: "input", label: "Concurrent Reqs", id: "concurrentReqs", attrs: 'type="number" min="1" max="16"'},
        ],
    },
    4: {
        isProviderConfigAllowed: isPaidUser,
        configKey: "local",
        requiredFields: ["endpoint"],

        getConfig: () => window.siyuan.config.sync.local,
        genIntro: () => `<div class="b3-label b3-label--inner">
    <div class="ft__error">
        ${window.siyuan.languages.mobileNotSupport}
    </div>
    <div class="fn__hr"></div>
    ${window.siyuan.languages.syncThirdPartyProviderLocalIntro}
    <div class="fn__hr"></div>
    <em>${window.siyuan.languages.proFeature}</em>
</div>`,
        genUnpaidIntro: () => `${genThirdPartyUnpaidIntro()}<div class="ft__error">
    <div class="fn__hr--b"></div>
    ${window.siyuan.languages.mobileNotSupport}
</div>`,
        fields: [
            {type: "input", label: "Endpoint", id: "endpoint"},
            {type: "input", label: "Timeout (s)", id: "timeout", attrs: 'type="number" min="7" max="300"'},
            {type: "input", label: "Concurrent Reqs", id: "concurrentReqs", attrs: 'type="number" min="1" max="1024"'},
        ],
    },
};

const buildProviderConfigKeywords = (): string[] => {
    const accountServer = getCloudURL("");
    return [
        // 官方云（provider === 0）
        window.siyuan.languages.syncOfficialProviderIntro,
        window.siyuan.languages._kernel[29].replaceAll("${accountServer}", accountServer),
        window.siyuan.languages._kernel[295],
        window.siyuan.languages.cloudIntro1,
        window.siyuan.languages.cloudIntro2,
        window.siyuan.languages.cloudIntro3,
        window.siyuan.languages.cloudIntro4,
        window.siyuan.languages.cloudIntro5,
        window.siyuan.languages.cloudIntro6,
        window.siyuan.languages.cloudIntro7,
        window.siyuan.languages.cloudIntro8,
        window.siyuan.languages.cloudIntro9,
        window.siyuan.languages.cloudIntro10,
        window.siyuan.languages.cloudIntro11,
        // 未订阅 / 本地等提示
        window.siyuan.languages._kernel[214].replaceAll("${accountServer}", accountServer),
        window.siyuan.languages.mobileNotSupport,
        // S3 / WebDAV / 本地第三方
        window.siyuan.languages.syncThirdPartyProviderS3Intro,
        window.siyuan.languages.syncThirdPartyProviderWebDAVIntro,
        window.siyuan.languages.syncThirdPartyProviderLocalIntro,
        window.siyuan.languages.proFeature,
        window.siyuan.languages.syncThirdPartyProviderTip,
        // 操作按钮
        window.siyuan.languages.cloudStoragePurge,
        window.siyuan.languages.import,
        window.siyuan.languages.export,
        window.siyuan.languages.syncConfig,
        window.siyuan.languages.clearSyncConfig,
        // 表单标签与选项（硬编码英文）
        "Endpoint",
        "Access Key",
        "Secret Key",
        "Bucket",
        "Region ID",
        "Timeout (s)",
        "Addressing",
        "Path-style",
        "Virtual-hosted-style",
        "TLS Verify",
        "Verify",
        "Skip",
        "Concurrent Reqs",
        "Username",
        "Password",
    ];
};

const renderProviderConfig = (root: Element) => {
    const providerConfigElement = root.querySelector("#syncProviderConfig");
    if (!providerConfigElement) {
        return;
    }

    const def = SYNC_PROVIDER_DEFS[window.siyuan.config.sync.provider];
    let html = "";
    if (def) {
        if (!def.isProviderConfigAllowed()) {
            html = def.genUnpaidIntro();
        } else if (isThirdPartySyncProviderDef(def)) {
            html = `${def.genIntro()}<div class="b3-label b3-label--inner fn__flex">
    <div class="fn__flex-1">${window.siyuan.languages.syncConfig}<div class="b3-label__text ft__breakword">${escapeHtml(def.getConfig().endpoint || "-")}</div></div>
    <div class="fn__space"></div><button class="b3-button b3-button--outline fn__flex-center" data-action="configureSync"${window.siyuan.config.readonly ? " disabled" : ""}>${window.siyuan.languages.config}</button>
</div>${genProviderActionButtons(def.configKey)}`;
        } else {
            html = def.genIntro();
        }
    }

    providerConfigElement.innerHTML = html;
    bindProviderConfigEvent(providerConfigElement, root);
};

const genProviderField = (field: SyncProviderFieldDef): string => {
    switch (field.type) {
        case "input":
            return genProviderFlexInput(field.label, field.id, field.attrs);
        case "password":
            return genProviderFlexPassword(field.label, field.id);
        case "select":
            return genProviderFlexSelect(field.label, field.id, field.options.map((option) => `
    <option value="${option.value}">${option.label}</option>`).join(""));
    }
};

const genProviderFlexInput = (label: string, id: string, attrs = "") => `<div class="b3-label b3-label--inner fn__flex config-sync-field">
    <label for="${id}" class="fn__flex-center fn__size200">${label}</label>
    <div class="fn__space"></div>
    <div class="fn__flex-1"><input spellcheck="false" id="${id}" class="b3-text-field fn__block" aria-describedby="sync-${id}-error"${attrs ? ` ${attrs}` : ""}>
    <div id="sync-${id}-error" class="ft__error fn__none" role="status"></div></div>
</div>`;

const genProviderFlexPassword = (label: string, id: string) => `<div class="b3-label b3-label--inner fn__flex config-sync-field">
    <label for="${id}" class="fn__flex-center fn__size200">${label}</label>
    <div class="fn__space"></div>
    <div class="fn__flex-1"><div class="b3-form__icona fn__block">
        <input spellcheck="false" id="${id}" type="password" class="b3-text-field b3-form__icona-input" aria-describedby="sync-${id}-error">
        <svg class="b3-form__icona-icon" data-action="togglePassword"><use xlink:href="#iconEye"></use></svg>
    </div><div id="sync-${id}-error" class="ft__error fn__none" role="status"></div></div>
</div>`;

const genProviderFlexSelect = (label: string, id: string, optionsHtml: string) => `<div class="b3-label b3-label--inner fn__flex config-sync-field">
    <label for="${id}" class="fn__flex-center fn__size200">${label}</label>
    <div class="fn__space"></div>
    <div class="fn__flex-1"><select class="b3-select fn__block" id="${id}">
        ${optionsHtml}
    </select></div>
</div>`;

const genProviderActionButtons = (dataType: SyncProviderConfigKey) => {
    const importExportHtml = getHostCapabilities().importExport && (dataType === "s3" || dataType === "webdav") ? `
    <button class="b3-button b3-button--outline fn__size200" style="position: relative">
        <input id="importSyncConfig" class="b3-form__upload" type="file" data-type="${dataType}">
        <svg><use xlink:href="#iconDownload"></use></svg>${window.siyuan.languages.import}
    </button>
    <button class="b3-button b3-button--outline fn__size200" id="exportSyncConfig" data-type="${dataType}">
        <svg><use xlink:href="#iconUpload"></use></svg>${window.siyuan.languages.export}
    </button>` : "";
    return `<div class="b3-label b3-label--inner fn__flex fn__flex-wrap" style="gap: 8px; justify-content: flex-end">
    <button class="b3-button b3-button--outline fn__size200" id="purgeCloudData">
        <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.cloudStoragePurge}
    </button>${importExportHtml}
</div>`;
};

const bindProviderConfigEvent = (configElement: Element, root: Element) => {
    const importElement = configElement.querySelector("#importSyncConfig") as HTMLInputElement;
    importElement?.addEventListener("change", () => {
        if (!getHostCapabilities().importExport) {
            return;
        }
        const formData = new ContractFormData({file: importElement.files[0]});
        const isS3 = importElement.getAttribute("data-type") === "s3";
        fetchPost(isS3 ? "/api/sync/importSyncProviderS3" : "/api/sync/importSyncProviderWebDAV", formData, (response: APICallbackResponse<APIPOSTRoutes["/api/sync/importSyncProviderS3" | "/api/sync/importSyncProviderWebDAV"]["response"]>) => {
            if (response.code !== 0 || !response.data) {
                return;
            }
            if ("s3" in response.data) {
                window.siyuan.config.sync.s3 = response.data.s3;
            } else {
                window.siyuan.config.sync.webdav = response.data.webdav;
            }
            renderProviderConfig(root);
            showMessage(window.siyuan.languages.imported);
        });
    });

    const exportButton = configElement.querySelector("#exportSyncConfig");
    exportButton?.addEventListener("click", () => {
        if (!getHostCapabilities().importExport) {
            return;
        }
        fetchPost(exportButton.getAttribute("data-type") === "s3" ? "/api/sync/exportSyncProviderS3" : "/api/sync/exportSyncProviderWebDAV", {}, (response) => {
            void saveExportFile(response.data.zip);
        });
    });

    configElement.querySelector("#purgeCloudData")?.addEventListener("click", () => {
        confirmDialog("♻️ " + window.siyuan.languages.cloudStoragePurge, `<div class="b3-typography">${window.siyuan.languages.cloudStoragePurgeConfirm}</div>`, () => {
            fetchPost("/api/repo/purgeCloudRepo");
        });
    });

    configElement.querySelector('[data-action="configureSync"]')?.addEventListener("click", () => {
        openSyncProviderConfigDialog(root);
    });
};

let syncProviderDialog: Dialog | undefined;

const validateSyncProviderFields = (configElement: Element, def: SyncThirdPartyProviderDef) => {
    let valid = true;
    def.fields.filter(field => field.type !== "select").forEach(field => {
        const key = field.id;
        const input = configElement.querySelector<HTMLInputElement>(`#${key}`);
        const missing = !input.value.trim() && (def.requiredFields.includes(key) || input.type === "number");
        const message = missing ? window.siyuan.languages._kernel[142] :
            input.type === "number" && !input.checkValidity() ? input.validationMessage : "";
        input.setAttribute("aria-invalid", String(!!message));
        const error = configElement.querySelector<HTMLElement>(`#sync-${key}-error`);
        error.textContent = message;
        error.classList.toggle("fn__none", !message);
        valid &&= !message;
    });
    return valid;
};

const openSyncProviderConfigDialog = (root: Element) => {
    if (window.siyuan.config.readonly) {
        return;
    }
    if (syncProviderDialog) {
        syncProviderDialog.element.querySelector<HTMLElement>(".b3-dialog__container").focus();
        return;
    }
    const provider = window.siyuan.config.sync.provider;
    const def = SYNC_PROVIDER_DEFS[provider];
    if (!def || !isThirdPartySyncProviderDef(def) || !def.isProviderConfigAllowed()) {
        return;
    }
    const L = window.siyuan.languages;
    const warning = def.configKey === "s3" ? `<div data-type="s3-endpoint-warning" class="b3-label b3-label--inner ft__error fn__none" role="status">${L.s3EndpointBucketWarning}</div>` : "";
    const dialog = new Dialog({
        title: `${L.syncConfig} - ${def.configKey === "s3" ? "S3" : def.configKey === "webdav" ? "WebDAV" : L.localFileSystem}`,
        width: isMobile() ? "92vw" : "680px",
        containerClassName: "config-sync-dialog",
        content: `<div class="b3-dialog__content config-sync-form">${def.fields.map(genProviderField).join("")}${warning}
<div data-type="sync-config-error" class="ft__error fn__none" role="status"></div></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--remove" data-action="clear">${L.clearSyncConfig}</button><div class="fn__flex-1"></div><div class="fn__space"></div>
    <button class="b3-button b3-button--cancel" data-action="cancel">${L.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="save">${L.save}</button>
</div>`,
        destroyCallback: () => {
            if (syncProviderDialog === dialog) {
                syncProviderDialog = undefined;
            }
        },
    });
    syncProviderDialog = dialog;
    const configElement = dialog.element;
    const template = {...def.getConfig()};
    fillSyncProviderConfigValues(configElement, template);
    const fields = def.fields.map(field => configElement.querySelector<HTMLInputElement | HTMLSelectElement>(`#${field.id}`));
    const initialValues = fields.map(field => field.value);
    const destroy = dialog.destroy.bind(dialog);
    let pending = false;
    let confirming = false;
    let validationShown = false;
    const setPending = (value: boolean) => {
        pending = value;
        configElement.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach(element => {
            element.disabled = value || (window.siyuan.config.readonly && element.getAttribute("data-action") !== "cancel");
        });
        configElement.setAttribute("aria-busy", String(value));
    };
    const setError = (message: string) => {
        const error = configElement.querySelector<HTMLElement>('[data-type="sync-config-error"]');
        error.textContent = message;
        error.classList.toggle("fn__none", !message);
    };
    dialog.destroy = () => {
        if (pending || confirming) {
            return;
        }
        if (fields.every((field, index) => field.value === initialValues[index])) {
            destroy();
        } else {
            confirming = true;
            confirmDialog(L.confirm, L.discardUnsavedChanges, () => destroy(), () => { confirming = false; });
        }
    };
    const refresh = () => {
        const currentRoot = root.isConnected ? root : document.querySelector("#syncProviderConfig")?.closest(".config__tab-container");
        if (currentRoot) {
            refreshSyncTabPanels(currentRoot);
            const enabled = currentRoot.querySelector<HTMLInputElement>('[id="sync.enabled"]');
            if (enabled) {
                enabled.checked = window.siyuan.config.sync.enabled;
            }
        }
    };
    const save = async () => {
        if (pending || confirming || window.siyuan.config.readonly) {
            return;
        }
        validationShown = true;
        if (!validateSyncProviderFields(configElement, def)) {
            setError(L.syncConfigNotSaved);
            configElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
            return;
        }
        setPending(true);
        setError("");
        try {
            let saved = false;
            await configApi.set(`sync.${def.configKey}`, readProviderConfigFields(configElement, template), () => {
                saved = true;
                refresh();
                destroy();
            });
            if (!saved) setError(L.syncConfigSaveFailed);
        } catch (error) {
            setError(error?.message || L.syncConfigSaveFailed);
        } finally {
            setPending(false);
        }
    };
    configElement.querySelector('[data-action="save"]').addEventListener("click", () => { void save(); });
    configElement.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.destroy());
    configElement.querySelector('[data-action="clear"]').addEventListener("click", () => {
        if (pending || confirming || window.siyuan.config.readonly) {
            return;
        }
        confirming = true;
        confirmDialog(L.clearSyncConfig, L.clearSyncConfigConfirm, () => {
            confirming = false;
            if (window.siyuan.config.readonly) {
                return;
            }
            setPending(true);
            setError("");
            void fetchSyncPost("/api/sync/clearSyncProviderConfig", {provider}).then(response => {
                if (response.code !== 0) {
                    setError(response.msg || L.syncConfigSaveFailed);
                    return;
                }
                if (response.data.s3) {
                    window.siyuan.config.sync.s3 = response.data.s3;
                }
                if (response.data.webdav) {
                    window.siyuan.config.sync.webdav = response.data.webdav;
                }
                if (response.data.local) {
                    window.siyuan.config.sync.local = response.data.local;
                }
                window.siyuan.config.sync.enabled = response.data.enabled;
                refresh();
                destroy();
            }).catch(() => setError(L.syncConfigSaveFailed)).finally(() => setPending(false));
        }, () => { confirming = false; }, true, undefined, L.clearSyncConfig);
    });
    configElement.addEventListener("input", () => {
        updateS3EndpointWarning(configElement);
        if (validationShown) {
            validateSyncProviderFields(configElement, def);
        }
    });
    configElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing || event.repeat) {
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dialog.destroy();
        } else if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
            event.preventDefault();
            event.stopPropagation();
            void save();
        }
    });
    configElement.querySelector('[data-action="togglePassword"]')?.addEventListener("click", () => {
        const input = configElement.querySelector<HTMLInputElement>('input[id="secretKey"], input[id="password"]');
        const icon = configElement.querySelector('[data-action="togglePassword"] use');
        input.type = input.type === "password" ? "text" : "password";
        icon.setAttribute("xlink:href", input.type === "password" ? "#iconEye" : "#iconEyeoff");
    });
    fields[0].focus();
};

const fillSyncProviderConfigValues = (configElement: Element, data: Config.ISync[SyncProviderConfigKey]) => {
    (Object.keys(data) as (keyof typeof data & string)[]).forEach((key) => {
        const el = configElement.querySelector(`#${key}`) as HTMLInputElement | HTMLSelectElement | null;
        if (el) {
            el.value = String(data[key]);
        }
    });
    updateS3EndpointWarning(configElement);
};

const updateS3EndpointWarning = (configElement: Element) => {
    const warning = configElement.querySelector('[data-type="s3-endpoint-warning"]');
    if (!warning) {
        return;
    }
    const endpoint = configElement.querySelector<HTMLInputElement>("#endpoint").value.trim();
    const bucket = configElement.querySelector<HTMLInputElement>("#bucket").value.trim().toLowerCase();
    let suspicious = false;
    try {
        const url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
        suspicious = !!bucket && ["http:", "https:"].includes(url.protocol) &&
            url.hostname.toLowerCase().startsWith(`${bucket}.`);
    } catch {
        // 不完整的地址由配置校验处理，这里只提示重复桶名。
    }
    warning.classList.toggle("fn__none", !suspicious);
};

const readProviderConfigFields = <T extends object>(configElement: Element, template: T): T => {
    const result = {} as Record<string, unknown>;
    (Object.keys(template) as (keyof T & string)[]).forEach((key) => {
        const el = configElement.querySelector(`#${key}`) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) {
            return;
        }
        const sample = template[key];
        if (typeof sample === "boolean") {
            result[key] = el.value === "true";
        } else if (typeof sample === "number") {
            result[key] = parseInt(el.value, 10);
        } else {
            result[key] = el.value;
        }
    });
    return result as T;
};

const renderCloudSpace = (root: Element) => {
    const cloudSpaceElement = root.querySelector("#cloudSpace");
    if (!cloudSpaceElement) {
        return;
    }

    const isProviderOfficial = window.siyuan.config.sync.provider === 0;
    const subscribed = !needSubscribe("");
    const hidden = cloudSpaceElement.classList.toggle("fn__none", !isProviderOfficial || !subscribed);
    if (!hidden) {
        cloudSpaceElement.innerHTML = buildCloudSpaceHtml(
            Object.fromEntries(CLOUD_SPACE_DISPLAY_KEYS.map((key) => [key, "0B"])) as CloudSpaceDisplayData,
            true
        );
        fetchSyncPost("/api/cloud/getCloudSpace").then((response) => {
            if (response.code === 1) {
                cloudSpaceElement.innerHTML = `<span class="ft__error">${sanitizeKernelHTML(response.msg)}</span>`;
                return;
            }
            if (response.code !== 0 || !response.data) {
                return;
            }
            cloudSpaceElement.innerHTML = buildCloudSpaceHtml({
                syncSize: response.data.sync.hSize,
                backupSize: response.data.backup.hSize,
                hAssetSize: response.data.hAssetSize,
                hSize: response.data.hSize,
                hTotalSize: response.data.hTotalSize,
                hExchangeSize: response.data.hExchangeSize,
                hTrafficUploadSize: response.data.hTrafficUploadSize,
                hTrafficDownloadSize: response.data.hTrafficDownloadSize,
                hTrafficAPIGet: response.data.hTrafficAPIGet,
                hTrafficAPIPut: response.data.hTrafficAPIPut,
            }, false);
        }).catch(() => {});
    }
};

const CLOUD_SPACE_DISPLAY_KEYS = [
    "syncSize",
    "backupSize",
    "hAssetSize",
    "hSize",
    "hTotalSize",
    "hExchangeSize",
    "hTrafficUploadSize",
    "hTrafficDownloadSize",
    "hTrafficAPIGet",
    "hTrafficAPIPut",
] as const;

type CloudSpaceDisplayData = Record<(typeof CLOUD_SPACE_DISPLAY_KEYS)[number], string>;

const buildCloudSpaceHtml = (data: CloudSpaceDisplayData, loading: boolean) =>
    `<div class="fn__flex config-cloud-space${loading ? " config-cloud-space--loading" : ""}">
    <div class="config-cloud-space__body">
        <div class="config-cloud-space__title">${window.siyuan.languages.cloudStorage}</div>
        <div class="config-cloud-space__placeholder">
        <div class="fn__hr"></div>
        <ul class="b3-list">
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.sync}<span class="b3-list-item__meta">${data.syncSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.backup}<span class="b3-list-item__meta">${data.backupSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;"><a href="${getCloudURL("settings/file?type=3")}" target="_blank">${window.siyuan.languages.cdn}</a><span class="b3-list-item__meta">${data.hAssetSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.total}<span class="b3-list-item__meta">${data.hSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.sizeLimit}<span class="b3-list-item__meta">${data.hTotalSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;"><a href="${getCloudURL("settings/point")}" target="_blank">${window.siyuan.languages.pointExchangeSize}</a><span class="b3-list-item__meta">${data.hExchangeSize}</span></li>
        </ul>
        </div>
    </div>
    <div class="config-cloud-space__body">
        <div class="config-cloud-space__title">${window.siyuan.languages.trafficStat}</div>
        <div class="config-cloud-space__placeholder">
        <div class="fn__hr"></div>
        <ul class="b3-list">
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.upload}<span class="fn__space"></span><span class="ft__on-surface">${data.hTrafficUploadSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">${window.siyuan.languages.download}<span class="fn__space"></span><span class="ft__on-surface">${data.hTrafficDownloadSize}</span></li>
            <li class="b3-list-item" style="cursor: auto;">API GET<span class="fn__space"></span><span class="ft__on-surface">${data.hTrafficAPIGet}</span></li>
            <li class="b3-list-item" style="cursor: auto;">API PUT<span class="fn__space"></span><span class="ft__on-surface">${data.hTrafficAPIPut}</span></li>
        </ul>
        </div>
    </div>
    ${loading ? '<div class="fn__loading"><img width="64px" src="/stage/loading-pure.svg"></div>' : ""}
</div>`;
