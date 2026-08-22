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
import {getFrontend, isBrowser, isMobile, objEquals} from "../../util/functions";
import {exitSiYuan} from "../../dialog/processSystem";
import {isInMobileApp} from "../../protyle/util/compatibility";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {openLink} from "../../editor/openLink";
import {openSnippets} from "../util/snippets";
import {confirmDialog} from "../../dialog/confirmDialog";
import {Dialog} from "../../dialog";
import {Menu} from "../../plugin/Menu";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {genListSwitchItemHtml} from "../render/fragments";
import {genStackHtml} from "../render/render";
import {controlBoolean} from "../setting/control";
import {editorConfigApi} from "./editorRuntime";
import {appearanceThemeModeValue, saveThemeMode} from "./appearanceRuntime";
import {upDownHint} from "../../util/upDownHint";
import {isThemeFrontendSupported} from "../../util/themeCompatibility";
import {
    ICustomFont,
    invalidateCustomFonts,
    isNativeMobileContainer,
    loadCustomFonts,
    registerCustomFont,
    unregisterCustomFont
} from "../../util/customFont";
import {showMessage} from "../../dialog/message";
/// #if MOBILE
import {genMobileBottomBarSettingHTML, mountMobileBottomBarSetting} from "../../mobile/util/mobileBottomBar";
import {genMobileSidePanelSettingHTML, mountMobileSidePanelSetting} from "../../mobile/util/mobileSidePanelSetting";
/// #endif
/// #if !MOBILE
import {genEntryVisibilityHtml, mountEntryVisibility} from "../entryVisibility/ui";
/// #endif

interface IFontItem {
    id?: string;
    family: string;
    weight: number;
    displayName: string;
    aliases?: string[];
}

const getEditorFonts = (editor: Config.IEditor): IFontItem[] => editor.fontFamilies || [];

const getEditorFontDisplay = (fonts: IFontItem[]) =>
    fonts.map((font) => font.displayName || font.family).join(", ");

const registerAppearanceContentGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("content", window.siyuan.languages.configGroupContent);

    group.slot({
        key: "fontFamilies",
        keywords: [window.siyuan.languages.font, window.siyuan.languages.font1],
        html: () =>
            `<div class="fn__flex b3-label config-item config-wrap">
    <div class="fn__flex-1 config-item__main">
        <div class="config-name">${window.siyuan.languages.font}</div>
        <div class="b3-label__text">${window.siyuan.languages.font1}</div>
        <div class="fn__hr--small"></div>
        <div class="b3-chips b3-chips__doctag${getEditorFonts(window.siyuan.config.editor).length === 0 ? " fn__none" : ""}" data-type="selected-fonts">${genSelectedFontListHtml(getEditorFonts(window.siyuan.config.editor))}</div>
    </div>
    <span class="fn__space"></span>
    <input
        class="b3-select fn__flex-center fn__size200"
        id="editor.fontFamilies"
        value="${escapeAttr(getEditorFontDisplay(getEditorFonts(window.siyuan.config.editor)) || window.siyuan.languages.default)}"
        readonly
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
    const searchText = [item.family, item.displayName, ...(item.aliases || [])].join("\n").toLowerCase();
    return `<div class="b3-list-item b3-list-item--narrow" data-id="${escapeAttr(item.id || "")}">
    <span class="b3-menu__label" data-family="${escapeAttr(item.family)}" data-name="${escapeAttr(item.displayName)}" data-search="${escapeAttr(searchText)}" data-weight="${item.weight || 400}">${escapeHtml(item.displayName)}</span>
    ${checked ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}
    ${item.id && !window.siyuan.config.readonly ? `<span class="b3-menu__action ariaLabel" data-type="delete-font" aria-label="${escapeAttr(window.siyuan.languages.delete)}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>` : ""}
</div>`;
};

const genSelectedFontListHtml = (fonts: IFontItem[]) => fonts.map((font, index) => `<div class="b3-chip b3-chip--middle config-font-family__chip fn__grab" data-index="${index}" data-family="${escapeAttr(font.family)}" data-weight="${font.weight || 400}">
    <span class="fn__ellipsis config-font-family__text">${escapeHtml(font.displayName || font.family)}</span>
    <svg class="b3-chip__close ariaLabel" data-type="font-remove" aria-label="${escapeAttr(window.siyuan.languages.remove)}"><use xlink:href="#iconClose"></use></svg>
</div>`).join("");

const bindSelectedFontList = (element: HTMLElement, getFonts: () => IFontItem[],
                              persist: (fonts: IFontItem[]) => void) => {
    element.addEventListener("click", (event) => {
        const action = (event.target as HTMLElement).closest<HTMLElement>('[data-type="font-remove"]');
        const chipElement = action?.closest<HTMLElement>(".b3-chip");
        const index = parseInt(chipElement?.dataset.index, 10);
        if (!action || !Number.isInteger(index)) {
            return;
        }
        const fonts = [...getFonts()];
        fonts.splice(index, 1);
        persist(fonts);
    });
    element.addEventListener("mousedown", (event: MouseEvent) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('[data-type="font-remove"]')) {
            return;
        }
        const chipElement = (event.target as HTMLElement).closest<HTMLElement>(".b3-chip");
        if (!chipElement || !element.contains(chipElement)) {
            return;
        }
        event.preventDefault();
        const fontsBeforeDrag = getFonts();
        const startX = event.clientX;
        const startY = event.clientY;
        const initialRect = chipElement.getBoundingClientRect();
        const offsetX = startX - initialRect.left;
        const offsetY = startY - initialRect.top;
        let dragging = false;
        let dragClone: HTMLElement;
        const finishDragging = (upEvent: MouseEvent) => {
            document.removeEventListener("mousemove", moveChip);
            document.removeEventListener("mouseup", finishDragging);
            document.body.style.cursor = "";
            if (!dragging) {
                return;
            }
            upEvent.preventDefault();
            upEvent.stopPropagation();
            dragClone.remove();
            chipElement.classList.remove("b3-chip--dragging");
            const fonts = Array.from(element.querySelectorAll<HTMLElement>(".b3-chip")).map((chip) =>
                fontsBeforeDrag[parseInt(chip.dataset.index, 10)]);
            if (fonts.some((font, index) => font !== fontsBeforeDrag[index])) {
                persist(fonts);
            }
        };
        const moveChip = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;
            if (!dragging) {
                if (Math.abs(deltaX) < Constants.SIZE_DRAG_THRESHOLD &&
                    Math.abs(deltaY) < Constants.SIZE_DRAG_THRESHOLD) {
                    return;
                }
                dragging = true;
                dragClone = chipElement.cloneNode(true) as HTMLElement;
                dragClone.classList.add("b3-chip--dragclone");
                Object.assign(dragClone.style, {
                    position: "fixed",
                    left: `${moveEvent.clientX - offsetX}px`,
                    top: `${moveEvent.clientY - offsetY}px`,
                    width: `${initialRect.width}px`,
                    height: `${initialRect.height}px`,
                    margin: "0",
                    zIndex: "9999",
                    pointerEvents: "none",
                    transition: "none",
                });
                document.body.append(dragClone);
                chipElement.classList.add("b3-chip--dragging");
                document.body.style.cursor = "grabbing";
            }
            dragClone.style.left = `${moveEvent.clientX - offsetX}px`;
            dragClone.style.top = `${moveEvent.clientY - offsetY}px`;
            const targetChip = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
                ?.closest<HTMLElement>(".b3-chip");
            if (!targetChip || targetChip === chipElement || !element.contains(targetChip)) {
                return;
            }
            const targetRect = targetChip.getBoundingClientRect();
            const sameRow = moveEvent.clientY >= targetRect.top && moveEvent.clientY <= targetRect.bottom;
            const after = sameRow ? moveEvent.clientX > targetRect.left + targetRect.width / 2 :
                moveEvent.clientY > targetRect.top + targetRect.height / 2;
            if (after) {
                targetChip.after(chipElement);
            } else {
                targetChip.before(chipElement);
            }
        };
        document.addEventListener("mousemove", moveChip);
        document.addEventListener("mouseup", finishDragging);
    });
};

const mountAppearanceFontFamily = (root: HTMLElement) => {
    const fontFamiliesElement = root.querySelector<HTMLInputElement>(`#${CSS.escape("editor.fontFamilies")}`);
    const selectedListElement = root.querySelector<HTMLElement>('[data-type="selected-fonts"]');
    if (!fontFamiliesElement || !selectedListElement) {
        return;
    }
    let selectedFonts = getEditorFonts(window.siyuan.config.editor);
    let refreshOpenMenu: (() => void) | undefined;
    const renderSelectedFonts = () => {
        selectedListElement.innerHTML = genSelectedFontListHtml(selectedFonts);
        selectedListElement.classList.toggle("fn__none", selectedFonts.length === 0);
        selectedListElement.querySelectorAll<HTMLElement>(".b3-chip").forEach((chip) => {
            const textElement = chip.querySelector<HTMLElement>(".config-font-family__text");
            if (textElement) {
                textElement.style.fontFamily = CSS.escape(chip.dataset.family);
                textElement.style.fontWeight = chip.dataset.weight;
            }
        });
        fontFamiliesElement.value = getEditorFontDisplay(selectedFonts) || window.siyuan.languages.default;
    };
    const persistEditorFonts = (fonts: IFontItem[]) => {
        fetchPost(
            "/api/setting/setEditor",
            {
                ...window.siyuan.config.editor,
                fontFamilies: fonts.map((font) => ({
                    family: font.family,
                    weight: font.weight,
                    displayName: font.displayName,
                })),
            },
            (response) => {
                const data = response.data as Config.IEditor;
                selectedFonts = getEditorFonts(data);
                editorConfigApi.apply(data);
                renderSelectedFonts();
                refreshOpenMenu?.();
            }
        );
    };
    bindSelectedFontList(selectedListElement, () => selectedFonts, persistEditorFonts);
    updateFontInput(window.siyuan.config.editor);
    fontFamiliesElement.addEventListener("click", async () => {
        const nativeMobile = isNativeMobileContainer();
        let systemResponse: IWebSocketData;
        let customFonts: ICustomFont[];
        try {
            [systemResponse, customFonts] = await Promise.all([
                fetchSyncPost("/api/system/getSysFonts"),
                nativeMobile ? loadCustomFonts() : Promise.resolve([] as ICustomFont[])
            ]);
        } catch (error) {
            console.warn("load font list failed", error);
            return;
        }
        const systemFonts = Array.isArray(systemResponse.data) ? systemResponse.data as IFontItem[] : [];

        const fontItems = [...customFonts, ...systemFonts];
        selectedFonts = getEditorFonts(window.siyuan.config.editor).map((selectedFont) =>
            fontItems.find((font) => font.family === selectedFont.family && font.weight === selectedFont.weight) ||
            selectedFont);
        renderSelectedFonts();
        const fontItemHtml = fontItems.map((item) =>
            genFontListItemHtml(item, selectedFonts.some((font) =>
                font.family === item.family && font.weight === item.weight))
        ).join("");
        const canManageCustomFonts = nativeMobile && !window.siyuan.config.readonly;
        const customFontsByID = new Map(customFonts.map((font) => [font.id, font]));
        let fontPreviewObserver: IntersectionObserver;
        const fontMenu = new Menu(undefined, () => {
            fontPreviewObserver?.disconnect();
            refreshOpenMenu = undefined;
        });
        fontMenu.addItem({
            iconHTML: "",
            type: "empty",
            label: `<div class="fn__flex-column b3-menu__filter">
    <div class="fn__flex">
        <input class="b3-text-field fn__flex-1" data-type="font-search" placeholder="${escapeAttr(window.siyuan.languages.searchPlaceholder)}">
        ${canManageCustomFonts ? `<span class="fn__space"></span><button class="b3-button b3-button--outline fn__flex-center" data-type="import-font"><svg><use xlink:href="#iconUpload"></use></svg>${escapeHtml(window.siyuan.languages.importFont)}</button>` : ""}
    </div>
    ${nativeMobile ? `<div class="b3-label__text ft__on-surface" style="margin-top: 8px">${escapeHtml(window.siyuan.languages.fontFileTip)}</div>` : ""}
    ${canManageCustomFonts ? '<input class="fn__none" data-type="font-file" type="file" accept=".ttf,.otf,font/ttf,font/otf">' : ""}
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background" data-type="available-fonts">${fontItemHtml}</div>
</div>`,
            bind(element) {
                const listElement = element.querySelector<HTMLElement>('[data-type="available-fonts"]');
                const inputElement = element.querySelector<HTMLInputElement>('[data-type="font-search"]');
                const refreshFontMenu = () => {
                    listElement.querySelectorAll<HTMLElement>(".b3-list-item").forEach((item) => {
                        const label = item.querySelector<HTMLElement>(".b3-menu__label");
                        const checked = selectedFonts.some((font) =>
                            font.family === label.dataset.family && font.weight === parseInt(label.dataset.weight, 10));
                        item.querySelector(".b3-menu__checked")?.remove();
                        if (checked) {
                            item.insertAdjacentHTML("beforeend", '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>');
                        }
                    });
                };
                refreshOpenMenu = refreshFontMenu;
                refreshFontMenu();
                if ("IntersectionObserver" in window) {
                    fontPreviewObserver = new IntersectionObserver((entries) => {
                        entries.forEach((entry) => {
                            const itemElement = entry.target as HTMLElement;
                            const labelElement = itemElement.querySelector<HTMLElement>(".b3-menu__label");
                            if (!entry.isIntersecting || !labelElement?.dataset.family) {
                                labelElement?.style.removeProperty("font-family");
                                labelElement?.style.removeProperty("font-weight");
                                return;
                            }
                            const customFont = itemElement.dataset.id ? customFontsByID.get(itemElement.dataset.id) : undefined;
                            if (customFont) {
                                registerCustomFont(customFont);
                            }
                            labelElement.style.fontFamily = labelElement.dataset.family;
                            labelElement.style.fontWeight = labelElement.dataset.weight;
                        });
                    }, {
                        root: listElement,
                    });
                    listElement.querySelectorAll<HTMLElement>(".b3-list-item").forEach((item) => {
                        fontPreviewObserver.observe(item);
                    });
                } else {
                    listElement.querySelectorAll<HTMLElement>(".b3-menu__label").forEach((item) => {
                        item.style.fontFamily = item.dataset.family;
                        item.style.fontWeight = item.dataset.weight;
                    });
                    customFonts.forEach(registerCustomFont);
                }
                listElement.firstElementChild.classList.add("b3-list-item--focus");
                const filterFontList = () => {
                    const value = inputElement.value.toLowerCase().trim();
                    listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                    listElement.querySelectorAll<HTMLElement>(".b3-list-item .b3-menu__label").forEach((item) => {
                        const name = item.dataset.name;
                        item.parentElement.classList.toggle("fn__none", !(!value ||
                            item.dataset.search.includes(value)));
                        const idx = name.toLowerCase().indexOf(value);
                        item.replaceChildren(document.createTextNode(name));
                        if (idx !== -1 && value) {
                            const markElement = document.createElement("mark");
                            markElement.textContent = name.slice(idx, idx + value.length);
                            item.replaceChildren(
                                document.createTextNode(name.slice(0, idx)),
                                markElement,
                                document.createTextNode(name.slice(idx + value.length))
                            );
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
                        const itemEl = listElement.querySelector<HTMLElement>(".b3-list-item--focus .b3-menu__label");
                        if (itemEl) {
                            toggleEditorFont(fontItemFromElement(itemEl));
                        }
                    } else if (event.key === "Escape") {
                        window.siyuan.menus.menu.remove();
                    }
                });
                inputElement.addEventListener("input", (event: InputEvent) => {
                    if (!event.isComposing) {
                        filterFontList();
                    }
                });
                inputElement.addEventListener("compositionend", filterFontList);
                element.querySelector<HTMLElement>('[data-type="import-font"]')?.addEventListener("click", () => {
                    element.querySelector<HTMLInputElement>('[data-type="font-file"]').click();
                });
                element.querySelector<HTMLInputElement>('[data-type="font-file"]')?.addEventListener("change", (event) => {
                    const fileInput = event.currentTarget as HTMLInputElement;
                    const file = fileInput.files?.[0];
                    fileInput.value = "";
                    if (!file) {
                        return;
                    }
                    if (file.size > 64 * 1024 * 1024) {
                        showMessage(window.siyuan.languages.fontFileTip, 6000, "error");
                        return;
                    }
                    const formData = new FormData();
                    formData.append("file", file);
                    fetchPost("/api/system/importCustomFont", formData, (response) => {
                        const font = response.data as ICustomFont;
                        invalidateCustomFonts();
                        registerCustomFont(font);
                        persistEditorFonts([...selectedFonts.filter((item) => item.family !== font.family), font]);
                        showMessage(window.siyuan.languages.imported);
                    });
                });
                listElement.addEventListener("click", (event) => {
                    const target = event.target as HTMLElement;
                    const itemElement = target.closest<HTMLElement>(".b3-list-item");
                    const itemEl = itemElement?.querySelector<HTMLElement>(".b3-menu__label");
                    if (!itemEl) {
                        return;
                    }
                    if (target.closest('[data-type="delete-font"]')) {
                        const id = itemElement.dataset.id;
                        confirmDialog(
                            window.siyuan.languages.deleteOpConfirm,
                            window.siyuan.languages.deleteFontConfirm.replace(
                                "${x}", `<b>${escapeHtml(itemEl.dataset.name)}</b>`),
                            () => {
                                fetchPost("/api/system/removeCustomFont", {id}, (response) => {
                                    unregisterCustomFont(id);
                                    invalidateCustomFonts();
                                    if (response.data.editor) {
                                        editorConfigApi.apply(response.data.editor);
                                        updateFontInput(response.data.editor);
                                    }
                                    fontMenu.close();
                                });
                            },
                            undefined,
                            true
                        );
                        return;
                    }
                    toggleEditorFont(fontItemFromElement(itemEl));
                });

                function toggleEditorFont(item: IFontItem) {
                    const selected = selectedFonts.some((font) => font.family === item.family && font.weight === item.weight);
                    const fonts = selected ? selectedFonts.filter((font) =>
                        font.family !== item.family || font.weight !== item.weight) :
                        [...selectedFonts.filter((font) => font.family !== item.family), item];
                    persistEditorFonts(fonts);
                }
            }
        });
        const rect = fontFamiliesElement.getBoundingClientRect();
        fontMenu.open({x: rect.left, y: rect.bottom, h: rect.height});
        // 内部列表自行滚动，搜索框保持固定
        fontMenu.element.querySelector(".b3-menu__items").setAttribute("style", "overflow: initial");
        fontMenu.element.querySelector<HTMLInputElement>('[data-type="font-search"]').focus();
    });

    function updateFontInput(data: Config.IEditor) {
        selectedFonts = getEditorFonts(data);
        fontFamiliesElement.style.removeProperty("font-family");
        fontFamiliesElement.style.removeProperty("font-weight");
        renderSelectedFonts();
    }
};

const fontItemFromElement = (item: HTMLElement): IFontItem => ({
    family: item.dataset.family,
    displayName: item.dataset.name,
    weight: parseInt(item.dataset.weight, 10) || 400,
});

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
            options: window.siyuan.config.appearance.lightThemes.filter((item) =>
                isThemeFrontendSupported(item.frontends, getFrontend())).map((item) => ({
                value: item.name,
                label: item.label,
            })),
        });
        stack.select("appearance.themeDark", {
            desc: window.siyuan.languages.theme12,
            options: window.siyuan.config.appearance.darkThemes.filter((item) =>
                isThemeFrontendSupported(item.frontends, getFrontend())).map((item) => ({
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

    /// #if MOBILE
    group.slot({
        key: "mobileBottomBar",
        keywords: [
            window.siyuan.languages.mobile,
            window.siyuan.languages.mobileBottomBar,
            window.siyuan.languages.reset,
        ],
        html: genMobileBottomBarSettingHTML,
        afterMount: mountMobileBottomBarSetting,
    });
    group.slot({
        key: "mobileSidePanel",
        keywords: [
            window.siyuan.languages.mobile,
            window.siyuan.languages.leftRightLayout,
            window.siyuan.languages.fileTree,
            window.siyuan.languages.outline,
            window.siyuan.languages.reset,
        ],
        html: genMobileSidePanelSettingHTML,
        afterMount: mountMobileSidePanelSetting,
    });
    /// #endif
    /// #if !MOBILE
    group.slot({
        key: "entryVisibility",
        keywords: [window.siyuan.languages.entryVisibility, window.siyuan.languages.entryVisibilityTip],
        html: genEntryVisibilityHtml,
        afterMount: mountEntryVisibility,
    });
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
    group.button({
        id: "notificationsSetting",
        title: window.siyuan.languages.notifications,
        desc: window.siyuan.languages.notificationsMsgPushTip,
        label: window.siyuan.languages.config,
        icon: "iconSettings",
        keywords: [
            window.siyuan.languages.msgDocTreeMaxList,
            window.siyuan.languages.msgTagMaxList,
            window.siyuan.languages.msgWorkspaceNotSSD,
            window.siyuan.languages.msgBrowserCompatibility,
            window.siyuan.languages.msgSelectAllTip,
            window.siyuan.languages.msgSelectAllIncompleteTip,
            window.siyuan.languages.msgFormatPainterTip,
        ],
        afterMount: mountAppearanceSetNotifications,
    });
    const desktopModeControl = controlBoolean("desktopMode", {
        readConfig: () => desktopModeCookie.read(),
    });
    const reloadDesktopMode = () => {
        if (isInMobileApp()) {
            void exitSiYuan();
            return;
        }
        window.location.replace("/");
    };
    // Electron 桌面端固定访问 /stage/build/app/，其他客户端可切换桌面和移动界面
    // https://github.com/siyuan-note/siyuan/issues/18559
    if (isBrowser()) {
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
                ...(isInMobileApp() ? [{
                    left: {kind: "desc", text: window.siyuan.languages.desktopModeRestartTip},
                } as const] : []),
            ]),
            controls: [{
                control: desktopModeControl,
                save: (value) => {
                    desktopModeCookie.set(value as boolean);
                    reloadDesktopMode();
                },
            }],
            afterMount: (root) => {
                root.querySelector("#resetDesktopMode")?.addEventListener("click", () => {
                    desktopModeCookie.remove();
                    reloadDesktopMode();
                });
            },
        });
    }
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

const STATUS_BAR_MSG_ITEMS: { key: keyof Config.IAppearanceStatusBar; getLabel: () => string }[] = [
    {
        key: "msgTaskDatabaseIndexCommitDisabled",
        getLabel: () => window.siyuan.languages._taskAction["task.database.index.commit"]
    },
    {
        key: "msgTaskAssetDatabaseIndexCommitDisabled",
        getLabel: () => window.siyuan.languages._taskAction["task.asset.database.index.commit"]
    },
    {
        key: "msgTaskHistoryDatabaseIndexCommitDisabled",
        getLabel: () => window.siyuan.languages._taskAction["task.history.database.index.commit"]
    },
    {
        key: "msgTaskHistoryGenerateFileDisabled",
        getLabel: () => window.siyuan.languages._taskAction["task.history.generateFile"]
    },
    {key: "msgDataSyncDisabled", getLabel: () => window.siyuan.languages.statusBarMsgDataSync},
];

const genStatusBarMsgDialogHtml = (): string => {
    const listItems = STATUS_BAR_MSG_ITEMS.map(({key, getLabel}) =>
        genListSwitchItemHtml(key, getLabel(), !window.siyuan.config.appearance.statusBar[key])
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
    }, {...window.siyuan.config.appearance.statusBar});

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

const NOTIFICATIONS_ITEMS: {
    field: keyof Config.IAppearanceNotifications;
    labelKey: "msgDocTreeMaxList" | "msgTagMaxList" | "msgWorkspaceNotSSD" | "msgBrowserCompatibility" |
        "msgSelectAllTip" | "msgSelectAllIncompleteTip" | "msgFormatPainterTip";
}[] = [
    {field: "docTreeMaxList", labelKey: "msgDocTreeMaxList"},
    {field: "tagMaxList", labelKey: "msgTagMaxList"},
    {field: "workspaceNotSSD", labelKey: "msgWorkspaceNotSSD"},
    {field: "browserCompatibility", labelKey: "msgBrowserCompatibility"},
    {field: "selectAllTip", labelKey: "msgSelectAllTip"},
    {field: "selectAllIncompleteTip", labelKey: "msgSelectAllIncompleteTip"},
    {field: "formatPainterTip", labelKey: "msgFormatPainterTip"},
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
        selectAllTip: (root.querySelector("#selectAllTip") as HTMLInputElement).checked,
        selectAllIncompleteTip: (root.querySelector("#selectAllIncompleteTip") as HTMLInputElement).checked,
        formatPainterTip: (root.querySelector("#formatPainterTip") as HTMLInputElement).checked,
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
        openLink(window.siyuan.ws.app, "https://ld246.com/tag/code-snippet");
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
