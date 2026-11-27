import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";
import {createFlashcardV2DisclosureTitle} from "./flashcardV2Form";
import type {FlashcardV2CardRenderModel} from "../types/api";

// 仅展示已有声明，不把可写的模式类型或插件命名空间当作作者认证。
export const describeFlashcardTemplate = (model: FlashcardV2CardRenderModel, cardID: string) => {
    if (!model?.card || !model.template || !model.source || !model.schema || model.card.id !== cardID ||
        model.card.templateID !== model.template.id || model.card.sourceID !== model.source.id ||
        model.template.schemaID !== model.schema.id || model.source.schemaID !== model.schema.id) { return; }
    const namespace = model.source.pluginNamespace;
    const prefix = namespace ? `plugin:${namespace}:` : "";
    const consistentPlugin = prefix && model.source.sourceType.startsWith(prefix) && model.source.sourceType.length > prefix.length;
    return {
        name: model.template.name,
        schemaName: model.schema.name,
        answerMode: model.template.answerMode,
        enabled: model.template.enabled,
        sourceDisabled: model.source.disabledTemplateIDs?.includes(model.template.id) || false,
        declarations: JSON.stringify({builtinType: model.schema.builtinType || null, sourceType: model.source.sourceType,
            pluginNamespace: consistentPlugin ? namespace : null}, null, 2),
        configuration: JSON.stringify(model.template, null, 2),
    };
};

export const openFlashcardV2Template = (cardID: string) => {
    const language = window.siyuan.languages;
    let closed = false;
    let generation = 0;
    let busy = false;
    const abort = new AbortController();
    const dialog = new Dialog({
        title: language.flashcardInspectTemplate,
        width: isMobile() ? "92vw" : "640px",
        height: "70vh",
        content: "<div class=\"b3-dialog__content\"><p data-role=\"tip\" class=\"ft__on-surface\"></p><p role=\"status\" data-role=\"status\" aria-live=\"polite\"></p><div data-role=\"details\" class=\"card__v2-template-details\"></div></div><div class=\"b3-dialog__action\"><button type=\"button\" data-action=\"refresh\" class=\"b3-button b3-button--outline\"></button><div class=\"fn__space\"></div><button type=\"button\" data-action=\"close\" class=\"b3-button b3-button--text\"></button></div>",
        destroyCallback: () => { closed = true; generation++; abort.abort(); },
    });
    const root = dialog.element;
    root.querySelector('[data-role="tip"]').textContent = language.flashcardTemplateReadOnlyTip;
    const status = root.querySelector<HTMLElement>('[data-role="status"]');
    const details = root.querySelector<HTMLElement>('[data-role="details"]');
    const refresh = root.querySelector<HTMLButtonElement>('[data-action="refresh"]');
    const close = root.querySelector<HTMLButtonElement>('[data-action="close"]');
    refresh.textContent = language.refresh; close.textContent = language.close;
    close.addEventListener("click", () => dialog.destroy());
    const field = (label: string, value: string | boolean) => {
        const item = document.createElement("div"); item.className = "b3-label";
        const title = document.createElement("div"); title.className = "b3-label__text"; title.textContent = label; item.append(title);
        if (typeof value === "boolean") {
            const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.disabled = true;
            checkbox.checked = value; checkbox.setAttribute("aria-label", label); item.append(checkbox);
        } else {
            const text = document.createElement("div"); text.className = "ft__breakword"; text.textContent = value; item.append(text);
        }
        details.append(item);
    };
    const code = (label: string, value: string) => {
        const section = document.createElement("details");
        section.className = "card__v2-disclosure";
        const title = createFlashcardV2DisclosureTitle(label);
        const text = document.createElement("pre"); text.textContent = value;
        section.append(title, text); details.append(section);
    };
    const load = async () => {
        if (closed || busy) { return; }
        const token = ++generation; busy = true; refresh.disabled = true;
        root.setAttribute("aria-busy", "true"); status.textContent = language.loading;
        details.replaceChildren();
        const current = () => !closed && token === generation && root.isConnected;
        let received = false;
        try {
            await fetchPost("/api/flashcard/getRenderModel", {cardID}, response => {
                if (!current()) { return; }
                const model = describeFlashcardTemplate(response.data, cardID);
                if (!model) { return; }
                received = true;
                field(language.name, model.name); field(language.type, model.schemaName);
                field(language.flashcardTemplateAnswerMode, model.answerMode);
                field(language.enable, model.enabled); field(language.flashcardTemplateSourceDisabled, model.sourceDisabled);
                code(language.flashcardTemplateDeclarations, model.declarations);
                code(language.config, model.configuration);
                status.textContent = "";
            }, undefined, () => {}, abort.signal, 30000);
        } finally {
            busy = false;
            if (current()) {
                root.removeAttribute("aria-busy"); refresh.disabled = false;
                if (!received) { status.textContent = language.flashcardLoadFailed; }
            }
        }
    };
    refresh.addEventListener("click", () => { void load(); });
    void load();
};
