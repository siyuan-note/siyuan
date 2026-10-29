import type {SettingTabBuilder} from "../../setting/builder";
import {escapeHtmlTextAndAttr as escapeHtml} from "../../../util/escape";
import {fetchSyncPost} from "../../../util/fetch";
import {showMessage} from "../../../dialog/message";
import {aiConfigApi} from "./aiRuntime";
import {openMemoryManager} from "../../../ai/memos/manager";
import {memoryModelOptions} from "../../../ai/memos/state";
import {getReasoningEffortOptions} from "../../../ai/reasoningEffort";

const mountMemorySelection = (root: HTMLElement) => {
    const model = root.querySelector<HTMLSelectElement>("[data-memory-model]");
    const effort = root.querySelector<HTMLSelectElement>("[data-memory-effort]");
    const lang = window.siyuan.languages;
    let generation = 0;
    const updateEfforts = async () => {
        const current = ++generation;
        effort.disabled = true;
        const result = await fetchSyncPost("/api/ai/memory/capabilities", {});
        if (current !== generation || !root.isConnected) {
            return;
        }
        const selected = window.siyuan.config.ai.memory?.reasoningEffort || "";
        const supported = result.code === 0 ? result.data.efforts || [] : [];
        const options = getReasoningEffortOptions(lang).filter(option => !option.value || supported.includes(option.value));
        effort.innerHTML = options.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join("");
        if (selected && !options.some(option => option.value === selected)) {
            const unavailable = document.createElement("option");
            unavailable.value = selected;
            unavailable.textContent = `${selected} (${lang.disable})`;
            unavailable.disabled = true;
            effort.add(unavailable);
        }
        effort.value = selected;
        effort.disabled = result.code !== 0 || supported.length === 0;
        if (result.code !== 0 && model.value) {
            showMessage(result.msg);
        }
    };
    const renderModels = () => {
        const current = window.siyuan.config.ai.memory?.modelId || "";
        model.innerHTML = `<option value="">${escapeHtml(lang.aiSelectModel)}</option>` +
            memoryModelOptions(window.siyuan.config.ai.providers || [], current).map(option =>
                `<option value="${escapeHtml(option.id)}" ${option.unavailable ? "disabled" : ""}>${escapeHtml(option.label)}</option>`).join("");
        model.value = current;
    };
    renderModels();
    model.addEventListener("focus", renderModels);
    model.addEventListener("change", () => {
        model.disabled = true;
        effort.disabled = true;
        generation++;
        void aiConfigApi.patch("memory", {modelId: model.value, reasoningEffort: ""}).finally(() => {
            model.disabled = false;
            renderModels();
            void updateEfforts().catch(error => showMessage(String(error)));
        }).catch(error => showMessage(String(error)));
    });
    effort.addEventListener("change", () => {
        if (!model.disabled && !effort.disabled) {
            void aiConfigApi.patch("memory.reasoningEffort", effort.value).catch(error => showMessage(String(error)));
        }
    });
    void updateEfforts().catch(error => showMessage(String(error)));
};

export const registerAiMemoryGroup = (tab: SettingTabBuilder) => {
    const lang = window.siyuan.languages;
    const group = tab.group("memory", lang.aiMemory);
    group.switch("ai.memory.enabled", {title: lang.aiMemory, desc: lang.aiMemoryEnabledTip});
    group.slot({
        key: "memorySelection",
        keywords: [lang.aiMemory, lang.apiModel, lang.reasoningEffortTooltip],
        html: () => `<div class="b3-label"><label class="fn__flex">${lang.apiModel}<span class="fn__flex-1"></span><select class="b3-select" data-memory-model></select></label>
<div class="fn__hr"></div><label class="fn__flex">${lang.reasoningEffortTooltip}<span class="fn__flex-1"></span><select class="b3-select" data-memory-effort disabled></select></label></div>`,
        afterMount: mountMemorySelection,
    });
    group.button({id: "manageMemory", title: lang.aiMemory, label: lang.manage, icon: "iconSettings",
        afterMount: root => root.querySelector("#manageMemory")?.addEventListener("click", openMemoryManager)});
};
