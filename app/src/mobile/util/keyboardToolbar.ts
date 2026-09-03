import {listIndent, listOutdent} from "../../protyle/wysiwyg/list";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
} from "../../protyle/util/hasClosest";
import {moveToDown, moveToUp} from "../../protyle/wysiwyg/move";
import {Constants} from "../../constants";
import {focusBlock, focusByRange, getSelectionPosition} from "../../protyle/util/selection";
import {getCurrentEditor} from "../editor";
import {convertFontSize, fontEvent, getFontNodeElements, getFontSizeInfo} from "../../protyle/toolbar/Font";
import {hideElements} from "../../protyle/ui/hideElements";
import {softEnter} from "../../protyle/wysiwyg/enter";
import {endTrackedRangeInsertion, prepareTrackedRangeInsertion} from "../../protyle/util/trackedRange";
import {
    isDisabledFeature,
    isInAndroid,
    isInEdge,
    isInHarmony,
    isInMobileApp,
} from "../../protyle/util/compatibility";
import {tabCodeBlock} from "../../protyle/wysiwyg/codeBlock";
import {armKeyboardLock, callMobileAppShowKeyboard, canInput, keyboardLockUntil} from "./mobileAppUtil";
import {isNotEditBlock} from "../../protyle/wysiwyg/getBlock";
import {getMirror, getUndoRootID, hasUndoStateMirror, initMirror} from "../../protyle/undo/globalUndo";
import {getMobilePluginToolbarItems} from "./pluginToolbar";
import {escapeHtml} from "../../util/escape";
import {
    encodeStyle1,
    filterHiddenRecentInlineStyles,
    getBuiltinInlineStyleIDFromValue,
    getBuiltinInlineStylePreview,
    getBuiltinInlineStylePropertyValue,
    getInlineStyleByID,
    getInlineStyleByValue,
    getInlineStyleIDFromValue,
    getInlineStylePreview,
    getInlineStylesCache,
    getVisibleOrderedStyleKeys,
    isBuiltinInlineStyleVisible,
    isBuiltinOrderKey,
    TBuiltinInlineStyleID,
    TInlineStyleType,
} from "../../protyle/toolbar/inlineStyle";
import {openInlineStyleDialog} from "../../protyle/toolbar/inlineStyleDialog";
import {forEachPluginSubscriber} from "../../plugin/EventBusCore";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {
    getKeyboardHideResult,
    getMovingSelectionEndpoint,
    hasFixedSelectionEndpointChanged,
    hasVisibleSelectionText,
    isTableCellSelectAll,
    KeyboardHideResult,
    shouldHideKeyboardAfterResize,
    shouldPreserveTableCellSelectAll,
    type TSelectionEndpoint,
} from "./touchSelection";
import {getVisibleViewportBounds} from "./visibleViewport";
import {
    getTextWithoutSemanticMarkers,
    stripSemanticMarkersFromRangeText
} from "../../protyle/util/inlineElementMarker";
import {
    getInlineFontFamilyLabel,
    getInlineFontFamilyState,
    getInlineFontFamilyValue,
    renderMobileFontFamilyMenu,
} from "../../protyle/toolbar/fontFamilyMenu";

type TAndroidBoundedSelection = {
    container: HTMLElement,
    anchorNode: Node,
    anchorOffset: number,
    focusNode: Node,
    focusOffset: number,
};

type TAndroidTableCellSelectAll = {
    cell: HTMLTableCellElement,
    editableElement: HTMLElement,
    expiresAt: number,
    range: Range,
};

const ANDROID_TABLE_CELL_SELECT_ALL_TIMEOUT = 2000;

let renderKeyboardToolbarTimeout: number;
let scrollSelectionIntoViewTimeout: number;
let clearRenderGutterAfterScroll: () => void;
let showUtil = false;
let preventRender = false;
let preventRenderTimeout: number;
let restoringAndroidBoundedSelection = false;
let lastAndroidBoundedSelection: TAndroidBoundedSelection | undefined;
let androidMovingSelectionEndpoint: TSelectionEndpoint | undefined;
let pendingAndroidTableCellSelectAll: TAndroidTableCellSelectAll | undefined;
let restoringAndroidTableCellSelectAll = false;

export const updateMobilePluginToolbar = (protyle: IProtyle) => {
    const currentProtyle = getCurrentEditor()?.protyle;
    if (currentProtyle && currentProtyle !== protyle) {
        return;
    }
    const inlineToolbarElement = document.querySelector<HTMLElement>(
        '#keyboardToolbar .keyboard__action[data-type="inline-memo"]')?.parentElement;
    if (!inlineToolbarElement) {
        return;
    }
    inlineToolbarElement.querySelectorAll('[data-plugin-toolbar="true"]').forEach(item => item.remove());
    getMobilePluginToolbarItems(protyle.options.toolbar, Constants.INLINE_TYPE).forEach(toolbarItem => {
        const itemElement = document.createElement("button");
        itemElement.className = "keyboard__action";
        itemElement.dataset.type = toolbarItem.name;
        itemElement.dataset.pluginToolbar = "true";
        itemElement.innerHTML = `<svg><use xlink:href="#${toolbarItem.icon}"></use></svg>`;
        const label = toolbarItem.tip || (toolbarItem.lang ? window.siyuan.languages[toolbarItem.lang] : "");
        if (label) {
            itemElement.setAttribute("aria-label", label);
        }
        inlineToolbarElement.append(itemElement);
    });
};

const clearAndroidBoundedSelection = () => {
    lastAndroidBoundedSelection = undefined;
    androidMovingSelectionEndpoint = undefined;
};

export const resetAndroidBoundedSelectionGesture = () => {
    androidMovingSelectionEndpoint = undefined;
};

const rememberAndroidTableCellSelectAll = () => {
    if (!isInAndroid() || restoringAndroidTableCellSelectAll) {
        return;
    }
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
    }
    const range = selection.getRangeAt(0);
    const startCell = (hasClosestByTag(range.startContainer, "TD") ||
        hasClosestByTag(range.startContainer, "TH")) as HTMLTableCellElement;
    const endCell = (hasClosestByTag(range.endContainer, "TD") ||
        hasClosestByTag(range.endContainer, "TH")) as HTMLTableCellElement;
    if (!startCell || startCell !== endCell || !isTableCellSelectAll(
        stripSemanticMarkersFromRangeText(range), getTextWithoutSemanticMarkers(startCell))) {
        if (pendingAndroidTableCellSelectAll && startCell && startCell !== pendingAndroidTableCellSelectAll.cell) {
            pendingAndroidTableCellSelectAll = undefined;
        }
        return;
    }
    const editor = getCurrentEditor();
    const editableElement = (canInput(document.activeElement) ||
        hasClosestByAttribute(range.startContainer, "contenteditable", "true", true)) as HTMLElement;
    if (!editor || !editableElement || !editor.protyle.wysiwyg.element.contains(startCell) ||
        !(editableElement === startCell || editableElement.contains(startCell) || startCell.contains(editableElement))) {
        return;
    }
    pendingAndroidTableCellSelectAll = {
        cell: startCell,
        editableElement,
        expiresAt: Date.now() + ANDROID_TABLE_CELL_SELECT_ALL_TIMEOUT,
        range: range.cloneRange(),
    };
};

const hasRecentAndroidTableCellSelectAll = (pendingSelection = pendingAndroidTableCellSelectAll) =>
    !!pendingSelection && shouldPreserveTableCellSelectAll(pendingSelection.expiresAt, Date.now()) &&
    pendingSelection.cell.isConnected && pendingSelection.editableElement.isConnected &&
    pendingSelection.range.startContainer.isConnected && pendingSelection.range.endContainer.isConnected;

const restoreRecentAndroidTableCellSelectAll = () => {
    const pendingSelection = pendingAndroidTableCellSelectAll;
    pendingAndroidTableCellSelectAll = undefined;
    if (!pendingSelection || !hasRecentAndroidTableCellSelectAll(pendingSelection)) {
        return false;
    }
    restoringAndroidTableCellSelectAll = true;
    try {
        armKeyboardLock();
        pendingSelection.editableElement.focus({preventScroll: true});
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(pendingSelection.range);
    } finally {
        window.setTimeout(() => {
            restoringAndroidTableCellSelectAll = false;
        });
    }
    return true;
};

const getAndroidBoundedSelection = (selection: Selection, container: HTMLElement): TAndroidBoundedSelection => ({
    container,
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
});

const hasSelectionPointChanged = (node: Node, offset: number, previousNode: Node, previousOffset: number) =>
    node !== previousNode || offset !== previousOffset;

const restoreAndroidBoundedSelection = (selection: Selection, restored: TAndroidBoundedSelection) => {
    lastAndroidBoundedSelection = restored;
    restoringAndroidBoundedSelection = true;
    try {
        selection.setBaseAndExtent(
            restored.anchorNode,
            restored.anchorOffset,
            restored.focusNode,
            restored.focusOffset,
        );
    } finally {
        window.setTimeout(() => {
            restoringAndroidBoundedSelection = false;
        });
    }
    return true;
};

const getAndroidSelectionContainer = (selection: Selection) => {
    const previousContainer = lastAndroidBoundedSelection?.container;
    if (previousContainer?.classList.contains("agent-chat__body") &&
        (previousContainer.contains(selection.anchorNode) || previousContainer.contains(selection.focusNode))) {
        return previousContainer;
    }
    const anchorAgentBody = hasClosestByClassName(selection.anchorNode, "agent-chat__body", true);
    const focusAgentBody = hasClosestByClassName(selection.focusNode, "agent-chat__body", true);
    if (anchorAgentBody && anchorAgentBody === focusAgentBody) {
        return anchorAgentBody;
    }

    const protyle = getCurrentEditor()?.protyle;
    const previewVisible = protyle && !protyle.preview.element.classList.contains("fn__none");
    if (!protyle || (!protyle.disabled && !previewVisible)) {
        return;
    }
    return previewVisible ? protyle.preview.previewElement : protyle.wysiwyg.element;
};

const preserveAndroidBoundedSelection = () => {
    if (!isInAndroid() || restoringAndroidBoundedSelection) {
        return false;
    }
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed ||
        !selection.anchorNode || !selection.focusNode) {
        clearAndroidBoundedSelection();
        return false;
    }
    const container = getAndroidSelectionContainer(selection);
    if (!container) {
        clearAndroidBoundedSelection();
        return false;
    }
    const contains = (node: Node) => node === container || container.contains(node);
    const anchorInside = contains(selection.anchorNode);
    const focusInside = contains(selection.focusNode);
    const current = getAndroidBoundedSelection(selection, container);
    const previous = lastAndroidBoundedSelection;
    const previousAvailable = previous?.container === container &&
        previous.anchorNode.isConnected && previous.focusNode.isConnected &&
        contains(previous.anchorNode) && contains(previous.focusNode);
    if (container.classList.contains("agent-chat__body")) {
        if (!previousAvailable) {
            androidMovingSelectionEndpoint = undefined;
            if (anchorInside && focusInside) {
                lastAndroidBoundedSelection = current;
            } else {
                clearAndroidBoundedSelection();
            }
            return false;
        }
        const anchorChanged = hasSelectionPointChanged(
            current.anchorNode,
            current.anchorOffset,
            previous.anchorNode,
            previous.anchorOffset,
        );
        const focusChanged = hasSelectionPointChanged(
            current.focusNode,
            current.focusOffset,
            previous.focusNode,
            previous.focusOffset,
        );
        androidMovingSelectionEndpoint = getMovingSelectionEndpoint(
            androidMovingSelectionEndpoint,
            anchorChanged,
            focusChanged,
        );
        if (!androidMovingSelectionEndpoint) {
            if (anchorInside && focusInside) {
                lastAndroidBoundedSelection = current;
                return false;
            }
            return restoreAndroidBoundedSelection(selection, previous);
        }
        const movingAnchor = androidMovingSelectionEndpoint === "anchor";
        const movingEndpointInside = movingAnchor ? anchorInside : focusInside;
        if (!movingEndpointInside || hasFixedSelectionEndpointChanged(
            androidMovingSelectionEndpoint,
            anchorChanged,
            focusChanged,
        )) {
            return restoreAndroidBoundedSelection(selection, {
                container,
                anchorNode: movingAnchor && anchorInside ? current.anchorNode : previous.anchorNode,
                anchorOffset: movingAnchor && anchorInside ? current.anchorOffset : previous.anchorOffset,
                focusNode: !movingAnchor && focusInside ? current.focusNode : previous.focusNode,
                focusOffset: !movingAnchor && focusInside ? current.focusOffset : previous.focusOffset,
            });
        }
        lastAndroidBoundedSelection = current;
        return false;
    }
    androidMovingSelectionEndpoint = undefined;
    if (anchorInside && focusInside) {
        lastAndroidBoundedSelection = current;
        return false;
    }
    if (!previousAvailable || anchorInside === focusInside) {
        clearAndroidBoundedSelection();
        return false;
    }
    return restoreAndroidBoundedSelection(selection, {
        container,
        anchorNode: anchorInside ? current.anchorNode : previous.anchorNode,
        anchorOffset: anchorInside ? current.anchorOffset : previous.anchorOffset,
        focusNode: focusInside ? current.focusNode : previous.focusNode,
        focusOffset: focusInside ? current.focusOffset : previous.focusOffset,
    });
};

const preventKeyboardToolbarRender = () => {
    preventRender = true;
    clearTimeout(preventRenderTimeout);
    preventRenderTimeout = window.setTimeout(() => {
        preventRender = false;
    }, 1000);
};

const updateKeyboardToolbarPosition = () => {
    if (isInMobileApp() || !window.visualViewport) {
        return;
    }
    const toolbarElement = document.getElementById("keyboardToolbar");
    const viewportBottom = window.visualViewport.offsetTop + window.visualViewport.height;
    const toolbarHeight = toolbarElement.getBoundingClientRect().height || 48;
    toolbarElement.style.transform = "";
    toolbarElement.style.bottom = "auto";
    toolbarElement.style.top = `${viewportBottom - toolbarHeight}px`;
};

const getSlashItem = (value: string, icon: string, text: string, focus = "false") => {
    let iconHTML;
    if (icon && icon.startsWith("icon")) {
        iconHTML = `<svg class="keyboard__slash-icon"><use xlink:href="#${icon}"></use></svg>`;
    } else {
        iconHTML = icon;
    }
    return `<button class="keyboard__slash-item" data-focus="${focus}" data-value="${encodeURIComponent(value)}">
    ${iconHTML}
    <span class="keyboard__slash-text">${text}</span>
</button>`;
};

const getBuiltinStyleLabel = (id: TBuiltinInlineStyleID) => ({
    error: window.siyuan.languages.errorStyle,
    warning: window.siyuan.languages.warningStyle,
    info: window.siyuan.languages.infoStyle,
    success: window.siyuan.languages.successStyle,
})[id];

const getBuiltinStyleCSS = (id: TBuiltinInlineStyleID) =>
    `color: ${getBuiltinInlineStylePropertyValue(id, "color")};` +
    `background-color: ${getBuiltinInlineStylePropertyValue(id, "backgroundColor")};`;

export const renderTextMenu = (protyle: IProtyle, toolbarElement: Element) => {
    const renderOrderedItems = (type: TInlineStyleType) => {
        const data = getInlineStylesCache();
        return getVisibleOrderedStyleKeys(type, data).map(key => {
            if (isBuiltinOrderKey(type, key)) {
                if (type === "color") {
                    const index = Number(key);
                    return `<button class="keyboard__slash-item" data-type="color">
    <span class="keyboard__slash-icon" style="color:var(--b3-font-color${index})">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.colorFont} ${index}</span>
</button>`;
                }
                if (type === "backgroundColor") {
                    const index = Number(key);
                    return `<button class="keyboard__slash-item" data-type="backgroundColor">
    <span class="keyboard__slash-icon" style="background-color:var(--b3-font-background${index})">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.colorPrimary} ${index}</span>
</button>`;
                }
                const preview = getBuiltinInlineStylePreview(key as TBuiltinInlineStyleID);
                return `<button class="keyboard__slash-item" data-type="style1">
    <span class="keyboard__slash-icon" style="color:${preview.color};background-color:${preview.backgroundColor};">A</span>
    <span class="keyboard__slash-text">${getBuiltinStyleLabel(key as TBuiltinInlineStyleID)}</span>
</button>`;
            }
            const style = getInlineStyleByID(key, data);
            if (!style) {
                return "";
            }
            const preview = getInlineStylePreview(style);
            return `<button class="keyboard__slash-item" data-type="${type}" data-inline-style-id="${style.id}">
    <span class="keyboard__slash-icon" style="${preview.color ? `color:${preview.color};` : ""}${preview.backgroundColor ? `background-color:${preview.backgroundColor};` : ""}">A</span>
    <span class="keyboard__slash-text">${escapeHtml(style.name)}</span>
</button>`;
        }).join("");
    };
    let colorHTML = `<button class="keyboard__slash-item" data-type="color">
    <span class="keyboard__slash-icon">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.colorFont} ${window.siyuan.languages.default}</span>
</button>`;
    colorHTML += renderOrderedItems("color");
    let bgHTML = `<button class="keyboard__slash-item" data-type="backgroundColor">
    <span class="keyboard__slash-icon">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.colorPrimary} ${window.siyuan.languages.default}</span>
</button>`;
    bgHTML += renderOrderedItems("backgroundColor");
    const getManageHTML = (type: TInlineStyleType) => window.siyuan.config.readonly || window.siyuan.isPublish ? "" :
        `<button class="keyboard__slash-item" data-action="manageInlineStyle" data-inline-style-type="${type}">
    <svg class="keyboard__slash-icon"><use xlink:href="#iconSettings"></use></svg>
    <span class="keyboard__slash-text">${window.siyuan.languages.manageColors}</span>
</button>`;

    const nodeElements = getFontNodeElements(protyle);
    let disableFont = false;
    nodeElements?.find((item: HTMLElement) => {
        if (item.classList.contains("li")) {
            disableFont = true;
            return true;
        }
    });

    let lastColorHTML = "";
    const lastFonts = filterHiddenRecentInlineStyles(window.siyuan.storage[Constants.LOCAL_FONTSTYLES]);
    if (lastFonts.length > 0) {
        lastColorHTML = `<div data-id="lastUsed" class="keyboard__slash-title">
    ${window.siyuan.languages.lastUsed}
</div>
<div data-id="lastUsedWrap" class="keyboard__slash-block">`;
        lastFonts.forEach((item: string) => {
            const lastFontStatus = item.split(Constants.ZWSP);
            const inlineStyleID = getInlineStyleIDFromValue(item);
            const inlineStyle = getInlineStyleByValue(item);
            const customLabel = inlineStyle ? escapeHtml(inlineStyle.name) :
                (inlineStyleID ? window.siyuan.languages.custom : "");
            switch (lastFontStatus[0]) {
                case "color":
                    lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-icon" ${lastFontStatus[1] ? `style="color:${lastFontStatus[1]}"` : ""} >A</span>
    <span class="keyboard__slash-text">${customLabel || window.siyuan.languages.colorFont + " " + (lastFontStatus[1]?.match(/^var\(--b3-font-color(\d+)\)$/)?.[1] || window.siyuan.languages.default)}</span>
</button>`;
                    break;
                case "backgroundColor":
                    lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-icon" ${lastFontStatus[1] ? `style="background-color:${lastFontStatus[1]}"` : ""}>A</span>
    <span class="keyboard__slash-text">${customLabel || window.siyuan.languages.colorPrimary + " " + (lastFontStatus[1]?.match(/^var\(--b3-font-background(\d+)\)$/)?.[1] || window.siyuan.languages.default)}</span>
</button>`;
                    break;
                case "style2":
                    lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-text" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;">${window.siyuan.languages.hollow}</span>
</button>`;
                    break;
                case "style4":
                    lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-text" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)">${window.siyuan.languages.shadow}</span>
</button>`;
                    break;
                case "fontSize":
                    if (!disableFont) {
                        lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-text">${lastFontStatus[1]}</span>
</button>`;
                    }
                    break;
                case "style1":
                    if (lastFontStatus[1]) {
                        const builtInStyle = getBuiltinInlineStyleIDFromValue(item);
                        const preview = builtInStyle ? getBuiltinInlineStylePreview(builtInStyle) : {
                            backgroundColor: lastFontStatus[1],
                            color: lastFontStatus[2],
                        };
                        lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-icon" style="background-color:${preview.backgroundColor};color:${preview.color}">A</span>
    <span class="keyboard__slash-text">${customLabel || (builtInStyle ? getBuiltinStyleLabel(builtInStyle) : window.siyuan.languages.color)}</span>
</button>`;
                    } else {
                        lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-icon">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.color} ${window.siyuan.languages.default}</span>
</button>`;
                    }
                    break;
                case "clear":
                    lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-text">${window.siyuan.languages.clearFontStyle}</span>
</button>`;
                    break;
            }
        });
        lastColorHTML += "</div>";
    }
    const {fontSize, baseFontSize} = getFontSizeInfo(protyle, nodeElements);
    const fontFamilyState = getInlineFontFamilyState(protyle, nodeElements);
    const disableFontFamily = disableFont || fontFamilyState.disabled;
    const utilElement = toolbarElement.querySelector(".keyboard__util") as HTMLElement;
    utilElement.innerHTML = `${lastColorHTML}
<div data-id="color" class="keyboard__slash-title">${window.siyuan.languages.color}</div>
<div data-id="colorWrap" class="keyboard__slash-block">
    <button class="keyboard__slash-item" data-type="style1">
        <span class="keyboard__slash-icon">A</span>
        <span class="keyboard__slash-text">${window.siyuan.languages.color} ${window.siyuan.languages.default}</span>
    </button>
    ${renderOrderedItems("style1")}
    ${getManageHTML("style1")}
</div>
<div data-id="colorFont" class="keyboard__slash-title">${window.siyuan.languages.colorFont}</div>
<div data-id="colorFontWrap" class="keyboard__slash-block">
    ${colorHTML}
    ${getManageHTML("color")}
</div>
<div data-id="colorPrimary" class="keyboard__slash-title">${window.siyuan.languages.colorPrimary}</div>
<div data-id="colorPrimaryWrap" class="keyboard__slash-block">
    ${bgHTML}
    ${getManageHTML("backgroundColor")}
</div>
<div data-id="fontStyle" class="keyboard__slash-title">${window.siyuan.languages.fontStyle}</div>
<div data-id="fontStyleWrap" class="keyboard__slash-block">
    <button class="keyboard__slash-item" data-type="style2">
        <span class="keyboard__slash-text" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;">${window.siyuan.languages.hollow}</span>
    </button>
    <button class="keyboard__slash-item" data-type="style4">
        <span class="keyboard__slash-text" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)">${window.siyuan.languages.shadow}</span>
    </button>
    <button class="keyboard__slash-item" data-type="clear">
        <svg class="keyboard__slash-icon"><use xlink:href="#iconTrashcan"></use></svg>
        <span class="keyboard__slash-text">${window.siyuan.languages.clearFontStyle}</span>
    </button>
</div>
<div data-id="fontFamily" class="keyboard__slash-title${disableFontFamily ? " fn__none" : ""}">${window.siyuan.languages.fontFamily}</div>
<div data-id="fontFamilyWrap" class="keyboard__slash-block${disableFontFamily ? " fn__none" : ""}">
    <button class="keyboard__slash-item" data-action="fontFamilyMenu">
        <span class="keyboard__slash-icon" data-type="fontFamilyPreview">A</span>
        <span class="keyboard__slash-text">${escapeHtml(getInlineFontFamilyLabel(fontFamilyState))}</span>
    </button>
</div>
<div data-id="fontSize" class="keyboard__slash-title${disableFont ? " fn__none" : ""}">${window.siyuan.languages.fontSize}</div>
<div data-id="fontSizeWrap" class="keyboard__slash-block${disableFont ? " fn__none" : ""}">
    <label class="keyboard__font-size-toggle">
        ${window.siyuan.languages.relativeFontSize}
        <span class="fn__flex-1"></span>
        <input class="b3-switch fn__flex-center" ${fontSize.endsWith("em") ? "checked" : ""} type="checkbox">
    </label>
    <label class="keyboard__font-size${fontSize.endsWith("em") ? " fn__none" : ""}">
        <input class="b3-slider fn__flex-1" data-type="fontSizePX" max="72" min="9" step="1" type="range" value="${parseFloat(fontSize)}">
        <span data-type="fontSizeValue">${parseFloat(fontSize)}px</span>
    </label>
    <label class="keyboard__font-size${fontSize.endsWith("em") ? "" : " fn__none"}">
        <input class="b3-slider fn__flex-1" data-type="fontSizeEM" max="4.5" min="0.56" step="0.01" type="range" value="${parseFloat(fontSize)}">
        <span data-type="fontSizeValue">${(parseFloat(fontSize) * 100).toFixed(0)}%</span>
    </label>
</div>`;
    if (fontFamilyState.family) {
        (utilElement.querySelector('[data-type="fontFamilyPreview"]') as HTMLElement).style.fontFamily =
            getInlineFontFamilyValue(fontFamilyState.family);
    }
    const switchElement = utilElement.querySelector('[data-id="fontSizeWrap"] .b3-switch') as HTMLInputElement;
    const fontSizePXElement = utilElement.querySelector('[data-type="fontSizePX"]') as HTMLInputElement;
    const fontSizeEMElement = utilElement.querySelector('[data-type="fontSizeEM"]') as HTMLInputElement;
    const updatePXValue = () => {
        fontSizePXElement.nextElementSibling.textContent = fontSizePXElement.value + "px";
    };
    const updateEMValue = () => {
        fontSizeEMElement.nextElementSibling.textContent = (parseFloat(fontSizeEMElement.value) * 100).toFixed(0) + "%";
    };
    [switchElement, fontSizePXElement, fontSizeEMElement].forEach(item => {
        item.addEventListener("pointerdown", preventKeyboardToolbarRender);
    });
    switchElement.addEventListener("change", () => {
        preventKeyboardToolbarRender();
        if (switchElement.checked) {
            const em = convertFontSize(fontSizePXElement.value + "px", "em", baseFontSize);
            fontSizeEMElement.value = parseFloat(em).toString();
            updateEMValue();
            fontSizePXElement.parentElement.classList.add("fn__none");
            fontSizeEMElement.parentElement.classList.remove("fn__none");
            fontEvent(protyle, nodeElements, "fontSize", fontSizeEMElement.value + "em", false);
        } else {
            const px = convertFontSize(fontSizeEMElement.value + "em", "px", baseFontSize);
            fontSizePXElement.value = parseFloat(px).toString();
            updatePXValue();
            fontSizePXElement.parentElement.classList.remove("fn__none");
            fontSizeEMElement.parentElement.classList.add("fn__none");
            fontEvent(protyle, nodeElements, "fontSize", fontSizePXElement.value + "px", false);
        }
    });
    fontSizePXElement.addEventListener("input", updatePXValue);
    fontSizeEMElement.addEventListener("input", updateEMValue);
    fontSizePXElement.addEventListener("change", () => {
        preventKeyboardToolbarRender();
        fontEvent(protyle, nodeElements, "fontSize", fontSizePXElement.value + "px", false);
    });
    fontSizeEMElement.addEventListener("change", () => {
        preventKeyboardToolbarRender();
        fontEvent(protyle, nodeElements, "fontSize", fontSizeEMElement.value + "em", false);
    });
};

const renderSlashMenu = (protyle: IProtyle, toolbarElement: Element) => {
    protyle.hint.splitChar = "/";
    protyle.hint.lastIndex = -1;
    let pluginHTML = "";
    protyle.app.plugins.forEach((plugin) => {
        plugin.protyleSlash.forEach(slash => {
            pluginHTML += getSlashItem(`plugin${Constants.ZWSP}${plugin.name}${Constants.ZWSP}${slash.id}`,
                "", slash.html, "true");
        });
    });
    if (pluginHTML) {
        pluginHTML = `<div class="keyboard__slash-title"></div><div class="keyboard__slash-block">${pluginHTML}</div>`;
    }
    let builtinStyleHTML = "";
    (["info", "success", "warning", "error"] as TBuiltinInlineStyleID[]).forEach(id => {
        if (!isBuiltinInlineStyleVisible("style1", id)) {
            return;
        }
        const style = getBuiltinStyleCSS(id);
        builtinStyleHTML += getSlashItem(`style${Constants.ZWSP}${style}`,
            `<div style="${style}" class="keyboard__slash-icon">A</div>`, getBuiltinStyleLabel(id), "true");
    });
    const utilElement = toolbarElement.querySelector(".keyboard__util") as HTMLElement;
    utilElement.innerHTML = `<div class="keyboard__slash-title"></div>
<div class="keyboard__slash-block">
    ${getSlashItem(Constants.ZWSP, "iconMarkdown", window.siyuan.languages.template)}
    ${getHostCapabilities().widgets ? getSlashItem(Constants.ZWSP + 1, "iconBoth", window.siyuan.languages.widget) : ""}
    ${getSlashItem(Constants.ZWSP + 2, "iconImage", window.siyuan.languages.assets)}
    ${getSlashItem("((", "iconRef", window.siyuan.languages.ref, "true")}
    ${getSlashItem("{{", "iconSQL", window.siyuan.languages.blockEmbed, "true")}
    ${isDisabledFeature("ai") ? "" : getSlashItem(Constants.ZWSP + 5, "iconSparkles", window.siyuan.languages.aiWriting)}
    ${getSlashItem('<div data-type="NodeAttributeView" data-av-type="table"></div>', "iconDatabase", window.siyuan.languages.database, "true")}
    ${getSlashItem(Constants.ZWSP + 6, "iconFile", window.siyuan.languages.newSubDocRef)}
</div>
<div class="keyboard__slash-title"></div>
<div class="keyboard__slash-block">
    ${isInAndroid() ? getSlashItem(Constants.ZWSP + 3, "iconImage", window.siyuan.languages.insertImage + '<input class="b3-form__upload" type="file" multiple="multiple" accept="image/*,application/x-siyuan-image-picker"/>', "true") : ""}
    ${isInAndroid() ? getSlashItem(Constants.ZWSP + 3, "iconCamera", window.siyuan.languages.insertPhoto + '<input class="b3-form__upload" capture="user" type="file"' + (protyle.options.upload.accept ? (' multiple="' + protyle.options.upload.accept + '"') : "") + "/>", "true") : ""}
    ${getSlashItem(Constants.ZWSP + 3, "iconDownload", window.siyuan.languages.insertAsset + '<input class="b3-form__upload" type="file" multiple="multiple"' + (protyle.options.upload.accept ? (' accept="' + protyle.options.upload.accept + '"') : "") + "/>", "true")}
    ${getHostCapabilities().remoteKernel ? "" : getSlashItem('<iframe sandbox="allow-forms allow-presentation allow-same-origin allow-scripts allow-modals allow-popups allow-storage-access-by-user-activation" src="" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>', "iconGlobe", window.siyuan.languages.insertIframeURL, "true")}
    ${getSlashItem("![]()", "iconImage", window.siyuan.languages.insertImgURL, "true")}
    ${getSlashItem('<video controls="controls" src=""></video>', "iconVideo", window.siyuan.languages.insertVideoURL, "true")}
    ${getSlashItem('<audio controls="controls" src=""></audio>', "iconRecord", window.siyuan.languages.insertAudioURL, "true")}
    ${getSlashItem("emoji", "iconEmoji", window.siyuan.languages.emoji, "true")}
</div>
<div class="keyboard__slash-title"></div>
<div class="keyboard__slash-block">
    ${getSlashItem("# " + Lute.Caret, "iconH1", window.siyuan.languages.heading1, "true")}
    ${getSlashItem("## " + Lute.Caret, "iconH2", window.siyuan.languages.heading2, "true")}
    ${getSlashItem("### " + Lute.Caret, "iconH3", window.siyuan.languages.heading3, "true")}
    ${getSlashItem("#### " + Lute.Caret, "iconH4", window.siyuan.languages.heading4, "true")}
    ${getSlashItem("##### " + Lute.Caret, "iconH5", window.siyuan.languages.heading5, "true")}
    ${getSlashItem("###### " + Lute.Caret, "iconH6", window.siyuan.languages.heading6, "true")}
    ${getSlashItem("- " + Lute.Caret, "iconList", window.siyuan.languages.list, "true")}
    ${getSlashItem("1. " + Lute.Caret, "iconOrderedList", window.siyuan.languages["ordered-list"], "true")}
    ${getSlashItem("- [ ] " + Lute.Caret, "iconCheck", window.siyuan.languages.check, "true")}
    ${getSlashItem("> " + Lute.Caret, "iconQuote", window.siyuan.languages.quote, "true")}
    ${getSlashItem(`> [!NOTE]\n> ${Lute.Caret}`, '<span class="keyboard__slash-icon">✏️</span>', `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-note)">Note</span>`, "true")}
    ${getSlashItem(`> [!TIP]\n> ${Lute.Caret}`, '<span class="keyboard__slash-icon">💡</span>', `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-tip)">Tip</span>`, "true")}
    ${getSlashItem(`> [!IMPORTANT]\n> ${Lute.Caret}`, '<span class="keyboard__slash-icon">❗</span>', `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-important)">Important</span>`, "true")}
    ${getSlashItem(`> [!WARNING]\n> ${Lute.Caret}`, '<span class="keyboard__slash-icon">⚠️</span>', `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-warning)">Warning</span>`, "true")}
    ${getSlashItem(`> [!CAUTION]\n> ${Lute.Caret}`, '<span class="keyboard__slash-icon">🚨</span>', `${window.siyuan.languages.callout} - <span style="color: var(--b3-callout-caution)">Caution</span>`, "true")}
    ${getSlashItem("```", "iconCode", window.siyuan.languages.code, "true")}
    ${getSlashItem(`| ${Lute.Caret} |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`, "iconTable", window.siyuan.languages.table, "true")}
    ${getSlashItem("---", "iconLine", window.siyuan.languages.line, "true")}
    ${getSlashItem("$$", "iconMath", window.siyuan.languages.math)}
    ${getSlashItem("<div>", "iconHTML5", "HTML")}
</div>
<div class="keyboard__slash-title"></div>
<div class="keyboard__slash-block">
    ${getSlashItem("```abc\n```", "", window.siyuan.languages.staff, "true")}
    ${getSlashItem("```echarts\n```", "", window.siyuan.languages.chart, "true")}
    ${getSlashItem("```flowchart\n```", "", "Flow Chart", "true")}
    ${getSlashItem("```graphviz\n```", "", "Graph", "true")}
    ${getSlashItem("```mermaid\n```", "", "Mermaid", "true")}
    ${getSlashItem("```mindmap\n```", "", window.siyuan.languages.mindmap, "true")}
    ${getSlashItem("```plantuml\n```", "", "UML", "true")}
</div>
<div class="keyboard__slash-title"></div>
<div class="keyboard__slash-block">
    ${builtinStyleHTML}
    ${getSlashItem(`style${Constants.ZWSP}`, '<div class="keyboard__slash-icon">A</div>', window.siyuan.languages.clearFontStyle, "true")}
</div>${pluginHTML}`;
    protyle.hint.bindUploadEvent(protyle, utilElement);
};

export const showKeyboardToolbarUtil = (oldScrollTop: number) => {
    window.siyuan.menus.menu.remove();
    showUtil = true;
    const toolHeight = document.querySelector(".keyboard__bar").clientHeight;
    const toolbarElement = document.getElementById("keyboardToolbar");
    let keyboardHeight = window.innerHeight / 2 - toolHeight;
    if (window.siyuan.mobile.size.isLandscape) {
        if (window.siyuan.mobile.size.landscape.height1 !== window.siyuan.mobile.size.landscape.height2) {
            keyboardHeight = window.siyuan.mobile.size.landscape.height1 - window.siyuan.mobile.size.landscape.height2 + toolHeight;
        }
    } else {
        if (window.siyuan.mobile.size.portrait.height1 !== window.siyuan.mobile.size.portrait.height2) {
            keyboardHeight = window.siyuan.mobile.size.portrait.height1 - window.siyuan.mobile.size.portrait.height2 + toolHeight;
        }
    }
    const editor = getCurrentEditor();
    if (editor) {
        editor.protyle.element.parentElement.style.paddingBottom = keyboardHeight + "px";
        editor.protyle.contentElement.scrollTop = oldScrollTop;
    }
    setTimeout(() => {
        toolbarElement.style.height = keyboardHeight + "px";
        updateKeyboardToolbarPosition();
    }, Constants.TIMEOUT_TRANSITION); // 防止抖动
    setTimeout(() => {
        showUtil = false;
    }, 1000);   // 防止光标改变后斜杆菜单消失
};

const hideKeyboardToolbarUtil = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.style.height = "";
    updateKeyboardToolbarPosition();
    const editor = getCurrentEditor();
    if (editor) {
        editor.protyle.element.parentElement.style.paddingBottom = "48px";
    }
    toolbarElement.querySelector('.keyboard__action[data-type="add"]').classList.remove("protyle-toolbar__item--current");
    toolbarElement.querySelector('.keyboard__action[data-type="text"]').classList.remove("protyle-toolbar__item--current");
    toolbarElement.querySelector('.keyboard__action[data-type="done"] use').setAttribute("xlink:href", "#iconKeyboardHide");
};

const renderKeyboardToolbar = () => {
    clearTimeout(renderKeyboardToolbarTimeout);
    renderKeyboardToolbarTimeout = window.setTimeout(() => {
        if (!canInput(document.activeElement)) {
            hideKeyboardToolbar();
            return;
        }
        if (!showUtil) {
            hideKeyboardToolbarUtil();
        }
        showKeyboardToolbar();
        const dynamicElements = document.querySelectorAll("#keyboardToolbar .keyboard__dynamic");
        const range = getSelection().getRangeAt(0);
        const isProtyle = hasClosestByClassName(range.startContainer, "protyle-wysiwyg", true);
        const nodeElement = hasClosestBlock(range.startContainer);
        const endNodeElement = hasClosestBlock(range.endContainer);
        if (!isProtyle || !nodeElement ||
            hasClosestByAttribute(range.startContainer, "data-type", "av-search")) {
            dynamicElements[0].classList.add("fn__none");
            dynamicElements[1].classList.add("fn__none");
            return;
        }

        const selectText = stripSemanticMarkersFromRangeText(range).split(Constants.ZWSP).join("");
        const startCellElement = hasClosestByTag(range.startContainer, "TD") ||
            hasClosestByTag(range.startContainer, "TH");
        const endCellElement = hasClosestByTag(range.endContainer, "TD") ||
            hasClosestByTag(range.endContainer, "TH");
        const disableLink = (!!endNodeElement && nodeElement !== endNodeElement) ||
            (!!startCellElement && !!endCellElement && startCellElement !== endCellElement);
        dynamicElements[1].querySelector('[data-type="a"]').toggleAttribute("disabled", disableLink);
        dynamicElements[1].querySelector('[data-type="block-ref"]').toggleAttribute("disabled", disableLink);

        if (!nodeElement.classList.contains("code-block") &&
            (selectText || dynamicElements[0].querySelector('[data-type="goinline"]').classList.contains("protyle-toolbar__item--current"))) {
            dynamicElements[0].classList.add("fn__none");
            dynamicElements[1].classList.remove("fn__none");
        } else {
            dynamicElements[0].classList.remove("fn__none");
            dynamicElements[1].classList.add("fn__none");
        }

        const protyle = getCurrentEditor().protyle;
        protyle.toolbar.range = range;
        if (!dynamicElements[0].classList.contains("fn__none")) {
            // 撤销权威栈在 kernel，本地按 rootID 读镜像设按钮态，首次进入嵌入源文档时按需初始化。
            const undoRootID = getUndoRootID(protyle, range);
            if (undoRootID && !hasUndoStateMirror(undoRootID)) {
                initMirror(undoRootID).then((initialized) => {
                    if (initialized && getUndoRootID(protyle, protyle.toolbar.range) === undoRootID) {
                        renderKeyboardToolbar();
                    }
                });
            }
            const undoState = undoRootID ? getMirror(undoRootID) : {
                canUndo: false,
                canRedo: false
            };
            if (!undoState.canUndo) {
                dynamicElements[0].querySelector('[data-type="undo"]').setAttribute("disabled", "disabled");
            } else {
                dynamicElements[0].querySelector('[data-type="undo"]').removeAttribute("disabled");
            }
            if (!undoState.canRedo) {
                dynamicElements[0].querySelector('[data-type="redo"]').setAttribute("disabled", "disabled");
            } else {
                dynamicElements[0].querySelector('[data-type="redo"]').removeAttribute("disabled");
            }
            const outdentElement = dynamicElements[0].querySelector('[data-type="outdent"]');
            const goinlineElement = dynamicElements[0].querySelector('[data-type="goinline"]');
            if (nodeElement.classList.contains("code-block")) {
                goinlineElement.classList.add("fn__none");
            } else {
                goinlineElement.classList.remove("fn__none");
            }
            if (nodeElement.parentElement.classList.contains("li")) {
                outdentElement.classList.remove("fn__none");
                outdentElement.nextElementSibling.classList.remove("fn__none");
                if (nodeElement.parentElement.previousElementSibling) {
                    outdentElement.nextElementSibling.removeAttribute("disabled");
                } else {
                    outdentElement.nextElementSibling.setAttribute("disabled", "true");
                }
            } else if (nodeElement.classList.contains("code-block") && range.toString()) {
                outdentElement.classList.remove("fn__none");
                outdentElement.nextElementSibling.classList.remove("fn__none");
            } else {
                outdentElement.classList.add("fn__none");
                outdentElement.nextElementSibling.classList.add("fn__none");
            }
        }

        if (!dynamicElements[1].classList.contains("fn__none")) {
            dynamicElements[1].querySelectorAll(".protyle-toolbar__item--current").forEach(item => {
                item.classList.remove("protyle-toolbar__item--current");
            });
            const types = protyle.toolbar.getCurrentType(range);
            types.forEach(item => {
                if (["search-mark", "a", "block-ref", "virtual-block-ref", "text", "file-annotation-ref", "inline-math",
                    "inline-memo", "", "backslash"].includes(item)) {
                    return;
                }
                const itemElement = dynamicElements[1].querySelector(`[data-type="${item}"]`);
                if (itemElement) {
                    itemElement.classList.add("protyle-toolbar__item--current");
                }
            });
        }
    }, 620); // 需等待 range 更新
};

export const showKeyboardToolbar = () => {
    if (!showUtil) {
        hideKeyboardToolbarUtil();
    }
    const toolbarElement = document.getElementById("keyboardToolbar");
    const selection = getSelection();
    if (selection.rangeCount > 0 &&
        hasClosestByClassName(selection.getRangeAt(0).startContainer, "agent-chat__composer-host", true)) {
        // 智能体发送框自带操作栏，不能显示会作用于下层文档的移动端编辑工具栏。
        window.dispatchEvent(new CustomEvent("siyuan-mobile-keyboard-change", {detail: true}));
        toolbarElement.classList.add("fn__none");
        return;
    }
    if (!toolbarElement.classList.contains("fn__none")) {
        window.dispatchEvent(new CustomEvent("siyuan-mobile-keyboard-change", {detail: true}));
        return;
    }
    if (selection.rangeCount === 0) {
        return;
    }
    toolbarElement.classList.remove("fn__none");
    window.dispatchEvent(new CustomEvent("siyuan-mobile-keyboard-change", {detail: true}));
    toolbarElement.style.zIndex = (++window.siyuan.zIndex).toString();
    updateKeyboardToolbarPosition();
    const modelElement = document.getElementById("model");
    if (modelElement.style.transform === "translateX(0px)") {
        modelElement.style.paddingBottom = "48px";
    }
    const range = getSelection().getRangeAt(0);
    const editor = getCurrentEditor();
    if (editor) {
        if (editor.protyle.wysiwyg.element.contains(range.startContainer)) {
            editor.protyle.element.parentElement.style.paddingBottom = "48px";
        }
        forEachPluginSubscriber("mobile-keyboard-show", eventBus => {
            eventBus.emit("mobile-keyboard-show");
        });
    }
    clearTimeout(scrollSelectionIntoViewTimeout);
    clearRenderGutterAfterScroll?.();
    scrollSelectionIntoViewTimeout = window.setTimeout(() => {
        if (editor?.protyle.toolbar.isMultiSelectMode()) {
            return;
        }
        const contentElement = hasClosestByClassName(range.startContainer, "protyle-content", true);
        if (contentElement) {
            const renderGutter = () => {
                const blockElement = hasClosestBlock(range.startContainer);
                if (!editor?.protyle.gutter || !editor.protyle.options.render.gutter ||
                    !blockElement || !editor.protyle.wysiwyg.element.contains(blockElement)) {
                    return;
                }
                const targetElement = range.startContainer.nodeType === Node.ELEMENT_NODE ?
                    range.startContainer as Element : range.startContainer.parentElement;
                editor.protyle.gutter.render(editor.protyle, blockElement, targetElement);
            };
            let cursorTop = getSelectionPosition(contentElement).top;
            if (cursorTop < 0 && window.siyuan.mobile.touchRange) {
                const rangeBlockElement = hasClosestBlock(window.siyuan.mobile.touchRange.startContainer);
                if (rangeBlockElement) {
                    if (isNotEditBlock(rangeBlockElement)) {
                        focusBlock(rangeBlockElement);
                    } else {
                        focusByRange(window.siyuan.mobile.touchRange);
                    }
                    cursorTop = getSelectionPosition(contentElement, window.siyuan.mobile.touchRange).top;
                }
            }
            const viewportBounds = getVisibleViewportBounds();
            if (cursorTop < viewportBounds.bottom - 42 &&
                cursorTop > Math.max(contentElement.getBoundingClientRect().top, viewportBounds.top)) {
                renderGutter();
                return;
            }
            const clearRenderGutter = () => {
                contentElement.removeEventListener("scrollend", renderGutterAfterScroll);
                contentElement.removeEventListener("touchstart", clearRenderGutter);
                clearTimeout(renderGutterTimeout);
                clearRenderGutterAfterScroll = undefined;
            };
            const renderGutterAfterScroll = () => {
                clearRenderGutter();
                renderGutter();
            };
            const renderGutterTimeout = window.setTimeout(renderGutterAfterScroll, Constants.TIMEOUT_COUNT);
            clearRenderGutterAfterScroll = clearRenderGutter;
            contentElement.addEventListener("scrollend", renderGutterAfterScroll, {once: true});
            contentElement.addEventListener("touchstart", clearRenderGutter, {once: true, passive: true});
            contentElement.scroll({
                top: cursorTop < 0 ?
                    contentElement.scrollTop + viewportBounds.bottom - viewportBounds.top - 42 :
                    contentElement.scrollTop + cursorTop - viewportBounds.bottom + 42 + 26,
                left: contentElement.scrollLeft,
                behavior: "smooth"
            });
        }
    }, Constants.TIMEOUT_TRANSITION);
};

export const hideKeyboardToolbar = () => {
    clearTimeout(renderKeyboardToolbarTimeout);
    clearTimeout(scrollSelectionIntoViewTimeout);
    clearRenderGutterAfterScroll?.();
    if (showUtil) {
        return;
    }
    const toolbarElement = document.getElementById("keyboardToolbar");
    const toolbarHidden = toolbarElement.classList.contains("fn__none");
    toolbarElement.classList.add("fn__none");
    toolbarElement.style.height = "";
    const editor = getCurrentEditor();
    if (editor) {
        editor.protyle.element.parentElement.style.paddingBottom = "";
        if (!toolbarHidden) {
            forEachPluginSubscriber("mobile-keyboard-hide", eventBus => {
                eventBus.emit("mobile-keyboard-hide");
            });
        }
    }
    const modelElement = document.getElementById("model");
    if (modelElement.style.transform === "translateX(0px)") {
        modelElement.style.paddingBottom = "";
    }
    window.dispatchEvent(new CustomEvent("siyuan-mobile-keyboard-change", {detail: false}));
};

export const hideKeyboardToolbarByApp = (preserveSelection = false) => {
    const tableCellSelectionRestored = preserveSelection && restoreRecentAndroidTableCellSelectAll();
    if (tableCellSelectionRestored) {
        return KeyboardHideResult.RestoreTableCellSelection;
    }
    preventKeyboardToolbarRender();
    hideKeyboardToolbar();
    const editor = getCurrentEditor();
    const selection = getSelection();
    if (!editor) {
        return KeyboardHideResult.Cleanup;
    }
    hideElements(["util"], editor.protyle);
    const range = selection?.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : undefined;
    const hasVisibleEditorSelection = !!range && hasVisibleSelectionText(stripSemanticMarkersFromRangeText(range)) &&
        editor.protyle.wysiwyg.element.contains(range.startContainer) &&
        editor.protyle.wysiwyg.element.contains(range.endContainer);
    const result = getKeyboardHideResult(preserveSelection, tableCellSelectionRestored, hasVisibleEditorSelection);
    if (result === KeyboardHideResult.PreserveSelection || !hasVisibleEditorSelection) {
        return result;
    }
    (document.activeElement as HTMLElement)?.blur();
    selection?.removeAllRanges();
    return result;
};

export const activeBlur = (force = false) => {
    const now = Date.now();
    if (!force && now < keyboardLockUntil) {
        console.warn(`activeBlur blocked by lock (remaining: ${keyboardLockUntil - now}ms)`);
        return;
    }

    if (window.JSAndroid && window.JSAndroid.hideKeyboard) {
        window.JSAndroid.hideKeyboard();
    } else if (window.JSHarmony && window.JSHarmony.hideKeyboard) {
        window.JSHarmony.hideKeyboard();
    }
    hideKeyboardToolbar();
    (document.activeElement as HTMLElement).blur();
};

export const initKeyboardToolbar = () => {
    if (!isInMobileApp() && window.visualViewport) {
        let pendingUpdate = false;
        const viewportHandler = () => {
            if (pendingUpdate) {
                return;
            }
            pendingUpdate = true;
            requestAnimationFrame(() => {
                pendingUpdate = false;
                updateKeyboardToolbarPosition();
            });
        };
        window.visualViewport.addEventListener("resize", viewportHandler);
        window.visualViewport.addEventListener("scroll", viewportHandler);
        viewportHandler();
    }
    document.addEventListener("selectionchange", () => {
        rememberAndroidTableCellSelectAll();
        if (preserveAndroidBoundedSelection()) {
            return;
        }
        if (preventRender || (getCurrentEditor()?.protyle?.toolbar.isMultiSelectMode())) {
            return;
        }
        renderKeyboardToolbar();
    }, false);
    window.siyuan.mobile.size.isLandscape = window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
    if (window.siyuan.mobile.size.isLandscape) {
        window.siyuan.mobile.size.landscape = {
            height1: window.innerHeight,
            height2: window.innerHeight,
        };
    } else {
        window.siyuan.mobile.size.portrait = {
            height1: window.innerHeight,
            height2: window.innerHeight,
        };
    }
    if (!isInEdge()) {
        window.addEventListener("resize", () => {
            // 获取键盘高度
            window.siyuan.mobile.size.isLandscape = window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
            if (window.siyuan.mobile.size.isLandscape) {
                if (!window.siyuan.mobile.size.landscape) {
                    window.siyuan.mobile.size.landscape = {
                        height1: window.innerHeight,
                        height2: window.innerHeight,
                    };
                }
                if (window.innerHeight < window.siyuan.mobile.size.landscape.height1 - 100) {
                    window.siyuan.mobile.size.landscape.height2 = window.innerHeight;
                }
                if (window.innerHeight > window.siyuan.mobile.size.landscape.height1) {
                    window.siyuan.mobile.size.landscape.height1 = window.innerHeight;
                }
                if (window.siyuan.mobile.size.landscape.height2 < window.innerHeight) {
                    const isInputFocused = document.activeElement && (
                        ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) ||
                        (document.activeElement as HTMLElement).isContentEditable);
                    if (shouldHideKeyboardAfterResize(isInputFocused, hasRecentAndroidTableCellSelectAll())) {
                        activeBlur();
                    }
                } else if (!preventRender) {
                    renderKeyboardToolbar();
                }
            } else {
                if (!window.siyuan.mobile.size.portrait) {
                    window.siyuan.mobile.size.portrait = {
                        height1: window.innerHeight,
                        height2: window.innerHeight,
                    };
                }
                if (window.innerHeight < window.siyuan.mobile.size.portrait.height1 - 100) {
                    window.siyuan.mobile.size.portrait.height2 = window.innerHeight;
                }
                if (window.innerHeight > window.siyuan.mobile.size.portrait.height1) {
                    window.siyuan.mobile.size.portrait.height1 = window.innerHeight;
                }
                if (window.siyuan.mobile.size.portrait.height2 < window.innerHeight) {
                    const isInputFocused = document.activeElement && (
                        ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) ||
                        (document.activeElement as HTMLElement).isContentEditable);
                    if (shouldHideKeyboardAfterResize(isInputFocused, hasRecentAndroidTableCellSelectAll())) {
                        activeBlur();
                    }
                } else if (!preventRender) {
                    renderKeyboardToolbar();
                }
            }
        });
    }
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.innerHTML = `<div class="fn__flex keyboard__bar">
    <div class="fn__flex-1">
        <div class="fn__none keyboard__dynamic">
            <button class="keyboard__action" data-type="outdent"><svg><use xlink:href="#iconOutdent"></use></svg></button>
            <button class="keyboard__action" data-type="indent"><svg><use xlink:href="#iconIndent"></use></svg></button>
            <button class="keyboard__action" data-type="add"><svg><use xlink:href="#iconAdd"></use></svg></button>
            <button class="keyboard__action" data-type="block"><svg><use xlink:href="#iconParagraph"></use></svg></button>
            <button class="keyboard__action" data-type="goinline"><svg class="keyboard__svg--big"><use xlink:href="#iconBIU"></use></svg></button>
            <button class="keyboard__action" data-type="softLine"><svg><use xlink:href="#iconSoftWrap"></use></svg></button>
            <span class="keyboard__split"></span>
            <button class="keyboard__action" data-type="undo"><svg><use xlink:href="#iconUndo"></use></svg></button>
            <button class="keyboard__action" data-type="redo"><svg><use xlink:href="#iconRedo"></use></svg></button>
            <span class="keyboard__split"></span>
            <button class="keyboard__action" data-type="moveup"><svg><use xlink:href="#iconUp"></use></svg></button>
            <button class="keyboard__action" data-type="movedown"><svg><use xlink:href="#iconDown"></use></svg></button>
        </div>
        <div class="fn__none keyboard__dynamic">
            <button class="keyboard__action" data-type="goback"><svg><use xlink:href="#iconBack"></use></svg></button>
            <button class="keyboard__action" data-type="block-ref"><svg><use xlink:href="#iconRef"></use></svg></button>
            <button class="keyboard__action" data-type="a"><svg><use xlink:href="#iconLink"></use></svg></button>
            <button class="keyboard__action" data-type="text"><svg><use xlink:href="#iconFont"></use></svg></button>
            <button class="keyboard__action" data-type="strong"><svg><use xlink:href="#iconBold"></use></svg></button>
            <button class="keyboard__action" data-type="em"><svg><use xlink:href="#iconItalic"></use></svg></button>
            <button class="keyboard__action" data-type="u"><svg><use xlink:href="#iconUnderline"></use></svg></button>
            <button class="keyboard__action" data-type="s"><svg><use xlink:href="#iconStrike"></use></svg></button>
            <button class="keyboard__action" data-type="mark"><svg><use xlink:href="#iconMark"></use></svg></button>
            <button class="keyboard__action" data-type="sup"><svg><use xlink:href="#iconSup"></use></svg></button>
            <button class="keyboard__action" data-type="sub"><svg><use xlink:href="#iconSub"></use></svg></button>
            <button class="keyboard__action" data-type="clear"><svg><use xlink:href="#iconClear"></use></svg></button>
            <button class="keyboard__action" data-type="code"><svg><use xlink:href="#iconInlineCode"></use></svg></button>
            <button class="keyboard__action" data-type="kbd"<use xlink:href="#iconKeymap"></use></svg></button>
            <button class="keyboard__action" data-type="tag"><svg><use xlink:href="#iconTag"></use></svg></button>
            <button class="keyboard__action" data-type="inline-math"><svg><use xlink:href="#iconMath"></use></svg></button>
            <button class="keyboard__action" data-type="inline-memo"><svg><use xlink:href="#iconM"></use></svg></button>
        </div>
    </div>
    <span class="keyboard__split"></span>
    <button class="keyboard__action" data-type="done"><svg style="width: 36px"><use xlink:href="#iconKeyboardHide"></use></svg></button>
</div>
<div class="keyboard__util"></div>`;
    let startY = 0;
    let startX = 0;
    let moved = false;
    toolbarElement.addEventListener("touchstart", e => {
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        moved = false;
    });
    toolbarElement.addEventListener("touchmove", e => {
        if (Math.abs(e.touches[0].clientY - startY) > 10 || Math.abs(e.touches[0].clientX - startX) > 10) {
            moved = true;
        }
    });
    toolbarElement.addEventListener("mousedown", event => {
        const buttonElement = hasClosestByTag(event.target as HTMLElement, "BUTTON");
        const type = buttonElement && buttonElement.getAttribute("data-type");
        if (type === "undo" || type === "redo") {
            // 保持编辑器焦点，避免异步撤销或重做期间软键盘收起。
            event.preventDefault();
        }
    });
    toolbarElement.addEventListener(isInAndroid() || isInHarmony() ? "touchend" : "click", async (event) => {
        if (moved) {
            return;
        }
        const protyle = getCurrentEditor()?.protyle;
        const target = event.target as HTMLElement;
        const slashBtnElement = hasClosestByClassName(event.target as HTMLElement, "keyboard__slash-item");
        if (slashBtnElement && slashBtnElement.dataset.action === "fontFamilyMenu") {
            const range = protyle.toolbar.range.cloneRange();
            const nodeElements = getFontNodeElements(protyle);
            const fontFamilyState = getInlineFontFamilyState(protyle, nodeElements);
            const utilElement = toolbarElement.querySelector(".keyboard__util") as HTMLElement;
            const isFontFamilyMenuValid = () => getCurrentEditor()?.protyle === protyle &&
                toolbarElement.clientHeight > 100 && range.startContainer.isConnected &&
                range.endContainer.isConnected && toolbarElement.querySelector('.keyboard__action[data-type="text"]')
                    ?.classList.contains("protyle-toolbar__item--current") === true;
            preventKeyboardToolbarRender();
            void renderMobileFontFamilyMenu(utilElement, {
                ...fontFamilyState,
                isOpenValid: isFontFamilyMenuValid,
                onBack() {
                    if (!isFontFamilyMenuValid()) {
                        return;
                    }
                    protyle.toolbar.range = range;
                    renderTextMenu(protyle, toolbarElement);
                    focusByRange(range);
                },
                onInteraction: preventKeyboardToolbarRender,
                onSelect(family) {
                    if (!isFontFamilyMenuValid()) {
                        return;
                    }
                    protyle.toolbar.range = range;
                    fontEvent(protyle, nodeElements, "fontFamily", getInlineFontFamilyValue(family), false);
                    renderTextMenu(protyle, toolbarElement);
                    focusByRange(protyle.toolbar.range);
                }
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (slashBtnElement && slashBtnElement.dataset.action === "manageInlineStyle") {
            openInlineStyleDialog(slashBtnElement.dataset.inlineStyleType as TInlineStyleType, () => {
                renderTextMenu(protyle, toolbarElement);
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (slashBtnElement && !slashBtnElement.getAttribute("data-type")) {
            const dataValue = decodeURIComponent(slashBtnElement.getAttribute("data-value"));
            if (dataValue === Constants.ZWSP + 3) {
                return;
            }
            protyle.hint.fill(dataValue, protyle, false);   // 点击后 range 会改变
            event.preventDefault();
            event.stopPropagation();
            if (dataValue === "((" || dataValue === "{{") {
                // (( / {{ 的候选列表无输入框，需保持键盘不收起，否则无法继续输入筛选 https://github.com/siyuan-note/siyuan/issues/17877
                // 关闭插入菜单，保留光标和软键盘用于输入查询条件
                hideKeyboardToolbarUtil();
                callMobileAppShowKeyboard();
                if (isInHarmony() || isInAndroid()) {
                    setTimeout(() => focusByRange(protyle.toolbar.range), Constants.TIMEOUT_TRANSITION);
                }
            } else if (slashBtnElement.getAttribute("data-focus") === "true") {
                focusByRange(protyle.toolbar.range);
            }
            return;
        }
        const buttonElement = hasClosestByTag(target, "BUTTON");
        if (!buttonElement || buttonElement.getAttribute("disabled")) {
            return;
        }
        const type = buttonElement.getAttribute("data-type");
        // appearance
        if (["clear", "style2", "style4", "color", "backgroundColor", "fontSize", "style1"].includes(type)) {
            preventRender = true;
            const nodeElements = getFontNodeElements(protyle);
            const itemElement = buttonElement.firstElementChild as HTMLElement;
            const focusRange = !buttonElement.classList.contains("keyboard__slash-item");
            if (type === "style1") {
                fontEvent(protyle, nodeElements, type,
                    encodeStyle1(itemElement.style.backgroundColor, itemElement.style.color), focusRange);
            } else if (type === "fontSize") {
                fontEvent(protyle, nodeElements, type, itemElement.textContent.trim(), focusRange);
            } else if (type === "backgroundColor") {
                fontEvent(protyle, nodeElements, type, itemElement.style.backgroundColor, focusRange);
            } else if (type === "color") {
                fontEvent(protyle, nodeElements, type, itemElement.style.color, focusRange);
            } else {
                fontEvent(protyle, nodeElements, type, undefined, focusRange);
            }
            setTimeout(() => {
                preventRender = false;
            }, 1000);
        }

        event.preventDefault();
        event.stopPropagation();
        if (getSelection().rangeCount === 0) {
            return;
        }

        const range = getSelection().getRangeAt(0);
        if (type === "done") {
            if (toolbarElement.clientHeight > 100) {
                if (isInHarmony() || isInAndroid()) {
                    setTimeout(() => focusByRange(range), Constants.TIMEOUT_TRANSITION);
                } else {
                    focusByRange(range);
                }
                hideKeyboardToolbarUtil();
                callMobileAppShowKeyboard();
            } else {
                activeBlur();
            }
            return;
        }
        if (window.siyuan.config.readonly || !protyle || protyle.disabled) {
            return;
        }
        if (type === "undo") {
            protyle.undo.undo(protyle);
            return;
        } else if (type === "redo") {
            protyle.undo.redo(protyle);
            return;
        }
        if (getSelection().rangeCount === 0) {
            return;
        }
        const nodeElement = hasClosestBlock(range.startContainer);
        if (!nodeElement) {
            return;
        }
        // inline element
        if (type === "goback") {
            toolbarElement.querySelector('.keyboard__action[data-type="goinline"]').classList.remove("protyle-toolbar__item--current");
            const dynamicElements = document.querySelectorAll("#keyboardToolbar .keyboard__dynamic");
            dynamicElements[0].classList.remove("fn__none");
            dynamicElements[1].classList.add("fn__none");
            focusByRange(range);
            preventRender = true;
            setTimeout(() => {
                preventRender = false;
            }, 1000);
            return;
        } else if (type === "goinline") {
            buttonElement.classList.add("protyle-toolbar__item--current");
            const dynamicElements = document.querySelectorAll("#keyboardToolbar .keyboard__dynamic");
            dynamicElements[1].classList.remove("fn__none");
            dynamicElements[0].classList.add("fn__none");
            focusByRange(range);
            return;
        } else if (["a", "block-ref", "inline-math", "inline-memo"].includes(type)) {
            if (!hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock")) {
                hideElements(["util"], protyle);
                protyle.toolbar.element.querySelector(`[data-type="${type}"]`).dispatchEvent(new CustomEvent("click"));
            }
            return;
        } else if (buttonElement.classList.contains("keyboard__action") && ["strong", "em", "s", "code", "mark", "tag", "u", "sup", "clear", "sub", "kbd"].includes(type)) {
            if (!hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock")) {
                protyle.toolbar.setInlineMark(protyle, type, "toolbar");
            }
            return;
        } else if (type === "text") {
            if (buttonElement.classList.contains("protyle-toolbar__item--current")) {
                hideKeyboardToolbarUtil();
                focusByRange(range);
            } else {
                buttonElement.classList.add("protyle-toolbar__item--current");
                toolbarElement.querySelector('.keyboard__action[data-type="done"] use').setAttribute("xlink:href", "#iconCloseRound");
                const oldScrollTop = protyle.contentElement.scrollTop;
                renderTextMenu(protyle, toolbarElement);
                showKeyboardToolbarUtil(oldScrollTop);
                window.JSAndroid?.hideKeyboard();
                setTimeout(() => {
                    focusByRange(range);
                    preventRender = true;
                    setTimeout(() => {
                        preventRender = false;
                    }, 1000);
                }, Constants.TIMEOUT_TRANSITION);
            }
            return;
        } else if (type === "moveup") {
            moveToUp(protyle, nodeElement, range);
            return;
        } else if (type === "movedown") {
            moveToDown(protyle, nodeElement, range);
            return;
        } else if (type === "softLine") {
            const trackedRangeInsertion = prepareTrackedRangeInsertion(protyle, range);
            try {
                range.extractContents();
                softEnter(range, nodeElement, protyle, trackedRangeInsertion);
            } finally {
                endTrackedRangeInsertion(trackedRangeInsertion);
            }
            focusByRange(range);
            return;
        } else if (type === "add") {
            if (buttonElement.classList.contains("protyle-toolbar__item--current")) {
                if (isInHarmony() || isInAndroid()) {
                    setTimeout(() => focusByRange(range), Constants.TIMEOUT_TRANSITION);
                } else {
                    focusByRange(range);
                }
                hideKeyboardToolbarUtil();
                callMobileAppShowKeyboard();
            } else {
                (document.activeElement as HTMLElement)?.blur();
                buttonElement.classList.add("protyle-toolbar__item--current");
                toolbarElement.querySelector('.keyboard__action[data-type="done"] use').setAttribute("xlink:href", "#iconCloseRound");
                const oldScrollTop = protyle.contentElement.scrollTop;
                renderSlashMenu(protyle, toolbarElement);
                showKeyboardToolbarUtil(oldScrollTop);
                window.JSAndroid?.hideKeyboard();
            }
            return;
        } else if (type === "block") {
            protyle.gutter.renderMenu(protyle, nodeElement);
            window.siyuan.menus.menu.fullscreen();
            activeBlur();
            return;
        } else if (type === "outdent") {
            if (nodeElement.classList.contains("code-block")) {
                tabCodeBlock(protyle, nodeElement, range, true);
            } else {
                await listOutdent(protyle, [nodeElement.parentElement], range);
            }
            focusByRange(range);
            return;
        } else if (type === "indent") {
            if (nodeElement.classList.contains("code-block")) {
                tabCodeBlock(protyle, nodeElement, range);
            } else {
                await listIndent(protyle, [nodeElement.parentElement], range);
            }
            focusByRange(range);
            return;
        } else if (type) {
            protyle.toolbar.element.querySelector(`[data-type="${type}"]`)?.dispatchEvent(new CustomEvent("click"));
        }
    });
};
