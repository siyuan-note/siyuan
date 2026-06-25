import {bindPasswordIconaToggle} from "../render/fragments";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {Constants} from "../../constants";
import {isMobile} from "../../util/functions";
import {secretsConfigApi, variablesConfigApi} from "./secretsVariablesRuntime";

interface NamedItem {
    name: string;
    value: string;
}

// region 密钥区块（Secrets）

export const getSecretsBlockKeywords = (): string[] => [
    window.siyuan.languages.secrets,
    window.siyuan.languages.secretsTip,
    window.siyuan.languages.addSecret,
    window.siyuan.languages.secretName,
    window.siyuan.languages.secretValue,
    window.siyuan.languages.noSecretConfigured,
];

export const genSecretsBlockHtml = (): string => `<div class="b3-label config-item" id="secretsBlock">
    <div class="b3-label__text">${window.siyuan.languages.secretsTip}</div>
    <div class="fn__hr--small"></div>
    <div id="secretList"></div>
    <div class="fn__hr"></div>
    <div class="config-wrap">
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-type="addSecret">
            <svg><use xlink:href="#iconAdd"></use></svg>
            ${window.siyuan.languages.addSecret}
        </button>
    </div>
</div>`;

export const mountSecretsBlock = (root: HTMLElement) => {
    const block = root.querySelector("#secretsBlock");
    if (!block) {
        return;
    }
    renderSecretList(root);

    block.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const actionEl = target.closest<HTMLElement>("[data-type]");
        const type = actionEl?.dataset.type;
        if (type === "addSecret") {
            openItemDialog({
                root,
                existingName: null,
                kind: "secret",
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "editSecret") {
            openItemDialog({
                root,
                existingName: getSecretName(actionEl),
                kind: "secret",
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "deleteSecret") {
            event.preventDefault();
            event.stopPropagation();
            const name = getSecretName(actionEl);
            if (!name) {
                return;
            }
            showDeleteConfirm(name, () => {
                saveSecrets(root, window.siyuan.config.secrets.items.filter((item) => item.name !== name));
            });
        }
    });
};

const renderSecretList = (root: HTMLElement) => {
    const listEl = root.querySelector("#secretList");
    if (!listEl) {
        return;
    }
    renderNamedItemList({
        listEl,
        items: window.siyuan.config.secrets.items,
        addType: "addSecret",
        editType: "editSecret",
        deleteType: "deleteSecret",
        dataAttr: "data-secret-name",
        emptyTextKey: window.siyuan.languages.noSecretConfigured,
    });
};

const saveSecrets = (root: HTMLElement, items: Config.ISecret[]) => {
    secretsConfigApi.patch("items", items, () => renderSecretList(root));
};

const getSecretName = (el: HTMLElement): string | undefined =>
    el.closest<HTMLElement>("[data-secret-name]")?.dataset.secretName;

// endregion

// region 变量区块（Variables）

export const getVariablesBlockKeywords = (): string[] => [
    window.siyuan.languages.variables,
    window.siyuan.languages.variablesTip,
    window.siyuan.languages.addVariable,
    window.siyuan.languages.variableName,
    window.siyuan.languages.variableValue,
    window.siyuan.languages.noVariableConfigured,
];

export const genVariablesBlockHtml = (): string => `<div class="b3-label config-item" id="variablesBlock">
    <div class="b3-label__text">${window.siyuan.languages.variablesTip}</div>
    <div class="fn__hr--small"></div>
    <div id="variableList"></div>
    <div class="fn__hr"></div>
    <div class="config-wrap">
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-type="addVariable">
            <svg><use xlink:href="#iconAdd"></use></svg>
            ${window.siyuan.languages.addVariable}
        </button>
    </div>
</div>`;

export const mountVariablesBlock = (root: HTMLElement) => {
    const block = root.querySelector("#variablesBlock");
    if (!block) {
        return;
    }
    renderVariableList(root);

    block.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const actionEl = target.closest<HTMLElement>("[data-type]");
        const type = actionEl?.dataset.type;
        if (type === "addVariable") {
            openItemDialog({
                root,
                existingName: null,
                kind: "variable",
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "editVariable") {
            openItemDialog({
                root,
                existingName: getVariableName(actionEl),
                kind: "variable",
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (type === "deleteVariable") {
            event.preventDefault();
            event.stopPropagation();
            const name = getVariableName(actionEl);
            if (!name) {
                return;
            }
            showDeleteConfirm(name, () => {
                saveVariables(root, window.siyuan.config.variables.items.filter((item) => item.name !== name));
            });
        }
    });
};

const renderVariableList = (root: HTMLElement) => {
    const listEl = root.querySelector("#variableList");
    if (!listEl) {
        return;
    }
    renderNamedItemList({
        listEl,
        items: window.siyuan.config.variables.items,
        addType: "addVariable",
        editType: "editVariable",
        deleteType: "deleteVariable",
        dataAttr: "data-variable-name",
        emptyTextKey: window.siyuan.languages.noVariableConfigured,
    });
};

const saveVariables = (root: HTMLElement, items: Config.IVariable[]) => {
    variablesConfigApi.patch("items", items, () => renderVariableList(root));
};

const getVariableName = (el: HTMLElement): string | undefined =>
    el.closest<HTMLElement>("[data-variable-name]")?.dataset.variableName;

// endregion

// region 共享渲染与弹窗

interface RenderNamedItemListOptions {
    listEl: Element;
    items: NamedItem[];
    addType: string;
    editType: string;
    deleteType: string;
    dataAttr: string;
    emptyTextKey: string;
}

const renderNamedItemList = (options: RenderNamedItemListOptions) => {
    const {listEl, items, editType, deleteType, dataAttr, emptyTextKey} = options;
    const hideActionClass = isMobile() ? "" : " b3-list-item--hide-action";
    if (items.length === 0) {
        listEl.innerHTML = `<div class="b3-label__text">${emptyTextKey}</div>`;
        return;
    }
    const html = items.map((item) => {
        return `<div class="b3-list-item b3-list-item--narrow${hideActionClass}" ${dataAttr}="${Lute.EscapeHTMLStr(item.name)}">
    <span class="b3-list-item__text">${Lute.EscapeHTMLStr(item.name)}</span>
    <span data-type="${deleteType}" class="b3-list-item__action b3-list-item__action--warning b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.delete}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
    <span data-type="${editType}" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.edit}">
        <svg><use xlink:href="#iconSettings"></use></svg>
    </span>
</div>`;
    }).join("");
    listEl.innerHTML = `<div class="b3-list b3-list--border b3-list--background">${html}</div>`;
};

interface OpenItemDialogOptions {
    root: HTMLElement;
    existingName: string | null;
    kind: "secret" | "variable";
}

const openItemDialog = (options: OpenItemDialogOptions) => {
    const {root, existingName, kind} = options;
    const isNew = !existingName;
    const isSecret = kind === "secret";
    const configItems: NamedItem[] = isSecret
        ? window.siyuan.config.secrets.items
        : window.siyuan.config.variables.items;
    const existing = existingName ? configItems.find((item) => item.name === existingName) : undefined;
    if (!isNew && !existing) {
        return;
    }
    const initial: NamedItem = isNew ? {name: "", value: ""} : existing;

    const titleKey = isNew
        ? (isSecret ? window.siyuan.languages.addSecret : window.siyuan.languages.addVariable)
        : (isSecret ? window.siyuan.languages.secrets : window.siyuan.languages.variables);
    const valueKey = isSecret ? window.siyuan.languages.secretValue : window.siyuan.languages.variableValue;
    const nameRequiredKey = isSecret
        ? window.siyuan.languages.secretNameRequired
        : window.siyuan.languages.variableNameRequired;
    const nameDuplicateKey = isSecret
        ? window.siyuan.languages.secretNameDuplicate
        : window.siyuan.languages.variableNameDuplicate;

    const valueInputHtml = isSecret
        ? `<div class="b3-form__icona fn__block">
    <input id="itemValue" type="password" class="b3-text-field b3-form__icona-input" spellcheck="false" value="${Lute.EscapeHTMLStr(initial.value)}">
    <svg class="b3-form__icona-icon" data-action="togglePassword" style="user-select: none;">
        <use xlink:href="#iconEye"></use>
    </svg>
</div>`
        : `<input class="b3-text-field fn__block" id="itemValue" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initial.value)}"/>`;

    const dialog = new Dialog({
        title: titleKey,
        width: isMobile() ? "92vw" : "520px",
        content: `<div class="b3-dialog__content">
    <div class="b3-label b3-label--inner">
        <div class="config-name">${isSecret ? window.siyuan.languages.secretName : window.siyuan.languages.variableName}</div>
        <div class="b3-label__text">${isSecret ? window.siyuan.languages.secretNameTip : window.siyuan.languages.variableNameTip}</div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" id="itemName" type="text" spellcheck="false" value="${Lute.EscapeHTMLStr(initial.name)}"/>
    </div>
    <div class="b3-label b3-label--inner">
        <div class="config-name">${valueKey}</div>
        <div class="fn__hr"></div>
        ${valueInputHtml}
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });

    dialog.element.setAttribute("data-key", Constants.DIALOG_AIPROVIDER);
    if (isSecret) {
        bindPasswordIconaToggle(dialog.element, "itemValue");
    }
    dialog.element.querySelector<HTMLInputElement>("#itemName").select();

    const btns = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
    btns[0].addEventListener("click", () => dialog.destroy());
    btns[1].addEventListener("click", () => {
        const next: NamedItem = {
            ...initial,
            name: dialog.element.querySelector<HTMLInputElement>("#itemName").value.trim(),
            value: dialog.element.querySelector<HTMLInputElement>("#itemValue").value,
        };
        if (!next.name) {
            showMessage(nameRequiredKey);
            return;
        }
        if (configItems.some((item) => item.name === next.name && item.name !== existingName)) {
            showMessage(nameDuplicateKey);
            return;
        }
        const nextItems = isNew
            ? [...configItems, next]
            : configItems.map((item) => item.name !== existingName ? item : next);
        if (isSecret) {
            saveSecrets(root, nextItems);
        } else {
            saveVariables(root, nextItems);
        }
        dialog.destroy();
    });
};

const showDeleteConfirm = (title: string, onConfirm: () => void) => {
    confirmDialog(
        window.siyuan.languages.deleteOpConfirm,
        window.siyuan.languages.confirmDeleteTip.replace("${x}", Lute.EscapeHTMLStr(title)),
        onConfirm,
        undefined,
        true,
    );
};

// endregion
