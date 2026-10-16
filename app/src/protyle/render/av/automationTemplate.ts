import type {AVAttributeViewData, AVAutomationRuleInput, AVAutomationValueInput, AVValue} from "../../../types/api";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchSyncPost} from "../../../util/fetch";
import {hasAVCapability} from "./capabilities";
import {getSelectedOptionsHTML} from "./fieldValueEditor";
import {getAVLocationDisplayText} from "./locationValue";

export const automationTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const automationDateInput = (time: number, timeZone: string, dateOnly = false) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(time);
    const part = (name: string) => parts.find(part => part.type === name)?.value || "";
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    return dateOnly ? date : `${date}T${part("hour")}:${part("minute")}`;
};

export const automationTemplateValueText = (value: AVValue, timeZone: string): string => {
    switch (value?.type) {
        case "block": return value.block?.content || "";
        case "text": return value.text?.content || "";
        case "url": return value.url?.content || "";
        case "email": return value.email?.content || "";
        case "phone": return value.phone?.content || "";
        case "number": return value.number?.isNotEmpty ? String(value.number.content) : "";
        case "checkbox": return String(!!value.checkbox?.checked);
        case "date":
            if (!value.date?.isNotEmpty) {
                return "";
            }
            return value.date.hasEndDate ? JSON.stringify(value.date) :
                automationDateInput(value.date.content, timeZone, value.date.isNotTime);
        case "select": return value.mSelect?.[0]?.content || "";
        case "mSelect": return JSON.stringify(value.mSelect?.map(item => item.content) || []);
        case "relation": return JSON.stringify(value.relation?.blockIDs || []);
        case "mAsset": return JSON.stringify(value.mAsset || []);
        case "location": return JSON.stringify(value.location || {});
        default: return "";
    }
};

export const mountAutomationTemplate = (options: {
    host: HTMLElement,
    field: IAVColumn,
    source: AVAttributeViewData,
    targetID: string,
    rule: Pick<AVAutomationRuleInput, "timeZone" | "trigger">,
    value: Pick<AVAutomationValueInput, "template">,
    save: () => void,
    onResize: () => void,
}) => {
    const {host, field, source, targetID, rule, value, save, onResize} = options;
    const lang = window.siyuan.languages;
    const timeZone = rule.timeZone || automationTimeZone();
    const fields = source.keyValues.filter(item => item?.key && hasAVCapability(item.key.type, "editable"));
    const rows = fields.find(item => item.key.type === "block")?.values || [];
    let version = 0;
    const example = field.type === "date" ? '.action{((now).AddDate 0 0 7).Format "2006-01-02"}' :
        field.type === "checkbox" ? "true" : field.type === "number" ? ".action{add 1 2}" :
            field.type === "mSelect" || field.type === "relation" || field.type === "mAsset" ? "[]" :
                field.type === "location" ? '{"name":"","latitude":0,"longitude":0}' : ".action{now | date \"2006-01-02\"}";
    host.classList.add("av__automation-template");
    host.innerHTML = `<textarea class="b3-text-field fn__block" data-template rows="3" maxlength="8192" aria-label="${escapeAttr(lang.template)}">${escapeHtml(value.template || "")}</textarea>
<div class="av__automation-row"><label class="av__automation-control fn__flex-1"><span>${lang.variables}</span><select class="b3-select" data-template-variable><option value="">${lang.automationInsertVariable}</option><option value="now">${lang.automationTriggerTime}</option>${fields.map(item => `<option value="${escapeAttr(item.key.id)}">${escapeHtml(item.key.name)}</option><option value="value:${escapeAttr(item.key.id)}">${escapeHtml(item.key.name)} (JSON)</option>`).join("")}</select></label><button type="button" class="b3-button b3-button--cancel" data-template-example>${lang.automationTemplateExample}</button></div>
<div class="ft__on-surface ft__smaller">${lang.automationTemplateTip}</div>
<div class="ft__on-surface ft__smaller">${lang.automationTimeZone} ${escapeHtml(timeZone)}</div>
<details data-template-preview><summary>${lang.automationPreviewData}</summary><div class="av__automation-template-data">
<div class="ft__on-surface ft__smaller">${lang.automationPreviewOnly}</div>
<label class="av__automation-control"><span>${lang.automationPreviewItem}</span><select class="b3-select" data-template-item><option value="">${lang.selectRelationItems}</option>${rows.map(row => `<option value="${escapeAttr(row.blockID)}">${escapeHtml(row.block?.content || row.blockID)}</option>`).join("")}</select></label>
<label class="av__automation-control"><span>${lang.automationPreviewTime}</span><input class="b3-text-field" type="datetime-local" data-template-time value="${automationDateInput(Date.now(), timeZone)}"></label>
<div class="av__automation-template-data" data-template-inputs></div>
<button type="button" class="b3-button b3-button--outline" data-template-run>${lang.automationTemplatePreview}</button>
<output class="av__automation-template-result" role="status" aria-live="polite" data-template-result></output></div></details>`;
    const editor = host.querySelector<HTMLTextAreaElement>("[data-template]");
    const item = host.querySelector<HTMLSelectElement>("[data-template-item]");
    const triggerTime = host.querySelector<HTMLInputElement>("[data-template-time]");
    const inputs = host.querySelector<HTMLElement>("[data-template-inputs]");
    const result = host.querySelector<HTMLOutputElement>("[data-template-result]");
    const invalidate = () => {
        version++;
        result.textContent = "";
    };
    const renderInputs = () => {
        const references = new Set(Array.from(editor.value.matchAll(/\b(?:field|value)\s+"([^"]+)"/g), match => match[1]));
        inputs.innerHTML = fields.filter(entry => references.has(entry.key.id)).map(entry => {
            const stored = entry.values?.find(value => value.blockID === item.value);
            const text = automationTemplateValueText(stored, timeZone);
            const date = entry.key.type === "date" && !stored?.date?.hasEndDate;
            const type = date ? (stored?.date?.isNotTime === false ? "datetime-local" : "date") : entry.key.type === "number" ? "number" : "text";
            return `<label class="av__automation-control"><span>${escapeHtml(entry.key.name)}</span><input class="b3-text-field" data-template-input="${escapeAttr(entry.key.id)}" type="${type}"${type === "number" ? ' step="any"' : ""} value="${escapeAttr(text)}" maxlength="65536"></label>`;
        }).join("");
        invalidate();
        onResize();
    };
    item.addEventListener("change", renderInputs);
    editor.addEventListener("input", () => {
        value.template = editor.value;
        renderInputs();
    });
    editor.addEventListener("change", () => {
        value.template = editor.value;
        save();
    });
    host.querySelector<HTMLSelectElement>("[data-template-variable]").addEventListener("change", event => {
        const select = event.target as HTMLSelectElement;
        if (!select.value) {
            return;
        }
        const variable = select.value;
        const text = variable === "now" ? ".action{now}" : variable.startsWith("value:") ?
            `.action{toJson (value ${JSON.stringify(variable.substring(6))})}` : `.action{field ${JSON.stringify(variable)}}`;
        editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, "end");
        value.template = editor.value;
        select.value = "";
        save();
        renderInputs();
        editor.focus();
    });
    host.querySelector("[data-template-example]").addEventListener("click", () => {
        editor.value = example;
        value.template = example;
        save();
        renderInputs();
    });
    host.addEventListener("input", event => {
        const input = event.target as HTMLInputElement;
        if (input.matches("[data-template-input]")) {
            input.dataset.modified = "true";
        }
        invalidate();
    });
    host.querySelector("[data-template-preview]").addEventListener("toggle", onResize);
    host.querySelector<HTMLButtonElement>("[data-template-run]").addEventListener("click", async event => {
        const button = event.currentTarget as HTMLButtonElement;
        if (!item.value || !triggerTime.checkValidity() || !triggerTime.value) {
            result.textContent = lang.automationPreviewItem;
            return;
        }
        const requestVersion = ++version;
        const overrides: Record<string, string> = {};
        const invalid = inputs.querySelector<HTMLInputElement>("input:invalid");
        if (invalid) {
            invalid.reportValidity();
            return;
        }
        inputs.querySelectorAll<HTMLInputElement>('[data-template-input][data-modified="true"]').forEach(input => {
            overrides[input.dataset.templateInput] = input.value;
        });
        button.disabled = true;
        try {
            const response = await fetchSyncPost("/api/av/previewAttributeViewTemplate", {
                avID: source.id, targetAvID: targetID, itemID: item.value, keyID: field.id,
                template: editor.value, timeZone, triggerTime: triggerTime.value, inputs: overrides,
            });
            if (!host.isConnected || version !== requestVersion) {
                return;
            }
            result.classList.toggle("ft__error", response.code !== 0);
            if (response.code !== 0 || !response.data || !("type" in response.data)) {
                result.textContent = response.msg;
                return;
            }
            const output = response.data;
            if (field.type === "select" || field.type === "mSelect") {
                result.innerHTML = getSelectedOptionsHTML(field, output.mSelect?.map(option => option.content) || []) || escapeHtml(lang.empty);
                return;
            }
            result.textContent = field.type === "relation" ?
                output.relation?.contents?.map(value => value.block?.content).join(", ") || lang.empty :
                field.type === "location" ? getAVLocationDisplayText(output.location) || lang.empty :
                    field.type === "mAsset" ? output.mAsset?.map(asset => asset.name || asset.content).join(", ") || lang.empty :
                        field.type === "date" && output.date?.hasEndDate ?
                            `${automationDateInput(output.date.content, timeZone, output.date.isNotTime)} - ${automationDateInput(output.date.content2, timeZone, output.date.isNotTime)}` :
                            automationTemplateValueText(output, timeZone) || lang.empty;
        } catch (error) {
            if (host.isConnected && version === requestVersion) {
                result.classList.add("ft__error");
                result.textContent = String(error);
            }
        } finally {
            button.disabled = false;
            onResize();
        }
    });
    renderInputs();
};
