/// #if !BROWSER
import * as path from "path";
import {useShell} from "../../util/pathName";
/// #endif
import type {SettingTabBuilder} from "../setting/builder";
import {Constants} from "../../constants";
/// #if !MOBILE
import {resetLayout} from "../../layout/util";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
/// #endif
import {desktopModeCookie} from "../../util/cookie";
import {isMobile, objEquals} from "../../util/functions";
import {exitSiYuan} from "../../dialog/processSystem";
import {fetchPost} from "../../util/fetch";
import {openByMobile} from "../../editor/openLink";
import {openSnippets} from "../util/snippets";
import {confirmDialog} from "../../dialog/confirmDialog";
import {Dialog} from "../../dialog";
import {Menu} from "../../plugin/Menu";
import {escapeAttr} from "../../util/escape";
import {genConfigItemMainHtml, genListSwitchItemHtml} from "../render/fragments";
import {genStackHtml} from "../render/render";
import {controlBoolean} from "../setting/control";
import {editorConfigApi} from "./editorRuntime";
import {appearanceThemeModeValue, saveThemeMode} from "./appearanceRuntime";
import {upDownHint} from "../../util/upDownHint";

interface IFontItem {
    family: string;
    weight: number;
    displayName: string;
}

const registerAppearanceContentGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("content", window.siyuan.languages.configGroupContent);

    group.slot({
        key: "fontFamily",
        keywords: [window.siyuan.languages.font, window.siyuan.languages.font1],
        html: () =>
            `<div class="fn__flex b3-label config-item config-wrap">
    ${genConfigItemMainHtml(window.siyuan.languages.font, window.siyuan.languages.font1)}
    <span class="fn__space"></span>
    <input
        class="b3-select fn__flex-center fn__size200"
        id="editor.fontFamily"
        data-family="${escapeAttr(window.siyuan.config.editor.fontFamily)}"
        data-weight="${window.siyuan.config.editor.fontWeight}"
        data-display="${escapeAttr(window.siyuan.config.editor.fontFamilyDisplay)}"
        value="${escapeAttr(window.siyuan.config.editor.fontFamilyDisplay || window.siyuan.config.editor.fontFamily || window.siyuan.languages.default)}"
        readonly
        style="font-family: ${window.siyuan.config.editor.fontFamily ? window.siyuan.config.editor.fontFamily + ", var(--b3-font-family)" : "var(--b3-font-family)"};
        ${window.siyuan.config.editor.fontWeight ? `font-weight: ${window.siyuan.config.editor.fontWeight};` : ""}"
    >
</div>`,
        afterMount: mountAppearanceFontFamily,
    });
    group.range("editor.fontSize", {
        title: window.siyuan.languages.editorFontSize,
        desc: window.siyuan.languages.fontSizeTip,
        min: 9,
        max: 72,
        step: 1,
        save: (value) => editorConfigApi.patch("editor.fontSize", value),
    });
    /// #if !MOBILE
    group.switch("editor.fontSizeScrollZoom", {
        title: window.siyuan.languages.fontSizeScrollZoom,
        desc: window.siyuan.languages.fontSizeScrollZoomTip,
        save: (value) => editorConfigApi.patch("editor.fontSizeScrollZoom", value),
    });
    /// #endif
    group.switch("editor.fullWidth", {
        title: window.siyuan.languages.fullWidth,
        desc: window.siyuan.languages.fullWidthTip,
        save: (value) => editorConfigApi.patch("editor.fullWidth", value),
    });
    group.switch("editor.justify", {
        title: window.siyuan.languages.justify,
        desc: window.siyuan.languages.justifyTip,
        save: (value) => editorConfigApi.patch("editor.justify", value),
    });
    group.switch("editor.rtl", {
        title: window.siyuan.languages.rtl,
        desc: window.siyuan.languages.rtlTip,
        save: (value) => editorConfigApi.patch("editor.rtl", value),
    });
};

const genFontListItemHtml = (item: IFontItem, checked: boolean) => {
    return `<div class="b3-list-item b3-list-item--narrow">
    <span class="b3-menu__label" data-family="${item.family}" style='font-family:"${item.family}", var(--b3-font-family);${item.weight ? ` font-weight: ${item.weight};` : ""}'>${item.displayName}</span>
    ${checked ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}
</div>`;
};

const mountAppearanceFontFamily = (root: HTMLElement) => {
    const fontFamilyEl = root.querySelector<HTMLInputElement>(`#${CSS.escape("editor.fontFamily")}`);
    if (!fontFamilyEl) {
        return;
    }
    fontFamilyEl.addEventListener("click", () => {
        fetchPost("/api/system/getSysFonts", {}, (response) => {
            const curFamily = fontFamilyEl.dataset.family;
            const curWeight = parseInt(fontFamilyEl.style.fontWeight || "400", 10);
            const defaultItemHtml = genFontListItemHtml({
                family: "",
                displayName: window.siyuan.languages.default,
                weight: 400,
            }, curFamily === "");
            const fontItemHtml = response.data.map((item: IFontItem) =>
                genFontListItemHtml(item, item.family === curFamily && item.weight === curWeight)
            ).join("");
            const fontMenu = new Menu();
            fontMenu.addItem({
                iconHTML: "",
                type: "empty",
                label: `<div class="fn__flex-column b3-menu__filter">
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.search}">
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background">${defaultItemHtml}${fontItemHtml}</div>
</div>`,
                bind(element) {
                    const listElement = element.querySelector(".b3-list");
                    listElement.firstElementChild.classList.add("b3-list-item--focus");
                    const inputElement = element.querySelector("input");
                    const filterFontList = () => {
                        const value = inputElement.value.toLowerCase().trim();
                        listElement.querySelector(".b3-list-item--focus")?.classList.add("b3-list-item--focus");
                        listElement.querySelectorAll<HTMLElement>(".b3-list-item .b3-menu__label").forEach((item) => {
                            const name = item.textContent.trim();
                            item.parentElement.classList.toggle("fn__none", !(!value || item.dataset.family.toLowerCase().includes(value) || name.toLowerCase().includes(value)));
                            const idx = name.toLowerCase().indexOf(value);
                            if (idx === -1 || !value) {
                                item.innerHTML = name;
                            } else {
                                item.innerHTML = `${name.slice(0, idx)}<mark>${name.slice(idx, idx + value.length)}</mark>${name.slice(idx + value.length)}`;
                            }
                        });
                        listElement.querySelector(".b3-list-item:not(.fn__none)")?.classList.add("b3-list-item--focus");
                    };
                    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                        event.stopPropagation();
                        if (event.isComposing) {
                            return;
                        }
                        upDownHint(listElement, event);
                        if (event.key === "Enter") {
                            const itemEl = listElement.querySelector(".b3-list-item--focus .b3-menu__label") as HTMLElement;
                            persistEditorFont({
                                family: itemEl.dataset.family,
                                displayName: itemEl.textContent.trim(),
                                weight: parseInt(itemEl.style.fontWeight) || 400
                            });
                            fontMenu.close();
                        } else if (event.key === "Escape") {
                            window.siyuan.menus.menu.remove();
                        }
                    });
                    inputElement.addEventListener("input", (event: InputEvent) => {
                        if (event.isComposing) {
                            return;
                        }
                        filterFontList();
                    });
                    inputElement.addEventListener("compositionend", filterFontList);
                    // 列表点击委托，读取 dataset 应用选中逻辑
                    listElement.addEventListener("click", (event) => {
                        const target = event.target as HTMLElement;
                        const itemEl = target.closest(".b3-list-item")?.querySelector(".b3-menu__label") as HTMLElement;
                        if (!itemEl) {
                            return;
                        }
                        persistEditorFont({
                            family: itemEl.dataset.family,
                            displayName: itemEl.textContent.trim(),
                            weight: parseInt(itemEl.style.fontWeight) || 400
                        });
                        fontMenu.close();
                    });
                }
            });
            const rect = fontFamilyEl.getBoundingClientRect();
            fontMenu.open({x: rect.left, y: rect.bottom, h: rect.height});
            // 内部列表自行滚动，搜索框保持固定
            fontMenu.element.querySelector(".b3-menu__items").setAttribute("style", "overflow: initial");
            fontMenu.element.querySelector("input").focus();
        });
    });

    function persistEditorFont(item: IFontItem) {
        if (fontFamilyEl.dataset.family === item.family && parseInt(fontFamilyEl.style.fontWeight) === item.weight) {
            return;
        }
        fetchPost(
            "/api/setting/setEditor",
            {
                ...window.siyuan.config.editor,
                fontFamily: item.family,
                fontWeight: item.weight,
                fontFamilyDisplay: item.displayName,
            },
            (response) => {
                const data = response.data as Config.IEditor;
                editorConfigApi.apply(data);
                fontFamilyEl.value = data.fontFamilyDisplay || data.fontFamily || window.siyuan.languages.default;
                fontFamilyEl.dataset.family = data.fontFamily;
                fontFamilyEl.style.fontFamily = `${data.fontFamily ? data.fontFamily + ", " : ""}var(--b3-font-family)`;
                fontFamilyEl.style.fontWeight = data.fontWeight ? String(data.fontWeight) : "400";
            }
        );
    }
};

const registerAppearanceInterfaceGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("interface", window.siyuan.languages.configGroupInterface);

    group.select("appearance.lang", {
        title: window.siyuan.languages.language,
        desc: window.siyuan.languages.language1,
        options: window.siyuan.config.langs.map((lang) => ({
            value: lang.name,
            label: `${lang.label} (${lang.name})`,
        })),
    });
    group.select("appearance.__themeMode", {
        title: window.siyuan.languages.appearance4,
        desc: window.siyuan.languages.appearance5,
        options: [
            {value: 0, label: window.siyuan.languages.themeLight},
            {value: 1, label: window.siyuan.languages.themeDark},
            {value: 2, label: window.siyuan.languages.themeOS},
        ],
        readConfig: appearanceThemeModeValue,
        save: (value) => {
            const themeValue = typeof value === "number" ? value : parseInt(String(value), 10);
            saveThemeMode(themeValue);
        },
    });
    group.stack({
        key: "theme",
        keywords: [
            window.siyuan.languages.theme,
            window.siyuan.languages.theme11,
            window.siyuan.languages.theme12,
            window.siyuan.languages.appearance9,
        ],
        afterMount: (root) => {
            /// #if !BROWSER
            root.querySelector("#appearanceOpenTheme")?.addEventListener("click", () => {
                useShell("openPath", path.join(window.siyuan.config.system.confDir, "appearance", "themes"));
            });
            /// #endif
        },
    }, (stack) => {
        stack.title(window.siyuan.languages.theme);
        /// #if !BROWSER
        stack.button({
            id: "appearanceOpenTheme",
            label: window.siyuan.languages.appearance9,
            icon: "iconFolder",
        });
        /// #endif
        stack.select("appearance.themeLight", {
            desc: window.siyuan.languages.theme11,
            options: window.siyuan.config.appearance.lightThemes.map((item) => ({
                value: item.name,
                label: item.label,
            })),
        });
        stack.select("appearance.themeDark", {
            desc: window.siyuan.languages.theme12,
            options: window.siyuan.config.appearance.darkThemes.map((item) => ({
                value: item.name,
                label: item.label,
            })),
        });
    });
    group.stack({
        key: "icon",
        keywords: [
            window.siyuan.languages.icon,
            window.siyuan.languages.theme2,
            window.siyuan.languages.appearance8,
        ],
        afterMount: (root) => {
            /// #if !BROWSER
            root.querySelector("#appearanceOpenIcon")?.addEventListener("click", () => {
                useShell("openPath", path.join(window.siyuan.config.system.confDir, "appearance", "icons"));
            });
            /// #endif
        },
    }, (stack) => {
        stack.title(window.siyuan.languages.icon);
        /// #if !BROWSER
        stack.button({
            id: "appearanceOpenIcon",
            label: window.siyuan.languages.appearance8,
            icon: "iconFolder",
        });
        /// #endif
        stack.select("appearance.icon", {
            desc: window.siyuan.languages.theme2,
            options: window.siyuan.config.appearance.icons.map((item) => ({
                value: item.name,
                label: item.label,
            })),
        });
    });
    group.stack({
        key: "codeBlockTheme",
        keywords: [
            window.siyuan.languages.appearance1,
            window.siyuan.languages.appearance2,
            window.siyuan.languages.appearance3,
        ],
    }, (stack) => {
        stack.title(window.siyuan.languages.appearance1);
        stack.select("appearance.codeBlockThemeLight", {
            desc: window.siyuan.languages.appearance2,
            options: Constants.SIYUAN_CONFIG_APPEARANCE_LIGHT_CODE.map(value => ({value})),
        });
        stack.select("appearance.codeBlockThemeDark", {
            desc: window.siyuan.languages.appearance3,
            options: Constants.SIYUAN_CONFIG_APPEARANCE_DARK_CODE.map(value => ({value})),
        });
    });
};

const registerAppearanceControlsGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("controls", window.siyuan.languages.configGroupControls);

    /// #if !MOBILE
    group.select("editor.floatWindowMode", {
        title: window.siyuan.languages.floatWindowMode,
        desc: window.siyuan.languages.floatWindowModeTip,
        options: [
            {value: 0, label: window.siyuan.languages.floatWindowMode0},
            {value: 1, label: window.siyuan.languages.floatWindowMode1.replace("${hotkey}", updateHotkeyTip("⌘"))},
            {value: 2, label: window.siyuan.languages.floatWindowMode2},
        ],
        save: (value) => editorConfigApi.patch("editor.floatWindowMode", value),
        afterMount: bindFloatWindowModeVisibility,
    });
    group.number("editor.floatWindowDelay", {
        title: window.siyuan.languages.floatWindowDelay,
        desc: window.siyuan.languages.floatWindowDelayTip,
        min: 0,
        max: 2000,
        unit: "ms",
        save: (value) => editorConfigApi.patch("editor.floatWindowDelay", value),
    });
    group.select("appearance.closeButtonBehavior", {
        title: window.siyuan.languages.appearance10,
        desc: window.siyuan.languages.appearance12,
        options: [
            {value: 0, label: window.siyuan.languages._trayMenu.quit},
            {value: 1, label: window.siyuan.languages.appearance11},
        ],
    });
    group.switch("appearance.hideToolbar", {
        title: window.siyuan.languages.appearance19,
        desc: window.siyuan.languages.appearance20,
    });
    /// #endif
    group.stack({
        key: "statusBar",
        keywords: [
            window.siyuan.languages.appearance16,
            window.siyuan.languages.appearance17,
            window.siyuan.languages.appearance18,
        ],
        afterMount: mountAppearanceSetStatusBar,
    }, (stack) => {
        stack.title(window.siyuan.languages.appearance16);
        stack.switch("appearance.hideStatusBar", {
            desc: window.siyuan.languages.appearance17,
        });
        stack.desc(window.siyuan.languages.appearance18);
        stack.button({
            id: "statusBarSetting",
            label: window.siyuan.languages.config,
            icon: "iconSettings",
        });
    });
    group.stack({
        key: "notifications",
        keywords: [
            window.siyuan.languages.notifications,
            window.siyuan.languages.notificationsMsgPushTip,
            window.siyuan.languages.msgDocTreeMaxList,
            window.siyuan.languages.msgTagMaxList,
            window.siyuan.languages.msgWorkspaceNotSSD,
            window.siyuan.languages.msgBrowserCompatibility,
        ],
        afterMount: mountAppearanceSetNotifications,
    }, (stack) => {
        stack.title(window.siyuan.languages.notifications);
        stack.button({
            id: "notificationsSetting",
            label: window.siyuan.languages.config,
            icon: "iconSettings",
        });
        stack.desc(window.siyuan.languages.notificationsMsgPushTip);
    });
    const desktopModeControl = controlBoolean("desktopMode", {
        readConfig: () => desktopModeCookie.read(),
    });
    // https://github.com/siyuan-note/siyuan/issues/13952
    group.composite({
        key: "desktopMode",
        keywords: [
            window.siyuan.languages.desktopMode,
            window.siyuan.languages.mobileModeTip,
            window.siyuan.languages.reset,
        ],
        html: () => genStackHtml([
            {
                left: {kind: "title", text: window.siyuan.languages.desktopMode},
                right: {
                    kind: "button",
                    id: "resetDesktopMode",
                    label: window.siyuan.languages.reset,
                    icon: "iconUndo",
                },
            },
            {
                left: {kind: "desc", text: window.siyuan.languages.mobileModeTip},
                right: desktopModeControl,
            },
            {
                left: {kind: "desc", text: window.siyuan.languages.desktopModeRestartTip},
            },
        ]),
        controls: [{
            control: desktopModeControl,
            save: (value) => {
                desktopModeCookie.set(value as boolean);
                // 切换桌面/移动模式需要重启应用才能加载对应 bundle，走正常退出流程后由用户手动重启
                void exitSiYuan();
            },
        }],
        afterMount: (root) => {
            root.querySelector("#resetDesktopMode")?.addEventListener("click", () => {
                desktopModeCookie.remove();
                void exitSiYuan();
            });
        },
    });
    /// #if !MOBILE
    group.button({
        id: "resetLayout",
        title: window.siyuan.languages.resetLayout,
        desc: window.siyuan.languages.appearance6,
        label: window.siyuan.languages.reset,
        icon: "iconUndo",
        afterMount: (root) => {
            root.querySelector("#resetLayout")?.addEventListener("click", () => {
                confirmDialog(
                    "⚠️ " + window.siyuan.languages.reset,
                    window.siyuan.languages.appearance6,
                    resetLayout
                );
            });
        },
    });
    /// #endif
};

/// #if !MOBILE
const bindFloatWindowModeVisibility = (root: HTMLElement) => {
    const fwModeEl = root.querySelector<HTMLSelectElement>(`#${CSS.escape("editor.floatWindowMode")}`);
    const delayRow = root.querySelector(`#${CSS.escape("editor.floatWindowDelay")}`)?.closest(".config-item");
    if (!fwModeEl || !delayRow) {
        return;
    }
    const handleFloatWindowModeChange = () => {
        const mode = parseInt(fwModeEl.value, 10);
        delayRow.classList.toggle("fn__none", mode !== 0);
    };
    fwModeEl.addEventListener("change", handleFloatWindowModeChange);
    handleFloatWindowModeChange();
};
/// #endif

const STATUS_BAR_MSG_ITEMS: { key: keyof Config.IAppearanceStatusBar; taskKey: string }[] = [
    {key: "msgTaskDatabaseIndexCommitDisabled", taskKey: "task.database.index.commit"},
    {key: "msgTaskAssetDatabaseIndexCommitDisabled", taskKey: "task.asset.database.index.commit"},
    {key: "msgTaskHistoryDatabaseIndexCommitDisabled", taskKey: "task.history.database.index.commit"},
    {key: "msgTaskHistoryGenerateFileDisabled", taskKey: "task.history.generateFile"},
];

const genStatusBarMsgDialogHtml = (): string => {
    const listItems = STATUS_BAR_MSG_ITEMS.map(({key, taskKey}) =>
        genListSwitchItemHtml(key, window.siyuan.languages._taskAction[taskKey], !window.siyuan.config.appearance.statusBar[key])
    ).join("");
    return `<div class="fn__hr"></div>
<div class="b3-label">
    ${window.siyuan.languages.statusBarMsgPushTip}
    <div class="fn__hr"></div>
    <div class="b3-list b3-list--background">${listItems}</div>
</div>`;
};

const readStatusBarMsgFromDialog = (root: HTMLElement): Config.IAppearanceStatusBar =>
    STATUS_BAR_MSG_ITEMS.reduce((acc, {key}) => {
        acc[key] = !(root.querySelector(`#${CSS.escape(key)}`) as HTMLInputElement).checked;
        return acc;
    }, {} as Config.IAppearanceStatusBar);

const mountAppearanceSetStatusBar = (root: HTMLElement) => {
    root.querySelector("#statusBarSetting")?.addEventListener("click", () => {
        const dialog = new Dialog({
            height: "80vh",
            width: isMobile() ? "92vw" : "360px",
            title: "🔇 " + window.siyuan.languages.appearance18,
            content: genStatusBarMsgDialogHtml(),
            destroyCallback() {
                const statusBar = readStatusBarMsgFromDialog(dialog.element);
                if (objEquals(statusBar, window.siyuan.config.appearance.statusBar)) {
                    return;
                }
                fetchPost("/api/setting/setAppearance", {
                    ...window.siyuan.config.appearance,
                    statusBar
                });
            }
        });
    });
};

const NOTIFICATIONS_ITEMS: { field: keyof Config.IAppearanceNotifications; labelKey: "msgDocTreeMaxList" | "msgTagMaxList" | "msgWorkspaceNotSSD" | "msgBrowserCompatibility" }[] = [
    {field: "docTreeMaxList", labelKey: "msgDocTreeMaxList"},
    {field: "tagMaxList", labelKey: "msgTagMaxList"},
    {field: "workspaceNotSSD", labelKey: "msgWorkspaceNotSSD"},
    {field: "browserCompatibility", labelKey: "msgBrowserCompatibility"},
];

const genNotificationsDialogHtml = (): string => {
    const notifications = window.siyuan.config.appearance.notifications;
    // 默认启用：字段为 undefined（旧配置未迁移）或 true 时开关勾选
    const listItems = NOTIFICATIONS_ITEMS.map(({field, labelKey}) =>
        genListSwitchItemHtml(field, window.siyuan.languages[labelKey], notifications?.[field] !== false)
    ).join("");
    return `<div class="fn__hr"></div>
<div class="b3-label">
    ${window.siyuan.languages.notificationsMsgPushTip}
    <div class="fn__hr"></div>
    <div class="b3-list b3-list--background">${listItems}</div>
</div>`;
};

const readNotificationsFromDialog = (root: HTMLElement): Config.IAppearanceNotifications => {
    return {
        docTreeMaxList: (root.querySelector("#docTreeMaxList") as HTMLInputElement).checked,
        tagMaxList: (root.querySelector("#tagMaxList") as HTMLInputElement).checked,
        workspaceNotSSD: (root.querySelector("#workspaceNotSSD") as HTMLInputElement).checked,
        browserCompatibility: (root.querySelector("#browserCompatibility") as HTMLInputElement).checked,
    };
};

const mountAppearanceSetNotifications = (root: HTMLElement) => {
    root.querySelector("#notificationsSetting")?.addEventListener("click", () => {
        const dialog = new Dialog({
            height: "80vh",
            width: isMobile() ? "92vw" : "360px",
            title: "🔔 " + window.siyuan.languages.notifications,
            content: genNotificationsDialogHtml(),
            destroyCallback() {
                const notifications = readNotificationsFromDialog(dialog.element);
                if (objEquals(notifications, window.siyuan.config.appearance.notifications)) {
                    return;
                }
                fetchPost("/api/setting/setAppearance", {
                    ...window.siyuan.config.appearance,
                    notifications
                });
            }
        });
    });
};

const registerAppearancePersonalizationGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("personalization", window.siyuan.languages.configGroupPersonalization);

    /// #if !BROWSER
    group.button({
        id: "appearanceOpenEmoji",
        title: window.siyuan.languages.customEmoji,
        desc: window.siyuan.languages.customEmojiTip,
        label: window.siyuan.languages.showInFolder,
        icon: "iconFolder",
        afterMount: (root) => {
            root.querySelector("#appearanceOpenEmoji")?.addEventListener("click", () => {
                useShell("openPath", path.join(window.siyuan.config.system.dataDir, "emojis"));
            });
        },
    });
    /// #endif
    group.stack({
        key: "codeSnippet",
        keywords: [
            window.siyuan.languages.codeSnippet,
            window.siyuan.languages.codeSnippetTip,
            window.siyuan.languages.visitCommunityShare,
            window.siyuan.languages.config,
        ],
        afterMount: mountAppearanceCodeSnippet,
    }, (stack) => {
        stack.title(window.siyuan.languages.codeSnippet);
        if ("zh-CN" === window.siyuan.config.lang) {
            stack.button({
                id: "codeSnippetCommunityShare",
                label: window.siyuan.languages.visitCommunityShare,
                icon: "iconUpload",
            });
        }
        stack.desc(window.siyuan.languages.codeSnippetTip);
        stack.button({
            id: "codeSnippet",
            label: window.siyuan.languages.config,
            icon: "iconSettings",
        });
    });
};

const mountAppearanceCodeSnippet = (root: HTMLElement) => {
    root.querySelector("#codeSnippetCommunityShare")?.addEventListener("click", () => {
        openByMobile("https://ld246.com/tag/code-snippet");
    });
    root.querySelector("#codeSnippet")?.addEventListener("click", () => {
        openSnippets();
    });
};

export const registerAppearanceTab = (tab: SettingTabBuilder) => {
    registerAppearanceContentGroup(tab);
    registerAppearanceInterfaceGroup(tab);
    registerAppearanceControlsGroup(tab);
    registerAppearancePersonalizationGroup(tab);
};
