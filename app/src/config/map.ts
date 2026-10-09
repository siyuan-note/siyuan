import type {MapConfig, MapService} from "../types/api";
import type {SettingTabBuilder} from "./setting/builder";
import {fetchSyncPost} from "../util/fetch";
import {escapeAttr, escapeHtml} from "../util/escape";
import {genUUID} from "../util/genID";
import {showMessage} from "../dialog/message";
import {confirmDialog} from "../dialog/confirmDialog";
import {genConfigItemMainHtml} from "./render/fragments";
import {trackSettingSave} from "./setting/pending";
import {MAP_CONFIG_CHANGED_EVENT, notifyMapConfigChanged} from "./mapRuntime";

type MapServiceWrite = Pick<MapService, "id" | "name" | "provider"> & {apiKey?: string; securityCode?: string};
const mounts = new WeakMap<HTMLElement, () => void>();
const configureServiceEvent = "siyuan-configure-map-service";
const providers = ["amap", "tencent", "baidu", "openfreemap"] as const;

const providerName = (provider: string) => {
    const names: Record<string, string> = {
        amap: window.siyuan.languages.mapProviderAMap,
        tencent: window.siyuan.languages.mapProviderTencent,
        baidu: window.siyuan.languages.mapProviderBaidu,
        openfreemap: "OpenFreeMap",
    };
    return names[provider] || provider;
};

export const requestMapServiceConfiguration = (root: HTMLElement, missingServiceID: string) => {
    if (!root || !missingServiceID) return;
    root.dataset.mapServiceID = missingServiceID;
    root.dispatchEvent(new CustomEvent(configureServiceEvent));
};

export const unmountMapTab = (root: HTMLElement) => {
    mounts.get(root)?.();
    mounts.delete(root);
    delete root.dataset.mapServiceID;
};

export const mountMapTab = (root: HTMLElement) => {
    mounts.get(root)?.();
    mounts.set(root, mountMapSettings(root));
};

export const registerMapTab = (tab: SettingTabBuilder) => {
    const lang = window.siyuan.languages;
    const field = (id: string, title: string, control: string, description?: string) =>
        `<div class="b3-label b3-label--inner config-item">${genConfigItemMainHtml(`<label for="${id}">${title}</label>`, description)}
<div class="fn__hr--small"></div>${control}</div>`;
    const input = (id: string, password = false) =>
        `<input id="${id}" class="b3-text-field fn__block" type="${password ? "password" : "text"}" autocomplete="off" spellcheck="false"${password ? "" : ' maxlength="128"'} disabled>`;
    tab.group("services", lang.mapServices).slot({
        key: "mapServices",
        keywords: [lang.mapSettings, lang.mapServices, lang.mapServiceName,
            lang.mapProvider, lang.mapSecurityCode, lang.apiKey, lang.mapCredentialsTip, lang.mapRenderingTip,
            lang.mapProductionTip, ...providers.map(providerName)],
        html: () => `<div id="mapSettings" class="b3-label config-item">
${genConfigItemMainHtml(lang.mapServices, lang.mapServicesTip)}
<div class="fn__hr"></div><div class="fn__flex">
<select id="mapServiceSelect" aria-label="${escapeAttr(lang.mapServices)}" class="b3-select fn__flex-1" disabled></select>
<span class="fn__space"></span><button id="mapServiceAdd" class="b3-button b3-button--outline" disabled>${lang.mapAddService}</button>
</div><div class="fn__hr--small"></div><div id="mapServiceStatus" class="b3-label__text" role="status"></div>
<div id="mapServiceEditor" class="fn__none">
${field("mapServiceName", lang.mapServiceName, input("mapServiceName"))}
${field("mapServiceProvider", lang.mapProvider, `<select id="mapServiceProvider" class="b3-select fn__block" disabled>${providers.map(provider => `<option value="${provider}">${escapeHtml(providerName(provider))}</option>`).join("")}</select>`)}
<div id="mapAPIKeyRow">${field("mapAPIKey", lang.apiKey, `${input("mapAPIKey", true)}<div class="fn__hr--small"></div><label class="fn__flex"><span class="fn__flex-1">${lang.mapClearCredential}</span><input id="mapClearAPIKey" type="checkbox" class="b3-switch" disabled></label>`, lang.mapCredentialsTip)}</div>
<div id="mapSecurityCodeRow">${field("mapSecurityCode", lang.mapSecurityCode, `${input("mapSecurityCode", true)}<div class="fn__hr--small"></div><label class="fn__flex"><span class="fn__flex-1">${lang.mapClearCredential}</span><input id="mapClearSecurityCode" type="checkbox" class="b3-switch" disabled></label>`, lang.mapCredentialsTip)}</div>
<div class="fn__hr"></div><div class="fn__flex">
<span class="fn__flex-1"></span>
<button id="mapServiceDelete" class="b3-button b3-button--remove" disabled>${lang.delete}</button><span class="fn__space"></span>
<button id="mapServiceCancel" class="b3-button b3-button--cancel" disabled>${lang.cancel}</button><span class="fn__space"></span>
<button id="mapServiceSave" class="b3-button b3-button--text" disabled>${lang.save}</button>
</div></div><div class="fn__hr"></div>
<div class="b3-label__text">${lang.mapRenderingTip}</div><div class="fn__hr--small"></div>
<div class="b3-label__text">${lang.mapProductionTip}</div><div class="fn__hr--small"></div>
<button id="mapServiceRetry" class="b3-button b3-button--outline fn__none">${lang.retry}</button>
</div>`,
    });
};

export const mountMapSettings = (root: HTMLElement): (() => void) => {
    const controller = new AbortController();
    const lang = window.siyuan.languages;
    const get = <T extends HTMLElement = HTMLInputElement>(id: string) => root.querySelector<T>(`#${id}`);
    let closed = false;
    let data: MapConfig;
    let selectedID = "";
    let draftID = "";
    let creating = false;
    let dirty = false;
    let busy = false;
    let loading = false;
    let revision = 0;
    let refreshPending = false;
    let providerChanged = false;
    const clearCredentials = () => {
        ["mapAPIKey", "mapSecurityCode"].forEach(id => {
            const input = get<HTMLInputElement>(id);
            if (input) input.value = "";
        });
        ["mapClearAPIKey", "mapClearSecurityCode"].forEach(id => {
            const input = get<HTMLInputElement>(id);
            if (input) input.checked = false;
        });
    };
    const current = () => data?.services.find(service => service.id === selectedID);
    const updateControls = () => {
        const provider = providers.find(item => item === get<HTMLSelectElement>("mapServiceProvider").value);
        const locked = busy || loading || !data || window.siyuan.config.readonly;
        root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")
            .forEach(element => { element.disabled = locked; });
        get<HTMLSelectElement>("mapServiceSelect").disabled = busy || loading || !data || dirty;
        get<HTMLButtonElement>("mapServiceAdd").disabled = locked || dirty;
        get<HTMLButtonElement>("mapServiceSave").disabled = locked || !dirty;
        get<HTMLButtonElement>("mapServiceCancel").disabled = busy || loading || !dirty;
        get<HTMLButtonElement>("mapServiceDelete").disabled = locked || dirty || creating || !current();
        get<HTMLButtonElement>("mapServiceRetry").disabled = busy || loading;
        get("mapServiceEditor").classList.toggle("fn__none", !creating && !current());
        get("mapAPIKeyRow").classList.toggle("fn__none", provider === "openfreemap");
        get("mapSecurityCodeRow").classList.toggle("fn__none", provider !== "amap");
        get<HTMLInputElement>("mapAPIKey").disabled = locked || provider === "openfreemap" || get<HTMLInputElement>("mapClearAPIKey").checked;
        get<HTMLInputElement>("mapSecurityCode").disabled = locked || provider !== "amap" || get<HTMLInputElement>("mapClearSecurityCode").checked;
    };
    const renderDraft = (service?: MapService, missingID?: string) => {
        revision++;
        selectedID = service?.id || "";
        draftID = service?.id || missingID || "";
        creating = !service && missingID !== undefined;
        dirty = creating;
        providerChanged = false;
        clearCredentials();
        get<HTMLInputElement>("mapServiceName").value = service?.name || "";
        get<HTMLSelectElement>("mapServiceProvider").value = service?.provider || "openfreemap";
        get<HTMLInputElement>("mapServiceName").setCustomValidity("");
        get<HTMLInputElement>("mapAPIKey").placeholder = service?.hasAPIKey ? lang.mapCredentialSaved : "";
        get<HTMLInputElement>("mapSecurityCode").placeholder = service?.hasSecurityCode ? lang.mapCredentialSaved : "";
        const select = get<HTMLSelectElement>("mapServiceSelect");
        select.innerHTML = `<option value="">${escapeHtml(creating ? lang.mapAddService : lang.mapNoServices)}</option>` +
            data.services.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)} (${escapeHtml(providerName(item.provider))})</option>`).join("");
        select.value = selectedID;
        get("mapServiceStatus").textContent = creating && root.dataset.mapServiceID ? lang.mapMissingServiceTip :
            service ? service.configured ? lang.mapCredentialsPresent : lang.mapCredentialsMissing : lang.mapNoServices;
        updateControls();
    };
    const openRequestedService = () => {
        const requestedID = root.dataset.mapServiceID;
        if (!requestedID || !data || busy || loading || dirty) return false;
        const service = data.services.find(item => item.id === requestedID);
        renderDraft(service, requestedID);
        delete root.dataset.mapServiceID;
        get<HTMLInputElement>("mapServiceName").focus();
        return true;
    };
    const reportFailure = () => {
        if (!closed) {
            get("mapServiceStatus").textContent = lang.mapSettingsError;
            get("mapServiceRetry").classList.remove("fn__none");
        }
    };
    const load = async () => {
        if (closed) return;
        if (busy || loading || dirty) {
            refreshPending = true;
            return;
        }
        refreshPending = false;
        loading = true;
        const readRevision = revision;
        updateControls();
        try {
            const response = await fetchSyncPost("/api/map/getConf", {}, undefined, true, controller.signal);
            if (closed || readRevision !== revision) return;
            if (response.code !== 0) { reportFailure(); return; }
            data = response.data;
            window.siyuan.config.map = data;
            get("mapServiceRetry").classList.add("fn__none");
            loading = false;
            if (!openRequestedService()) renderDraft(current() || data.services[0]);
        } catch (error) {
            if (!controller.signal.aborted) reportFailure();
        } finally {
            loading = false;
            if (!closed) {
                updateControls();
                if (refreshPending && !dirty) void load();
            }
        }
    };
    const writeService = (service: MapService): MapServiceWrite => ({id: service.id, name: service.name, provider: service.provider});
    const persist = async (services: MapServiceWrite[], nextID: string) => {
        if (closed || busy || loading || !data || window.siyuan.config.readonly) return;
        const expectedRevision = data.revision || "";
        busy = true;
        revision++;
        updateControls();
        try {
            // 替换列表前检查外部改动，冲突时保留草稿，由用户取消后重新编辑。
            const latest = await fetchSyncPost("/api/map/getConf", {}, undefined, true, controller.signal);
            if (closed) return;
            if (latest.code !== 0) { reportFailure(); return; }
            if ((latest.data.revision || "") !== expectedRevision ||
                JSON.stringify(latest.data.services) !== JSON.stringify(data.services)) {
                refreshPending = true;
                get("mapServiceStatus").textContent = lang.mapSettingsConflict;
                dirty = true;
                return;
            }
            // 提交后关闭界面只销毁界面状态，不把已发送的写入伪装成取消。
            const response = await trackSettingSave(fetchSyncPost("/api/map/setConf", {services, expectedRevision}, undefined, true));
            if (closed) return;
            if (response.code !== 0 && response.msg === "mapSettingsConflict") {
                refreshPending = true;
                dirty = true;
                get("mapServiceStatus").textContent = lang.mapSettingsConflict;
                return;
            }
            if (response.code !== 0) { reportFailure(); return; }
            data = response.data;
            window.siyuan.config.map = data;
            dirty = false;
            renderDraft(data.services.find(service => service.id === nextID) || data.services[0]);
            get("mapServiceRetry").classList.add("fn__none");
            notifyMapConfigChanged();
        } catch (error) {
            if (!controller.signal.aborted) reportFailure();
        } finally {
            busy = false;
            if (!closed) {
                updateControls();
                if (!dirty) {
                    openRequestedService();
                    if (refreshPending) void load();
                }
            }
        }
    };
    const save = async () => {
        const name = get<HTMLInputElement>("mapServiceName");
        const provider = providers.find(item => item === get<HTMLSelectElement>("mapServiceProvider").value);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(draftID) ||
            creating && data.services.some(service => service.id === draftID)) {
            get("mapServiceStatus").textContent = lang.mapServiceIDInvalid;
            return;
        }
        name.setCustomValidity(name.value.trim() ? "" : lang.mapServiceNameRequired);
        if (!name.reportValidity() || !provider) return;
        const service: MapServiceWrite = {id: draftID, name: name.value.trim(), provider};
        if (provider !== "openfreemap") {
            const apiKey = get<HTMLInputElement>("mapAPIKey").value;
            if (get<HTMLInputElement>("mapClearAPIKey").checked) service.apiKey = "";
            else if (apiKey || providerChanged) service.apiKey = apiKey;
        }
        if (provider === "amap") {
            const securityCode = get<HTMLInputElement>("mapSecurityCode").value;
            if (get<HTMLInputElement>("mapClearSecurityCode").checked) service.securityCode = "";
            else if (securityCode || providerChanged) service.securityCode = securityCode;
        }
        const services = data.services.map(item => item.id === selectedID ? service : writeService(item));
        if (creating) services.push(service);
        await persist(services, service.id);
    };
    root.addEventListener("input", event => {
        if (closed || busy || loading || !data || window.siyuan.config.readonly) return;
        const target = event.target as HTMLInputElement;
        if (!["mapServiceName", "mapAPIKey", "mapSecurityCode"].includes(target.id)) return;
        target.setCustomValidity("");
        dirty = true;
        updateControls();
    }, {signal: controller.signal});
    root.addEventListener("change", event => {
        event.stopPropagation();
        if (closed || busy || loading || !data) return;
        const target = event.target as HTMLInputElement;
        if (target.id === "mapServiceSelect" && !dirty) {
            renderDraft(data.services.find(service => service.id === target.value));
        } else if (!window.siyuan.config.readonly) {
            if (target.id === "mapServiceProvider") {
                clearCredentials();
                providerChanged = true;
                get<HTMLInputElement>("mapAPIKey").placeholder = "";
                get<HTMLInputElement>("mapSecurityCode").placeholder = "";
            } else if (target.id === "mapClearAPIKey" && target.checked) get<HTMLInputElement>("mapAPIKey").value = "";
            else if (target.id === "mapClearSecurityCode" && target.checked) get<HTMLInputElement>("mapSecurityCode").value = "";
            dirty = true;
            updateControls();
        }
    }, {signal: controller.signal});
    root.addEventListener("click", async event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
        if (!button || button.disabled || closed || busy || loading) return;
        event.stopPropagation();
        if (button.id === "mapServiceRetry") {
            if (!dirty) await load();
            else get("mapServiceStatus").textContent = lang.mapSaveOrCancel;
        } else if (button.id === "mapServiceCancel") {
            dirty = false;
            clearCredentials();
            if (refreshPending) {
                renderDraft(current() || data.services[0]);
                await load();
            } else if (!openRequestedService()) renderDraft(current() || data.services[0]);
        } else if (!data || window.siyuan.config.readonly) return;
        else if (button.id === "mapServiceAdd" && !dirty) renderDraft(undefined, genUUID());
        else if (button.id === "mapServiceSave" && dirty) await trackSettingSave(save());
        else if (button.id === "mapServiceDelete" && current() && !dirty) {
            const deleteID = selectedID;
            const deleteRevision = revision;
            confirmDialog(lang.delete, lang.mapDeleteServiceTip, () => {
                if (closed || dirty || busy || revision !== deleteRevision) return;
                void trackSettingSave(persist(data.services.filter(service => service.id !== deleteID).map(writeService), ""));
            }, undefined, true);
        }
    }, {signal: controller.signal});
    root.addEventListener(configureServiceEvent, () => {
        if (!openRequestedService() && dirty) showMessage(lang.mapSaveOrCancel);
    }, {signal: controller.signal});
    window.addEventListener(MAP_CONFIG_CHANGED_EVENT, () => { void load(); }, {signal: controller.signal});
    get("mapServiceStatus").textContent = lang.loading;
    void load();
    return () => {
        closed = true;
        revision++;
        controller.abort();
        clearCredentials();
    };
};
