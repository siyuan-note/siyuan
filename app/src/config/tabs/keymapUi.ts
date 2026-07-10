/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {isMac, updateHotkeyTip} from "../../protyle/util/compatibility";
import {matchHotKey} from "../../protyle/util/hotKey";
import {Constants} from "../../constants";
import {hideMessage, showMessage} from "../../dialog/message";
import {fetchPost} from "../../util/fetch";
import {exportLayout} from "../../layout/util";
import {confirmDialog} from "../../dialog/confirmDialog";
import {sendGlobalShortcut, sendUnregisterGlobalShortcut} from "../../boot/globalEvent/keydown";
import {normalizeSearchText} from "../search/normalize";
import {genButtonRowHtml, genConfigGroup} from "../render/render";
import type {Plugin} from "../../plugin";
const keymapToolbarSearchStrings = (): string[] => [
    window.siyuan.languages.keymapTip,
    window.siyuan.languages.keymapTip2,
    window.siyuan.languages.refresh,
    window.siyuan.languages.reset,
];

const genKeymapToolbarHtml = () => genConfigGroup(
    genButtonRowHtml(
        "keymapRefreshBtn",
        window.siyuan.languages.keymapTip,
        undefined,
        window.siyuan.languages.refresh,
        "iconRefresh",
    ) + genButtonRowHtml(
        "keymapResetBtn",
        window.siyuan.languages.keymapTip2,
        undefined,
        window.siyuan.languages.reset,
        "iconUndo",
    ),
);

const genKeymapTabHtml = () => genKeymapToolbarHtml() + genConfigGroup(genKeymapListHtml());

const bindKeymapToolbar = (root: HTMLElement) => {
    root.querySelector("#keymapRefreshBtn")?.addEventListener("click", () => {
        void exportLayout({
            cb() {
                window.location.reload();
            },
            errorExit: false,
        });
    });
    root.querySelector("#keymapResetBtn")?.addEventListener("click", () => {
        confirmDialog("⚠️ " + window.siyuan.languages.reset, window.siyuan.languages.confirmReset, () => {
            fetchPost("/api/setting/setKeymap", {
                data: Constants.SIYUAN_KEYMAP,
            }, () => {
                /// #if !BROWSER
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd: "writeLog",
                    msg: "user reset keymap",
                });
                if (window.siyuan.config.keymap.general.toggleWin.default !== window.siyuan.config.keymap.general.toggleWin.custom) {
                    ipcRenderer.send(Constants.SIYUAN_CMD, {
                        cmd: "unregisterGlobalShortcut",
                        accelerator: window.siyuan.config.keymap.general.toggleWin.custom,
                    });
                }
                sendGlobalShortcut(window.siyuan.ws.app);
                /// #endif
                void exportLayout({
                    cb() {
                        window.location.reload();
                    },
                    errorExit: false,
                });
            });
        });
    });
};

/** 快捷键 Tab 挂载（面板页，不走注册表渲染） */
export const mountKeymapTab = async (root: HTMLElement, keywords?: string) => {
    if (root.innerHTML === "") {
        root.innerHTML = genKeymapTabHtml();
        bindKeymapToolbar(root);
        const keymapList = root.querySelector("#keymapList");
        if (keymapList) {
            bindKeymapList(root);
        }
    }
    const searchElement = root.querySelector("#keymapInput") as HTMLInputElement | null;
    const searchKeymapElement = root.querySelector("#searchByKey") as HTMLInputElement | null;
    const keymapListElement = root.querySelector("#keymapList") as HTMLElement | null;
    if (!searchElement || !searchKeymapElement || !keymapListElement) {
        return;
    }
    if (!keywords) {
        searchElement.value = "";
        searchKeymapElement.value = "";
        searchKeymapElement.dataset.keymap = "";
        resetKeymapList(keymapListElement);
        return;
    }
    // 设置窗口全局搜索进入快捷键 Tab，仅当命中具体命令名时才写入搜索框并筛选列表，
    // 命中分组名时不写入搜索框，完整展示分组
    searchKeymapElement.value = "";
    searchKeymapElement.dataset.keymap = "";
    if (buildKeymapCommandTexts().some((text) => normalizeSearchText(text).includes(keywords))) {
        searchElement.value = keywords;
        searchKeymapList(keymapListElement, keywords, "");
    } else {
        searchElement.value = "";
        resetKeymapList(keymapListElement);
    }
};

export const collectKeymapTabSearchStrings = (): string[] => [
    window.siyuan.languages.keymap,
    ...keymapToolbarSearchStrings(),
    ...buildKeymapKeywords(),
    ...buildKeymapCommandTexts(),
    ...buildKeymapPluginDisplayNames(),
];

const buildKeymapKeywords = (): string[] => [
    // 输入框占位符和按钮文案
    window.siyuan.languages.search,
    window.siyuan.languages.keymap,
    window.siyuan.languages.clear,
    // 命令分组标题
    window.siyuan.languages.general,
    window.siyuan.languages.editor,
    window.siyuan.languages.element,
    window.siyuan.languages.headings,
    window.siyuan.languages.list1,
    window.siyuan.languages.table,
    window.siyuan.languages.plugin,
    // 命令名
    ...buildKeymapCommandTexts(),
    // 有命令的插件名
    ...buildKeymapPluginDisplayNames(),
];

const buildKeymapCommandTexts = (): string[] => {
    const out: string[] = [];
    const pushKey = (key: string) => {
        const text = window.siyuan.languages[key];
        if (text) {
            out.push(text);
        }
    };
    Object.keys(Constants.SIYUAN_KEYMAP.general).forEach(pushKey);
    Object.keys(Constants.SIYUAN_KEYMAP.editor.general).forEach((key) => {
        // TODO 把 window.siyuan.languages.duplicate 直接换成 "创建副本 / 创建镜像副本"，
        // 原先使用 window.siyuan.languages.duplicate 的其他地方换成用新的键
        if (key === "duplicate") {
            const duplicate = window.siyuan.languages.duplicate;
            const duplicateMirror = window.siyuan.languages.duplicateMirror;
            if (duplicate && duplicateMirror) {
                out.push(`${duplicate} / ${duplicateMirror}`);
            }
        } else {
            pushKey(key);
        }
    });
    Object.keys(Constants.SIYUAN_KEYMAP.editor.heading).forEach(pushKey);
    Object.keys(Constants.SIYUAN_KEYMAP.editor.insert).forEach(pushKey);
    Object.keys(Constants.SIYUAN_KEYMAP.editor.list).forEach(pushKey);
    Object.keys(Constants.SIYUAN_KEYMAP.editor.table).forEach(pushKey);
    return out;
};

const buildKeymapPluginDisplayNames = (): string[] => {
    const names: string[] = [];
    window.siyuan.ws.app.plugins.forEach((item) => {
        if (pluginHasKeymapItems(item) && item.displayName) {
            names.push(item.displayName);
        }
    });
    return names;
};

const pluginHasKeymapItems = (item: Plugin): boolean => {
    if (item.commands.length > 0) {
        return true;
    }
    for (const toolbarItem of item.updateProtyleToolbar([])) {
        if (typeof toolbarItem === "string" || Constants.INLINE_TYPE.concat("|").includes(toolbarItem.name)) {
            continue;
        }
        return true;
    }
    return Object.keys(item.docks).length > 0;
};

const genKeymapListHtml = () => {
    const generalHtml = genKeymapItem("general");

    const editorHtml = ([
        [window.siyuan.languages.general, "general"],
        [window.siyuan.languages.element, "insert"],
        [window.siyuan.languages.headings, "heading"],
        [window.siyuan.languages.list1, "list"],
        [window.siyuan.languages.table, "table"],
    ] as const).map(([title, segment]) =>
        genKeymapToggle(title) + `<div class="b3-list__panel fn__none">${genKeymapItem("editor" + Constants.ZWSP + segment)}</div>`
    ).join("");

    const pluginHtmlParts: string[] = [];
    for (const item of window.siyuan.ws.app.plugins) {
        if (!pluginHasKeymapItems(item)) {
            continue;
        }
        pluginHtmlParts.push(
            genKeymapToggle(item.displayName) + `<div class="b3-list__panel fn__none">${buildKeymapPluginCommandHtml(item)}</div>`
        );
    }
    const pluginHtml = pluginHtmlParts.join("");

    return `<div class="b3-label file-tree config-keymap config-item" id="keymapList">
    <div class="fn__flex config-wrap">
        <input id="keymapInput" class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.search}">
        <div class="fn__space"></div>
        <label class="b3-form__icon fn__flex-1 searchByKeyLabel" style="overflow: visible">
            <svg class="b3-form__icon-icon"><use xlink:href="#iconKeymap"></use></svg>
            <input id="searchByKey" style="font-family: var(--b3-font-family-kbd);font-variant-emoji: text;" data-keymap="" class="b3-form__icon-input b3-text-field fn__block" spellcheck="false" autocomplete="off" inputmode="none" readonly placeholder="${window.siyuan.languages.keymap}">
        </label>
        <div class="fn__space"></div>
        <button id="clearSearchBtn" class="b3-button b3-button--outline fn__flex-center fn__size200">
            <svg><use xlink:href="#iconClose"></use></svg>
            ${window.siyuan.languages.clear}
        </button>
    </div>
    <div class="fn__hr"></div>
    ${genKeymapListBlock(window.siyuan.languages.general, generalHtml)}
    ${genKeymapListBlock(window.siyuan.languages.editor, editorHtml, true)}
    ${genKeymapListBlock(window.siyuan.languages.plugin, pluginHtml, true)}
</div>`;
};

const genKeymapRowHtml = (label: string, dataKey: string, custom: string, defaultValue: string) => {
    const keyValue = updateHotkeyTip(custom);
    return `<label class="b3-list-item b3-list-item--narrow b3-list-item--hide-action">
    <span class="b3-list-item__text">${label}</span>
    <span data-type="reset" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.reset}">
        <svg><use xlink:href="#iconUndo"></use></svg>
    </span>
    <span data-type="clear" class="b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.remove}">
        <svg><use xlink:href="#iconTrashcan"></use></svg>
    </span>
    <span data-type="update" class="config-keymap__key">${keyValue}</span>
    <input data-key="${dataKey}" data-value="${custom}" data-default="${defaultValue}" class="b3-text-field fn__none" value="${keyValue}" spellcheck="false" autocomplete="off" inputmode="none" readonly>
</label>`;
};

/** 编辑器快捷键分组，与 {@link Config.IKeymapEditor} 的键一致 */
const EDITOR_KEYMAP_SEGMENTS = ["general", "insert", "heading", "list", "table"] as const satisfies readonly (keyof Config.IKeymapEditor)[];

const isEditorKeymapSegment = (key: string): key is keyof Config.IKeymapEditor =>
    (EDITOR_KEYMAP_SEGMENTS as readonly string[]).includes(key);

const getKeymapTemplateAndConfig = (keys: string): {
    template: Record<string, Config.IKey>;
    config: Record<string, Config.IKey>;
} => {
    const parts = keys.split(Constants.ZWSP);
    if (parts.length === 1 && parts[0] === "general") {
        return {
            template: Constants.SIYUAN_KEYMAP.general,
            config: window.siyuan.config.keymap.general,
        };
    }
    if (parts[0] === "editor" && isEditorKeymapSegment(parts[1])) {
        return {
            template: Constants.SIYUAN_KEYMAP.editor[parts[1]],
            config: window.siyuan.config.keymap.editor[parts[1]],
        };
    }
    return {template: {}, config: {}};
};

const genKeymapItem = (keys: string) => {
    const {template, config} = getKeymapTemplateAndConfig(keys);
    const html: string[] = [];
    // 使用固定的 Constants.SIYUAN_KEYMAP 来保证每次生成的选项顺序一致
    // 避免在设置快捷键之后关闭设置重新打开设置之后选项顺序改变
    for (const key of Object.keys(template)) {
        if (!window.siyuan.languages[key]) {
            continue;
        }
        const item = config[key] ?? template[key];
        let keymapName = window.siyuan.languages[key];
        if ("editor" + Constants.ZWSP + "general" === keys && key === "duplicate") {
            keymapName = `${window.siyuan.languages.duplicate} / ${window.siyuan.languages.duplicateMirror}`;
        }
        html.push(genKeymapRowHtml(keymapName, keys + Constants.ZWSP + key, item.custom, item.default));
    }
    return html.join("");
};

const genKeymapListBlock = (title: string, html: string, open = false) => {
    if (!html) {
        return "";
    }
    return `<div class="b3-list b3-list--border b3-list--background">
    ${genKeymapToggle(title, open)}
    <div class="b3-list__panel${open ? "" : " fn__none"}">${html}</div>
</div>`;
};

const genKeymapToggle = (title: string, open?: boolean) =>
    `<div class="b3-list-item b3-list-item--narrow toggle">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl">
        <svg class="b3-list-item__arrow${open ? " b3-list-item__arrow--open" : ""}"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__text ft__on-surface">${title}</span>
</div>`;

const buildKeymapPluginCommandHtml = (item: Plugin) => {
    const pluginKeyPrefix = `plugin${Constants.ZWSP}${item.name}${Constants.ZWSP}`;
    const html: string[] = [];
    for (const command of item.commands) {
        html.push(genKeymapRowHtml(
            command.langText || (item.i18n ? item.i18n[command.langKey] : "") || command.langKey,
            pluginKeyPrefix + command.langKey,
            command.customHotkey,
            command.hotkey,
        ));
    }

    for (const toolbarItem of item.updateProtyleToolbar([])) {
        if (typeof toolbarItem === "string" || Constants.INLINE_TYPE.concat("|").includes(toolbarItem.name)) {
            continue;
        }
        const toolbarKeymap = window.siyuan.config.keymap.plugin[item.name][toolbarItem.name];
        html.push(genKeymapRowHtml(
            toolbarItem.tip || window.siyuan.languages[toolbarItem.lang],
            pluginKeyPrefix + toolbarItem.name,
            toolbarKeymap.custom,
            toolbarKeymap.default,
        ));
    }

    for (const key of Object.keys(item.docks)) {
        const dockKeymap = window.siyuan.config.keymap.plugin[item.name][key];
        html.push(genKeymapRowHtml(
            item.docks[key].config.title,
            pluginKeyPrefix + key,
            dockKeymap.custom,
            dockKeymap.default,
        ));
    }
    return html.join("");
};

const bindKeymapList = (root: HTMLElement) => {
    const searchElement = root.querySelector("#keymapInput") as HTMLInputElement;
    const searchKeymapElement = root.querySelector("#searchByKey") as HTMLInputElement;
    const keymapListElement = root.querySelector("#keymapList") as HTMLElement;
    searchElement.addEventListener("compositionend", () => {
        searchKeymapList(keymapListElement, searchElement.value, searchKeymapElement.dataset.keymap);
    });
    searchElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        searchKeymapList(keymapListElement, searchElement.value, searchKeymapElement.dataset.keymap);
    });
    searchKeymapElement.addEventListener("focus", () => {
        sendUnregisterGlobalShortcut(window.siyuan.ws.app);
    });
    searchKeymapElement.addEventListener("blur", () => {
        sendGlobalShortcut(window.siyuan.ws.app);
    });
    // 捕获阶段优先于其它监听，确保 keydown 在 IME/全局逻辑之前处理
    // 按键搜索框只录物理键位，不接收文本输入；readonly 可避免 IME 抢占 keydown
    searchKeymapElement.addEventListener("keydown", (event: KeyboardEvent) => {
        event.stopPropagation();
        event.preventDefault();
        const keymapStr = getKeymapString(event);
        searchKeymapElement.value = updateHotkeyTip(keymapStr);
        searchKeymapElement.dataset.keymap = keymapStr;
        searchKeymapList(keymapListElement, searchElement.value, keymapStr);
    }, true);
    root.querySelector("#clearSearchBtn")?.addEventListener("click", () => {
        searchElement.value = "";
        searchKeymapElement.value = "";
        searchKeymapElement.dataset.keymap = "";
        resetKeymapList(keymapListElement);
    });
    keymapListElement.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(keymapListElement)) {
            const type = target.getAttribute("data-type");
            if (type === "reset") {
                const inputElement = target.parentElement.querySelector(".b3-text-field") as HTMLInputElement;
                inputElement.value = updateHotkeyTip(inputElement.getAttribute("data-default"));
                inputElement.setAttribute("data-value", inputElement.getAttribute("data-default"));
                inputElement.previousElementSibling.textContent = inputElement.value;
                setKeymapFromDom(root);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (type === "clear") {
                const inputElement = target.parentElement.querySelector(".b3-text-field") as HTMLInputElement;
                inputElement.value = "";
                inputElement.previousElementSibling.textContent = "";
                inputElement.setAttribute("data-value", "");
                setKeymapFromDom(root);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (type === "update") {
                target.classList.add("fn__none");
                const inputElement = target.nextElementSibling as HTMLInputElement;
                inputElement.classList.remove("fn__none");
                inputElement.focus();
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-list-item--hide-action")) {
                const inputElement = target.querySelector(".b3-text-field") as HTMLInputElement;
                inputElement.classList.remove("fn__none");
                inputElement.focus();
                inputElement.previousElementSibling.classList.add("fn__none");
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("toggle")) {
                if (target.nextElementSibling.classList.contains("fn__none")) {
                    target.firstElementChild.firstElementChild.classList.add("b3-list-item__arrow--open");
                    target.nextElementSibling.classList.remove("fn__none");
                } else {
                    target.firstElementChild.firstElementChild.classList.remove("b3-list-item__arrow--open");
                    target.nextElementSibling.classList.add("fn__none");
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
    let timeout: number;
    const getKeymapInput = (target: EventTarget | null): HTMLInputElement | null =>
        (target as HTMLElement)?.closest?.("label.b3-list-item")?.querySelector("input") as HTMLInputElement || null;
    keymapListElement.addEventListener("keydown", (event: KeyboardEvent) => {
        const inputElement = getKeymapInput(event.target);
        if (!inputElement) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        const keymapStr = getKeymapString(event);
        const adoptKeymapStr = updateHotkeyTip(keymapStr);
        clearTimeout(timeout);
        timeout = window.setTimeout(() => {
            const keys = inputElement.getAttribute("data-key").split(Constants.ZWSP);
            let hasConflict = false;
            if (["⌘", "⇧", "⌥", "⌃"].includes(keymapStr.at(-1) ?? "")) {
                hasConflict = true;
            }
            if (
                !hasConflict && (RESERVED_KEYMAPS.includes(keymapStr) || !matchHotKey(keymapStr, event) ||
                (isMac() && keys[0] === "general" && ["goToEditTabNext", "goToEditTabPrev"].includes(keys[1]) && keymapStr.includes("⌘")))
            ) {
                // TODO 还应该禁止单个数字或字母作为快捷键？
                showMessage(`${window.siyuan.languages.invalid} [${adoptKeymapStr}]`, undefined, undefined, "keymapInvalid");
                hasConflict = true;
            } else {
                hideMessage("keymapInvalid");
            }
            if (!hasConflict) {
                const conflictTips: string[] = [];
                for (const inputItem of root.querySelectorAll<HTMLInputElement>(`label.b3-list-item input[data-value="${CSS.escape(keymapStr)}"]`)) {
                    if (inputItem === inputElement) {
                        continue;
                    }
                    const thirdElement = inputItem.parentElement;
                    const secondElement = thirdElement.parentElement.previousElementSibling;
                    const firstElement = secondElement.parentElement.previousElementSibling;
                    const tipParts: string[] = [];
                    if (firstElement.classList.contains("b3-list-item")) {
                        tipParts.push(firstElement.textContent.trim());
                    }
                    tipParts.push(secondElement.textContent.trim());
                    tipParts.push(thirdElement.querySelector(".b3-list-item__text").textContent.trim());
                    conflictTips.push(tipParts.join("-"));
                }
                // 目前插件注册的命令没有限制跟已有命令重复，所以这里可能有多个冲突
                if (conflictTips.length > 0) {
                    showMessage(`${adoptKeymapStr} ${window.siyuan.languages.conflict} [${conflictTips.join("] [")}]`, undefined, undefined, "keymapConflict");
                    hasConflict = true;
                } else {
                    hideMessage("keymapConflict");
                }
            }
            if (hasConflict) {
                inputElement.value = updateHotkeyTip(inputElement.getAttribute("data-value"));
                return;
            }
            inputElement.setAttribute("data-value", keymapStr);
            inputElement.value = adoptKeymapStr;
            setKeymapFromDom(root);
        }, Constants.TIMEOUT_TRANSITION);
    });
    keymapListElement.addEventListener("focusout", (event: FocusEvent) => {
        const inputElement = getKeymapInput(event.target);
        if (!inputElement) {
            return;
        }
        sendGlobalShortcut(window.siyuan.ws.app);
        setTimeout(() => {
            inputElement.classList.add("fn__none");
            inputElement.previousElementSibling.textContent = inputElement.value;
            inputElement.previousElementSibling.classList.remove("fn__none");
        }, Constants.TIMEOUT_INPUT);
    });
    keymapListElement.addEventListener("focusin", (event: FocusEvent) => {
        if (!getKeymapInput(event.target)) {
            return;
        }
        sendUnregisterGlobalShortcut(window.siyuan.ws.app);
    });
};

const RESERVED_KEYMAPS = ["⌘A", "⌘X", "⌘C", "⌘V", "⌘-", "⌘=", "⌘0", "⇧⌘V", "⌘/", "⇧↑", "⇧↓", "⇧→", "⇧←", "⇧⇥",
    "⌃D", "⇧⌘→", "⇧⌘←", "⌘Home", "⌘End", "⇧↩", "↩", "PageUp", "PageDown", "⌫", "⌦", "Escape"];

const getKeymapString = (event: KeyboardEvent) => {
    const mac = isMac();
    let keymapStr = "";
    if (mac && event.ctrlKey) {
        keymapStr += "⌃";
    }
    if (event.altKey) {
        keymapStr += "⌥";
    }
    if (event.shiftKey) {
        keymapStr += "⇧";
    }
    if ((mac && event.metaKey) || (!mac && event.ctrlKey)) {
        keymapStr += "⌘";
    }
    if (event.key !== "Shift" && event.key !== "Alt" && event.key !== "Meta" && event.key !== "Control" && event.key !== "Unidentified") {
        if (event.keyCode === 229) {
            if (event.code === "Minus") {
                keymapStr += "-";
            } else if (event.code === "Semicolon") {
                keymapStr += ";";
            } else if (event.code === "Quote") {
                keymapStr += "'";
            } else if (event.code === "Comma") {
                keymapStr += ",";
            } else if (event.code === "Period") {
                keymapStr += ".";
            } else if (event.code === "Slash") {
                keymapStr += "/";
            }
        } else {
            keymapStr += Constants.KEYCODELIST[event.keyCode] || (event.key.length > 1 ? event.key : event.key.toUpperCase());
        }
    }
    return keymapStr;
};

const resetKeymapList = (keymapListElement: HTMLElement) => {
    keymapListElement.querySelectorAll(".b3-list-item--hide-action").forEach((liElement) => {
        liElement.classList.remove("fn__none");
        liElement.parentElement.classList.remove("fn__none");
        liElement.parentElement.parentElement.classList.remove("fn__none");
        if (!liElement.nextElementSibling) {
            const panelElement = liElement.parentElement;
            const toggleElement = panelElement.previousElementSibling;
            toggleElement.classList.remove("fn__none");
            if (toggleElement.querySelector(".b3-list-item__arrow").classList.contains("b3-list-item__arrow--open")) {
                panelElement.classList.remove("fn__none");
            } else {
                panelElement.classList.add("fn__none");
            }
        }
    });
    finishKeymapListSearch(keymapListElement, false);
};

const searchKeymapList = (keymapListElement: HTMLElement, keywords: string, keymapStr: string) => {
    const keywordsLower = keywords.trim().toLowerCase();
    const keymapStrLower = keymapStr.trim().toLowerCase();
    if (!keywordsLower && !keymapStrLower) {
        resetKeymapList(keymapListElement);
        return;
    }
    keymapListElement.querySelectorAll(".b3-list-item--hide-action > .b3-list-item__text").forEach((item) => {
        const liElement = item.parentElement;
        let matchedKeymap = true;
        if (keymapStrLower) {
            const dataValue = liElement.querySelector(".b3-text-field").getAttribute("data-value") || "";
            if (!dataValue || dataValue.toLowerCase().indexOf(keymapStrLower) === -1) {
                matchedKeymap = false;
            }
        }
        if (matchedKeymap && (!keywordsLower || normalizeSearchText(item.textContent || "").includes(keywordsLower))) {
            liElement.classList.remove("fn__none");
            liElement.parentElement.classList.remove("fn__none");
            liElement.parentElement.parentElement.classList.remove("fn__none");
        } else {
            liElement.classList.add("fn__none");
        }
        if (!liElement.nextElementSibling) {
            const toggleElement = liElement.parentElement.previousElementSibling;
            if (liElement.parentElement.childElementCount === liElement.parentElement.querySelectorAll(".b3-list-item.fn__none").length) {
                toggleElement.classList.add("fn__none");
            } else {
                toggleElement.classList.remove("fn__none");
            }
        }
    });
    finishKeymapListSearch(keymapListElement, true);
};

const finishKeymapListSearch = (keymapListElement: HTMLElement, isFiltering: boolean) => {
    const keymapListBlocks = keymapListElement.querySelectorAll(":scope > .b3-list");
    const editorBlock = keymapListBlocks[1] as HTMLElement | undefined;
    if (editorBlock) {
        toggleKeymapSearchItem(editorBlock, isFiltering);
    }
    const pluginBlock = keymapListBlocks[2] as HTMLElement | undefined;
    if (pluginBlock) {
        toggleKeymapSearchItem(pluginBlock, isFiltering);
    }
};

const toggleKeymapSearchItem = (editorKeymapElement: HTMLElement, isFiltering: boolean) => {
    if (!isFiltering) {
        if (editorKeymapElement.querySelector(".b3-list-item__arrow").classList.contains("b3-list-item__arrow--open")) {
            editorKeymapElement.lastElementChild.classList.remove("fn__none");
        } else {
            editorKeymapElement.lastElementChild.classList.add("fn__none");
        }
    }
    if (editorKeymapElement.querySelectorAll(".b3-list-item--hide-action.fn__none").length === editorKeymapElement.querySelectorAll(".b3-list-item--hide-action").length) {
        editorKeymapElement.firstElementChild.classList.add("fn__none");
    } else {
        editorKeymapElement.firstElementChild.classList.remove("fn__none");
    }
};

const setKeymapFromDom = (root: HTMLElement) => {
    const data: Config.IKeymap = JSON.parse(JSON.stringify(Constants.SIYUAN_KEYMAP));
    data.plugin = window.siyuan.config.keymap.plugin || {};
    root.querySelectorAll("label.b3-list-item input").forEach((item) => {
        const keys = item.getAttribute("data-key").split(Constants.ZWSP);
        const newHotkey = item.getAttribute("data-value");
        if (keys[0] === "general") {
            data[keys[0]][keys[1]].custom = newHotkey;
        } else if (keys[0] === "editor" && isEditorKeymapSegment(keys[1])) {
            data.editor[keys[1]][keys[2]].custom = newHotkey;
        } else if (keys[0] === "plugin") {
            data.plugin[keys[1]][keys[2]].custom = newHotkey;
            const plugin = window.siyuan.ws.app.plugins.find((item) => item.name === keys[1]);
            const command = plugin?.commands.find((item) => item.langKey === keys[2]);
            if (!command) {
                return;
            }
            /// #if !BROWSER
            if (command.globalCallback && command.customHotkey && command.customHotkey !== newHotkey) {
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd: "unregisterGlobalShortcut",
                    accelerator: command.customHotkey,
                });
            }
            /// #endif
            command.customHotkey = newHotkey;
        }
    });
    const oldToggleWin = window.siyuan.config.keymap.general.toggleWin.custom;
    window.siyuan.config.keymap = data;
    fetchPost("/api/setting/setKeymap", {
        data,
    }, () => {
        /// #if !BROWSER
        ipcRenderer.send(Constants.SIYUAN_CMD, {
            cmd: "writeLog",
            msg: "user update keymap:" + JSON.stringify(window.siyuan.config.keymap),
        });
        if (oldToggleWin !== window.siyuan.config.keymap.general.toggleWin.custom) {
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "unregisterGlobalShortcut",
                accelerator: oldToggleWin,
            });
        }
        sendGlobalShortcut(window.siyuan.ws.app);
        /// #endif
    });
};
