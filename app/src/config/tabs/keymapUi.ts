import {isMac, updateHotkeyTip} from "../../protyle/util/compatibility";
import {matchHotKey} from "../../protyle/util/hotKey";
import {Constants} from "../../constants";
import {hideMessage, showMessage} from "../../dialog/message";
import {fetchSyncPost} from "../../util/fetch";
import {exportLayout} from "../../layout/util";
import {updateDockHotkeys} from "../../layout/dock/util";
import {confirmDialog} from "../../dialog/confirmDialog";
import {sendGlobalShortcut, sendUnregisterGlobalShortcut} from "../../boot/globalEvent/globalShortcut";
import {syncAppMenuShortcuts} from "../../boot/globalEvent/commonHotkey";
import {normalizeSearchText} from "../search/normalize";
import {genButtonRowHtml, genConfigGroup} from "../render/render";
import type {Plugin} from "../../plugin";
import {isDisallowedTextInputHotkey, isReservedKeymap} from "../../util/hotKeyPolicy";
import {resolvePluginToolbar} from "../../plugin/toolbarItem";
import {ensurePluginKeymap} from "../../plugin/keymap";
import {getKeymapBindings, getKeymapItem, setKeymapBindings, normalizeShortcutKey} from "../../util/keymapBindings";
import {genKeymapRowHtml, getRowBindings, renderRowBindings} from "./keymapRow";
import {escapeHtml} from "../../util/escape";
import {Menu} from "../../plugin/Menu";

const keymapToolbarSearchStrings = (): string[] => [
    window.siyuan.languages.keymapTip,
    window.siyuan.languages.keymapTip2,
    window.siyuan.languages.refresh,
    window.siyuan.languages.reset,
];

const keymapFilters = () => [
    ["all", window.siyuan.languages.all],
    ["assigned", window.siyuan.languages.keymapAssigned],
    ["customized", window.siyuan.languages.keymapCustomized],
    ["unassigned", window.siyuan.languages.keymapUnassigned],
    ["conflict", window.siyuan.languages.conflict],
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
            keymapSaveQueue = keymapSaveQueue.then(async () => {
                try {
                    const data = JSON.parse(JSON.stringify(Constants.SIYUAN_KEYMAP));
                    const response = await fetchSyncPost("/api/setting/setKeymap", {data});
                    if (response.code !== 0) {
                        throw new Error(response.msg);
                    }
                    savedKeymap = data;
                    applyKeymap(data);
                    void exportLayout({cb: () => window.location.reload(), errorExit: false});
                } catch (error) {
                    console.error("Could not reset shortcuts:", error);
                    showMessage(window.siyuan.languages.keymapSaveFailed);
                }
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
    ...keymapFilters().map(([, label]) => label),
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
    Object.keys(Constants.SIYUAN_KEYMAP.editor.general).forEach(pushKey);
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
    for (const toolbarItem of resolvePluginToolbar(item, [])) {
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

    return `<div class="b3-label file-tree config-keymap config-item" id="keymapList" data-keymap-filter="all">
    <div class="fn__flex">
        <input id="keymapInput" class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.searchPlaceholder}">
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
    <div class="config-keymap__filters">${keymapFilters().map(([value, label]) =>
        `<button type="button" data-keymap-filter-value="${value}" aria-pressed="${value === "all"}" class="b3-chip b3-chip--middle b3-chip--pointer${value === "all" ? " b3-chip--current" : ""}${value === "conflict" ? " fn__none" : ""}">${escapeHtml(label)}</button>`).join("")}</div>
    ${genKeymapListBlock(window.siyuan.languages.general, generalHtml)}
    ${genKeymapListBlock(window.siyuan.languages.editor, editorHtml, true)}
    ${genKeymapListBlock(window.siyuan.languages.plugin, pluginHtml, true)}
</div>`;
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
        html.push(genKeymapRowHtml(window.siyuan.languages[key], keys + Constants.ZWSP + key, item));
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
            ensurePluginKeymap(item.name, command.langKey, command.hotkey),
        ));
    }

    for (const toolbarItem of resolvePluginToolbar(item, [])) {
        if (typeof toolbarItem === "string" || Constants.INLINE_TYPE.concat("|").includes(toolbarItem.name)) {
            continue;
        }
        const toolbarKeymap = ensurePluginKeymap(item.name, toolbarItem.name, toolbarItem.hotkey);
        html.push(genKeymapRowHtml(
            toolbarItem.tip || window.siyuan.languages[toolbarItem.lang],
            pluginKeyPrefix + toolbarItem.name,
            toolbarKeymap,
        ));
    }

    for (const key of Object.keys(item.docks)) {
        const dockKeymap = ensurePluginKeymap(item.name, key, item.docks[key].config.hotkey);
        html.push(genKeymapRowHtml(
            item.docks[key].config.title,
            pluginKeyPrefix + key,
            dockKeymap,
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
    let recording: {row: HTMLElement; element: HTMLElement} | undefined;
    const outsideRecording = (event: PointerEvent) => {
        if (recording && event.target !== recording.element &&
            !(event.target as HTMLElement).closest(".config-keymap__controls")) {
            cancelRecording();
            refreshBindings();
        }
    };
    const cancelRecording = (restoreFocus = false) => {
        if (!recording) {
            return;
        }
        const {row} = recording;
        recording = undefined;
        document.removeEventListener("pointerdown", outsideRecording, true);
        renderRowBindings(row, getRowBindings(row));
        refreshKeymapBindings(root);
        hideMessage("keymapInvalid");
        sendGlobalShortcut(window.siyuan.ws.app);
        if (restoreFocus) {
            row.querySelector<HTMLButtonElement>('[data-type="add"]').focus();
        }
    };
    const refreshBindings = () => refreshKeymapBindings(root);
    root.querySelector(".config-keymap__filters").addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-keymap-filter-value]");
        if (!button) {
            return;
        }
        cancelRecording();
        keymapListElement.dataset.keymapFilter = button.dataset.keymapFilterValue;
        refreshBindings();
    });
    const saveRow = (row: HTMLElement, keys: string[], reset = false) => {
        renderRowBindings(row, keys);
        saveKeymapRow(root, row, keys, reset ? data => {
            delete getKeymapItem(data, row.dataset.key.split(Constants.ZWSP)).bindings.priority;
        } : undefined);
        refreshBindings();
    };
    keymapListElement.addEventListener("pointerdown", (event) => {
        if (recording && (event.target as HTMLElement).closest(".config-keymap__controls") &&
            event.target !== recording.element) {
            event.preventDefault();
        }
    });
    keymapListElement.addEventListener("contextmenu", (event: MouseEvent) => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>(".config-keymap__chip");
        if (!chip || recording) {
            return;
        }
        const index = Number(chip.dataset.index);
        if (index === 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const row = chip.closest<HTMLElement>(".config-keymap__row");
        const menu = new Menu();
        menu.addItem({label: window.siyuan.languages.keymapPrimary, click: () => {
            const keys = getRowBindings(row);
            keys.unshift(keys.splice(index, 1)[0]);
            saveRow(row, keys);
        }});
        menu.open({x: event.clientX, y: event.clientY});
    });
    keymapListElement.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const action = target.closest<HTMLElement>("[data-type]");
        const row = target.closest<HTMLElement>(".config-keymap__row");
        const toggle = target.closest<HTMLElement>(".toggle");
        if (toggle) {
            const hidden = toggle.nextElementSibling.classList.toggle("fn__none");
            toggle.querySelector(".b3-list-item__arrow").classList.toggle("b3-list-item__arrow--open", !hidden);
        }
        if (!row || !action) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const index = Number(action.closest<HTMLElement>("[data-index]")?.dataset.index ?? -1);
        const type = action.dataset.type;
        cancelRecording();
        const keys = getRowBindings(row);
        if (type === "reset") {
            saveRow(row, JSON.parse(row.dataset.defaults), true);
        } else if (type === "remove") {
            keys.splice(index, 1);
            saveRow(row, keys);
            row.querySelector<HTMLButtonElement>('[data-type="add"]').focus();
        } else if (type === "add") {
            const recorder = document.createElement("span");
            recorder.className = "config-keymap__key config-keymap__record";
            recorder.tabIndex = 0;
            recorder.setAttribute("role", "button");
            recorder.textContent = window.siyuan.languages.keymapRecording;
            recorder.setAttribute("aria-label", window.siyuan.languages.keymapRecording);
            row.querySelector(".config-keymap__bindings").append(recorder);
            recording = {row, element: recorder};
            document.addEventListener("pointerdown", outsideRecording, true);
            row.querySelector('[data-type="add"]').classList.add("config-keymap__action--active");
            sendUnregisterGlobalShortcut(window.siyuan.ws.app);
            recorder.focus();
        }
    });
    keymapListElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (!recording || event.target !== recording.element) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape") {
            cancelRecording(true);
            return;
        }
        if (event.repeat) {
            return;
        }
        const hotkey = getKeymapString(event);
        if (!hotkey || ["⌘", "⇧", "⌥", "⌃"].includes(hotkey.at(-1))) {
            return;
        }
        const {row, element} = recording;
        const path = row.dataset.key.split(Constants.ZWSP);
        if (isDisallowedTextInputHotkey(hotkey) || isReservedKeymap(hotkey, path) ||
            !matchHotKey(hotkey, event) ||
            (isMac() && path[0] === "general" && ["goToEditTabNext", "goToEditTabPrev"].includes(path[1]) && hotkey.includes("⌘"))) {
            element.setAttribute("aria-invalid", "true");
            showMessage(`${window.siyuan.languages.invalid} [${updateHotkeyTip(hotkey)}]`, undefined, undefined, "keymapInvalid");
            return;
        }
        const keys = getRowBindings(row);
        if (keys.some(key => matchHotKey(key, event))) {
            return;
        }
        cancelRecording();
        keys.push(hotkey);
        saveRow(row, keys);
        row.querySelector<HTMLButtonElement>('[data-type="add"]').focus();
    }, true);
    keymapListElement.addEventListener("keyup", (event: KeyboardEvent) => {
        if ((event.target as HTMLElement).closest(".config-keymap__controls")) {
            event.stopPropagation();
        }
    });
    keymapListElement.addEventListener("focusout", (event: FocusEvent) => {
        if (recording && event.target === recording.element) {
            // 等待当前点击完成，避免移除目标按钮后丢失添加、删除或恢复操作。
            setTimeout(() => {
                if (recording && document.activeElement !== recording.element) {
                    cancelRecording();
                    refreshBindings();
                }
            }, 0);
        }
    });
    refreshBindings();
};

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
    if (keymapListElement.dataset.keymapFilter !== "all") {
        searchKeymapList(keymapListElement, "", "");
        return;
    }
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
    const filter = keymapListElement.dataset.keymapFilter;
    if (!keywordsLower && !keymapStrLower && filter === "all") {
        resetKeymapList(keymapListElement);
        return;
    }
    keymapListElement.querySelectorAll(".b3-list-item--hide-action > .b3-list-item__text").forEach((item) => {
        const liElement = item.parentElement;
        const keys = getRowBindings(liElement);
        let matchedKeymap = filter === "assigned" ? keys.length > 0 :
            filter === "unassigned" ? keys.length === 0 :
                filter === "customized" ? liElement.dataset.customized === "true" :
                    filter === "conflict" ? liElement.dataset.conflict === "true" : true;
        if (keymapStrLower) {
            const dataValue = getRowBindings(liElement).join(" ");
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

const refreshKeymapBindings = (root: HTMLElement) => {
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".config-keymap__row"));
    const owners = new Map<string, Set<HTMLElement>>();
    rows.forEach(row => getRowBindings(row).forEach(key => {
        const normalized = normalizeShortcutKey(key, isMac());
        if (normalized) {
            const matches = owners.get(normalized) || new Set<HTMLElement>();
            matches.add(row);
            owners.set(normalized, matches);
        }
    }));
    rows.forEach(row => {
        const keys = getRowBindings(row);
        const config = getKeymapItem(window.siyuan.config.keymap, row.dataset.key.split(Constants.ZWSP));
        const controls = row.querySelector(".config-keymap__controls");
        if (config?.bindings && config.bindings.version !== 1) {
            controls.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
                button.disabled = true;
                button.title = window.siyuan.languages.invalid;
            });
        }
        const changed = JSON.stringify(keys) !== row.dataset.defaults;
        row.dataset.customized = String(changed);
        const reset = controls.querySelector<HTMLButtonElement>('[data-type="reset"]');
        reset.style.display = changed ? "" : "none";
        reset.tabIndex = changed ? 0 : -1;
        const conflicts = keys.map(key => (owners.get(normalizeShortcutKey(key, isMac()))?.size || 0) > 1);
        row.dataset.conflict = String(conflicts.some(Boolean));
        row.querySelectorAll<HTMLElement>(".config-keymap__chip").forEach(chip => {
            chip.classList.toggle("config-keymap__chip--conflict", conflicts[Number(chip.dataset.index)]);
        });
    });
    const list = root.querySelector<HTMLElement>("#keymapList");
    const hasConflict = Boolean(list.querySelector('[data-conflict="true"]'));
    if (!hasConflict && list.dataset.keymapFilter === "conflict") {
        list.dataset.keymapFilter = "all";
    }
    list.querySelectorAll<HTMLElement>("[data-keymap-filter-value]").forEach(button => {
        const active = button.dataset.keymapFilterValue === list.dataset.keymapFilter;
        button.classList.toggle("b3-chip--current", active);
        button.setAttribute("aria-pressed", String(active));
        if (button.dataset.keymapFilterValue === "conflict") {
            button.classList.toggle("fn__none", !hasConflict);
        }
    });
    searchKeymapList(list, list.querySelector<HTMLInputElement>("#keymapInput").value,
        list.querySelector<HTMLInputElement>("#searchByKey").dataset.keymap || "");
};

let keymapSaveQueue = Promise.resolve();
let keymapRevision = 0;
let savedKeymap: Config.IKeymap | undefined;

const applyKeymap = (data: Config.IKeymap) => {
    sendUnregisterGlobalShortcut(window.siyuan.ws.app);
    window.siyuan.config.keymap = data;
    window.siyuan.ws.app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            command.customHotkey = data.plugin?.[plugin.name]?.[command.langKey]?.custom || "";
        });
    });
    updateDockHotkeys();
    sendGlobalShortcut(window.siyuan.ws.app);
    syncAppMenuShortcuts(Boolean(document.activeElement?.matches(".config-keymap__record, #searchByKey")));
};

const saveKeymapRow = (root: HTMLElement, row: HTMLElement, keys: string[], change?: (data: Config.IKeymap) => void) => {
    savedKeymap ||= JSON.parse(JSON.stringify(window.siyuan.config.keymap));
    const data: Config.IKeymap = JSON.parse(JSON.stringify(window.siyuan.config.keymap));
    const item = getKeymapItem(data, row.dataset.key.split(Constants.ZWSP));
    if (!item) {
        return;
    }
    setKeymapBindings(item, keys);
    change?.(data);
    applyKeymap(data);
    const revision = ++keymapRevision;
    keymapSaveQueue = keymapSaveQueue.then(async () => {
        try {
            const response = await fetchSyncPost("/api/setting/setKeymap", {data});
            if (response.code !== 0) {
                throw new Error(response.msg);
            }
            savedKeymap = data;
        } catch (error) {
            console.error("Could not save shortcuts:", error);
            if (revision !== keymapRevision) {
                return;
            }
            applyKeymap(savedKeymap);
            root.querySelectorAll<HTMLElement>(".config-keymap__row").forEach(element => {
                renderRowBindings(element, getKeymapBindings(getKeymapItem(savedKeymap, element.dataset.key.split(Constants.ZWSP))));
            });
            refreshKeymapBindings(root);
            showMessage(window.siyuan.languages.keymapSaveFailed);
        }
    });
};
