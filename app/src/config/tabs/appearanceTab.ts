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
import {getHostCapabilities} from "../../util/hostCapabilities";
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
import {setEditorFontSize} from "../../util/editorFontSize";
import {
    ICustomFont,
    invalidateCustomFonts,
    isNativeMobileContainer,
    loadCustomFonts,
    registerCustomFont,
    unregisterCustomFont
} from "../../util/customFont";
import {showMessage} from "../../dialog/message";
import {IFontItem, loadSystemFonts} from "../../util/systemFont";
import {
    shouldShowBootAppearanceSetting,
    type IBootAppearanceListItem,
    type IBootAppearanceSelection,
} from "./bootAppearanceState";
/// #if MOBILE
import {genMobileBottomBarSettingHTML, mountMobileBottomBarSetting} from "../../mobile/util/mobileBottomBar";
import {genMobileSidePanelSettingHTML, mountMobileSidePanelSetting} from "../../mobile/util/mobileSidePanelSetting";
/// #endif
/// #if !MOBILE
import {genEntryVisibilityHtml, mountEntryVisibility} from "../entryVisibility/ui";
/// #endif

interface IBootAppearanceListData {
    appearances: IBootAppearanceListItem[];
    current: IBootAppearanceSelection;
}

type FontFamiliesConfigKey = "fontFamilies" | "codeFontFamilies";

const getEditorFonts = (editor: Config.IEditor, configKey: FontFamiliesConfigKey): IFontItem[] =>
    editor[configKey] || [];

const getEditorFontDisplay = (fonts: IFontItem[]) =>
    fonts.map((font) => font.displayName || font.family).join(", ");

const isCodeFont = (font: Pick<IFontItem, "spacing">) =>
    font.spacing === "monospace" || font.spacing === "dual" || font.spacing === "character-cell";

const loadAvailableFonts = async () => {
    const nativeMobile = isNativeMobileContainer();
    const [systemFonts, customFonts] = await Promise.all([
        loadSystemFonts(),
        nativeMobile ? loadCustomFonts() : Promise.resolve([] as ICustomFont[])
    ]);
    return {
        nativeMobile,
        customFonts,
        fontItems: [...customFonts, ...systemFonts],
    };
};

const genFontConfigHtml = (configKey: FontFamiliesConfigKey, title: string, description: string) => {
    const fonts = getEditorFonts(window.siyuan.config.editor, configKey);
    return `<div class="fn__flex b3-label config-item" data-font-config-key="${configKey}">
    <div class="fn__flex-1 config-item__main">
        <div class="config-name">${title}</div>
        <div class="b3-label__text">${description}</div>
        <div class="fn__hr--small"></div>
        <div class="b3-chips b3-chips__doctag${fonts.length === 0 ? " fn__none" : ""}" data-type="selected-fonts">${genSelectedFontListHtml(fonts)}</div>
    </div>
    <span class="fn__space"></span>
    <input
        class="b3-select fn__flex-center fn__size200"
        id="editor.${configKey}"
        value="${escapeAttr(getEditorFontDisplay(fonts) || window.siyuan.languages.default)}"
        readonly
    >
</div>`;
};

const registerAppearanceContentGroup = (tab: SettingTabBuilder) => {
    const group = tab.group("content", window.siyuan.languages.configGroupContent);

    if (getHostCapabilities().customAppearance) {
        group.slot({
            key: "fontFamilies",
            keywords: [window.siyuan.languages.font, window.siyuan.languages.font1],
            html: () => genFontConfigHtml("fontFamilies", window.siyuan.languages.font, window.siyuan.languages.font1),
            afterMount: (root) => mountAppearanceFontFamily(root, "fontFamilies"),
        });
        group.slot({
            key: "codeFontFamilies",
            keywords: [window.siyuan.languages.monospaceFont, window.siyuan.languages.monospaceFontTip],
            html: () => genFontConfigHtml("codeFontFamilies", window.siyuan.languages.monospaceFont,
                window.siyuan.languages.monospaceFontTip),
            afterMount: (root) => mountAppearanceFontFamily(root, "codeFontFamilies"),
        });
    }
    group.range("editor.fontSize", {
        title: window.siyuan.languages.editorFontSize,
        desc: window.siyuan.languages.fontSizeTip,
        min: Constants.EDITOR_FONT_SIZE_MIN,
        max: Constants.EDITOR_FONT_SIZE_MAX,
        step: 1,
        save: (value) => {
            setEditorFontSize(value as number);
        },
    });
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
    <span class="b3-menu__label" data-family="${escapeAttr(item.family)}" data-name="${escapeAttr(item.displayName)}" data-search="${escapeAttr(searchText)}" data-spacing="${escapeAttr(item.spacing || "")}" data-weight="${item.weight || 400}">${escapeHtml(item.displayName)}</span>
    ${checked ? '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>' : ""}
    ${item.id && !window.siyuan.config.readonly ? `<span class="b3-menu__action ariaLabel" data-type="delete-font" aria-label="${escapeAttr(window.siyuan.languages.delete)}"><svg><use xlink:href="#iconTrashcan"></use></svg></span>` : ""}
</div>`;
};

const genSelectedFontListHtml = (fonts: IFontItem[]) => fonts.map((font, index) => `<div class="b3-chip b3-chip--middle config-font-family__chip fn__grab" data-index="${index}" data-family="${escapeAttr(font.family)}" data-weight="${font.weight || 400}">
    <span class="fn__ellipsis config-font-family__text">${escapeHtml(font.displayName || font.family)}</span>
    <svg class="b3-chip__close ariaLabel" data-type="font-remove" aria-label="${escapeAttr(window.siyuan.languages.remove)}"><use xlink:href="#iconClose"></use></svg>
</div>`).join("");

const bindSelectedFontList = (element: HTMLElement, getFonts: () => IFontItem[],
                              persist: (fonts: IFontItem[]) => void,
                              openWeightMenu: (chip: HTMLElement, index: number, event: MouseEvent) => void) => {
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
    element.addEventListener("contextmenu", (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-type="font-remove"]')) {
            return;
        }
        const chipElement = target.closest<HTMLElement>(".b3-chip");
        const index = parseInt(chipElement?.dataset.index, 10);
        if (!chipElement || !element.contains(chipElement) || !Number.isInteger(index)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        openWeightMenu(chipElement, index, event);
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

const mountedFontConfigUpdaters = new WeakMap<HTMLElement, (editor: Config.IEditor) => void>();

const mountAppearanceFontFamily = (root: HTMLElement, configKey: FontFamiliesConfigKey) => {
    const fontConfigElement = root.querySelector<HTMLElement>(`[data-font-config-key="${configKey}"]`);
    const fontFamiliesElement = fontConfigElement?.querySelector<HTMLInputElement>(
        `#${CSS.escape(`editor.${configKey}`)}`);
    const selectedListElement = fontConfigElement?.querySelector<HTMLElement>('[data-type="selected-fonts"]');
    if (!fontConfigElement || !fontFamiliesElement || !selectedListElement) {
        return;
    }
    let selectedFonts = getEditorFonts(window.siyuan.config.editor, configKey);
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
                [configKey]: fonts.map((font) => ({
                    family: font.family,
                    weight: font.weight,
                    displayName: font.displayName,
                })),
            },
            (response) => {
                const data = response.data as Config.IEditor;
                selectedFonts = getEditorFonts(data, configKey);
                editorConfigApi.apply(data);
                renderSelectedFonts();
                refreshMountedFontConfigs(data, fontConfigElement);
                refreshOpenMenu?.();
            }
        );
    };
    bindSelectedFontList(selectedListElement, () => selectedFonts, persistEditorFonts, (chip, index, event) => {
        openFontWeightMenu(chip, index, event);
    });
    mountedFontConfigUpdaters.set(fontConfigElement, updateFontInput);
    updateFontInput(window.siyuan.config.editor);
    fontFamiliesElement.addEventListener("click", async () => {
        let availableFonts: Awaited<ReturnType<typeof loadAvailableFonts>>;
        try {
            availableFonts = await loadAvailableFonts();
        } catch (error) {
            console.warn("load font list failed", error);
            return;
        }
        const {nativeMobile, customFonts, fontItems} = availableFonts;
        selectedFonts = getEditorFonts(window.siyuan.config.editor, configKey).map((selectedFont) =>
            fontItems.find((font) => font.family === selectedFont.family && font.weight === selectedFont.weight) ||
            selectedFont);
        renderSelectedFonts();
        const fontItemHtml = fontItems.map((item) =>
            genFontListItemHtml(item, selectedFonts.some((font) =>
                font.family === item.family && font.weight === item.weight))
        ).join("");
        const canManageCustomFonts = nativeMobile && !window.siyuan.config.readonly;
        const canShowAllFonts = configKey === "codeFontFamilies" && fontItems.some((font) => !isCodeFont(font));
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
        ${canShowAllFonts ? `<span class="fn__space"></span><button class="b3-button b3-button--outline fn__flex-center" data-type="show-all-fonts">${escapeHtml(window.siyuan.languages.showAll)}</button>` : ""}
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
                let showAllFonts = configKey !== "codeFontFamilies";
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
                refreshOpenMenu = () => {
                    refreshFontMenu();
                    filterFontList();
                };
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
                function filterFontList() {
                    const value = inputElement.value.toLowerCase().trim();
                    listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                    listElement.querySelectorAll<HTMLElement>(".b3-list-item .b3-menu__label").forEach((item) => {
                        const name = item.dataset.name;
                        const selected = selectedFonts.some((font) =>
                            font.family === item.dataset.family && font.weight === parseInt(item.dataset.weight, 10));
                        const codeFontVisible = showAllFonts || selected || isCodeFont({spacing: item.dataset.spacing});
                        const searchVisible = !value || item.dataset.search.includes(value);
                        item.parentElement.classList.toggle("fn__none", !(codeFontVisible && searchVisible));
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
                }
                filterFontList();
                element.querySelector<HTMLElement>('[data-type="show-all-fonts"]')?.addEventListener("click", (event) => {
                    showAllFonts = true;
                    (event.currentTarget as HTMLElement).remove();
                    filterFontList();
                    inputElement.focus();
                });
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
                                        refreshMountedFontConfigs(response.data.editor, fontConfigElement);
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

    async function openFontWeightMenu(chipElement: HTMLElement, index: number, event: MouseEvent) {
        const selectedFont = selectedFonts[index];
        if (!selectedFont || selectedFont.family !== chipElement.dataset.family) {
            return;
        }
        let availableFonts: Awaited<ReturnType<typeof loadAvailableFonts>>;
        try {
            availableFonts = await loadAvailableFonts();
        } catch (error) {
            console.warn("load font list failed", error);
            return;
        }
        const variantsByWeight = new Map<number, IFontItem>();
        availableFonts.fontItems.forEach((font) => {
            if (font.family === selectedFont.family) {
                variantsByWeight.set(font.weight || 400, font);
            }
        });
        if (!variantsByWeight.has(selectedFont.weight || 400)) {
            variantsByWeight.set(selectedFont.weight || 400, selectedFont);
        }
        const variants = Array.from(variantsByWeight.values()).sort((fontA, fontB) =>
            (fontA.weight || 400) - (fontB.weight || 400));
        if (variants.length < 2) {
            return;
        }

        const customFontsByID = new Map(availableFonts.customFonts.map((font) => [font.id, font]));
        const weightMenu = new Menu();
        variants.forEach((font) => {
            weightMenu.addItem({
                iconHTML: "",
                label: escapeHtml(font.displayName || font.family),
                checked: (font.weight || 400) === (selectedFont.weight || 400),
                bind(element) {
                    const labelElement = element.querySelector<HTMLElement>(".b3-menu__label");
                    const customFont = font.id ? customFontsByID.get(font.id) : undefined;
                    if (customFont) {
                        registerCustomFont(customFont);
                    }
                    if (labelElement) {
                        labelElement.style.fontFamily = font.family;
                        labelElement.style.fontWeight = String(font.weight || 400);
                    }
                },
                click() {
                    const currentFont = selectedFonts[index];
                    if (!currentFont || currentFont.family !== selectedFont.family ||
                        currentFont.weight === font.weight) {
                        return;
                    }
                    const fonts = [...selectedFonts];
                    fonts[index] = font;
                    persistEditorFonts(fonts);
                }
            });
        });
        weightMenu.open({x: event.clientX, y: event.clientY, target: chipElement});
    }

    function updateFontInput(data: Config.IEditor) {
        selectedFonts = getEditorFonts(data, configKey);
        fontFamiliesElement.style.removeProperty("font-family");
        fontFamiliesElement.style.removeProperty("font-weight");
        renderSelectedFonts();
    }
};

const refreshMountedFontConfigs = (editor: Config.IEditor, currentElement?: HTMLElement) => {
    document.querySelectorAll<HTMLElement>("[data-font-config-key]").forEach((fontConfigElement) => {
        if (fontConfigElement === currentElement) {
            return;
        }
        const updateMountedFontConfig = mountedFontConfigUpdaters.get(fontConfigElement);
        if (updateMountedFontConfig) {
            updateMountedFontConfig(editor);
            return;
        }
        const configKey = fontConfigElement.dataset.fontConfigKey as FontFamiliesConfigKey;
        const fonts = getEditorFonts(editor, configKey);
        const selectedListElement = fontConfigElement.querySelector<HTMLElement>('[data-type="selected-fonts"]');
        const fontFamiliesElement = fontConfigElement.querySelector<HTMLInputElement>(
            `#${CSS.escape(`editor.${configKey}`)}`);
        if (!selectedListElement || !fontFamiliesElement) {
            return;
        }
        selectedListElement.innerHTML = genSelectedFontListHtml(fonts);
        selectedListElement.classList.toggle("fn__none", fonts.length === 0);
        selectedListElement.querySelectorAll<HTMLElement>(".b3-chip").forEach((chip) => {
            const textElement = chip.querySelector<HTMLElement>(".config-font-family__text");
            if (textElement) {
                textElement.style.fontFamily = CSS.escape(chip.dataset.family);
                textElement.style.fontWeight = chip.dataset.weight;
            }
        });
        fontFamiliesElement.value = getEditorFontDisplay(fonts) || window.siyuan.languages.default;
    });
};

const fontItemFromElement = (item: HTMLElement): IFontItem => ({
    family: item.dataset.family,
    displayName: item.dataset.name,
    weight: parseInt(item.dataset.weight, 10) || 400,
    spacing: item.dataset.spacing,
});

const genBootAppearanceHtml = () => `<label class="fn__flex b3-label config-item fn__none">
    <div class="fn__flex-1 config-item__main">
        <div class="config-name">${escapeHtml(window.siyuan.languages.bootAppearance)}</div>
        <div class="b3-label__text">${escapeHtml(window.siyuan.languages.bootAppearanceTip)}</div>
    </div>
    <span class="fn__space"></span>
    <select class="b3-select fn__flex-center fn__size200" id="bootAppearance" disabled>
        <option value="">${escapeHtml(window.siyuan.languages.default)}</option>
    </select>
</label>`;

const mountBootAppearance = async (root: HTMLElement) => {
    const selectElement = root.querySelector<HTMLSelectElement>("#bootAppearance");
    if (!selectElement) {
        return;
    }
    const itemElement = selectElement.closest<HTMLElement>(".config-item");
    let response: IWebSocketData;
    try {
        response = await fetchSyncPost("/api/setting/getBootAppearances");
    } catch (error) {
        console.warn("get boot appearances failed", error);
        itemElement?.classList.remove("fn__none");
        return;
    }
    const data = response.data as IBootAppearanceListData;
    if (response.code !== 0 || !data || !Array.isArray(data.appearances)) {
        itemElement?.classList.remove("fn__none");
        return;
    }

    const frontend = getFrontend() === "mobile" ? "mobile" : "desktop";
    const configuredValue = data.current?.provider && data.current?.appearance
        ? JSON.stringify([data.current.provider, data.current.appearance])
        : "";
    if (!shouldShowBootAppearanceSetting(data.appearances, data.current, frontend)) {
        return;
    }

    selectElement.replaceChildren(new Option(window.siyuan.languages.default, ""));
    const providerGroups = new Map<string, HTMLOptGroupElement>();
    data.appearances.forEach((item) => {
        const value = JSON.stringify([item.provider, item.appearance]);
        const compatible = item.frontends?.includes(frontend);
        if (!compatible && value !== configuredValue) {
            return;
        }
        let groupElement = providerGroups.get(item.provider);
        if (!groupElement) {
            groupElement = document.createElement("optgroup");
            groupElement.label = item.provider;
            providerGroups.set(item.provider, groupElement);
            selectElement.append(groupElement);
        }
        const optionElement = new Option(item.displayName, value);
        optionElement.disabled = !compatible;
        groupElement.append(optionElement);
    });
    selectElement.value = Array.from(selectElement.options).some((option) => option.value === configuredValue)
        ? configuredValue
        : "";
    let savedValue = selectElement.value;
    selectElement.disabled = window.siyuan.config.readonly;
    itemElement?.classList.remove("fn__none");
    selectElement.addEventListener("change", async () => {
        const nextValue = selectElement.value;
        const [provider, appearance] = nextValue ? JSON.parse(nextValue) as [string, string] : ["", ""];
        selectElement.disabled = true;
        try {
            const setResponse = await fetchSyncPost("/api/setting/setBootAppearance", {provider, appearance});
            if (setResponse.code === 0) {
                savedValue = nextValue;
            } else {
                selectElement.value = savedValue;
            }
        } catch (error) {
            console.warn("set boot appearance failed", error);
            selectElement.value = savedValue;
        } finally {
            selectElement.disabled = window.siyuan.config.readonly;
        }
    });
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
    /// #if !BROWSER
    group.slot({
        key: "bootAppearance",
        keywords: [window.siyuan.languages.bootAppearance, window.siyuan.languages.bootAppearanceTip],
        html: genBootAppearanceHtml,
        afterMount: mountBootAppearance,
    });
    /// #endif
    if (getHostCapabilities().customAppearance) {
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
    }
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
    /// #if !BROWSER
    group.select("appearance.closeButtonBehavior", {
        title: window.siyuan.languages.appearance10,
        desc: window.siyuan.languages.appearance12,
        options: [
            {value: 0, label: window.siyuan.languages._trayMenu.quit},
            {value: 1, label: window.siyuan.languages.appearance11},
        ],
    });
    /// #endif
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
    if (!getHostCapabilities().customAppearance) {
        return;
    }
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
