import {setStorageVal, updateHotkeyTip} from "../util/compatibility";
import {ToolbarItem} from "./ToolbarItem";
import {focusByRange} from "../util/selection";
import {Constants} from "../../constants";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {updateBatchTransaction} from "../wysiwyg/transaction";
import {lineNumberRender} from "../render/highlightRender";
import {
    closeSubElement,
    SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE,
    setSubElementSource,
} from "./subElementLifecycle";
import {escapeAttr} from "../../util/escape";
import {
    decodeStyle1,
    encodeStyle1,
    filterHiddenRecentInlineStyles,
    getBuiltinInlineStyleApplication,
    getBuiltinInlineStyleIDFromValue,
    getBuiltinInlineStylePreview,
    getInlineStyleApplication,
    getInlineStyleByID,
    getInlineStyleByValue,
    getInlineStyleIDFromValue,
    getInlineStylePreview,
    getInlineStylesCache,
    getRecentInlineStyleKey,
    getVisibleOrderedStyleKeys,
    isBuiltinOrderKey,
    INLINE_BACKGROUND_COLORS,
    INLINE_FONT_COLORS,
    TBuiltinInlineStyleID,
    TInlineStyleType,
} from "./inlineStyle";
import {openInlineStyleDialog} from "./inlineStyleDialog";

const MAX_RECENT_FONT_STYLES = 14;

export const limitRecentFontStyleRows = (element: HTMLElement) => {
    const wrapElement = element.querySelector('[data-id="lastUsedWrap"]');
    if (!wrapElement) {
        return;
    }
    const itemElements = Array.from(wrapElement.children) as HTMLElement[];
    let rowCount = 0;
    let lastTop: number;
    let overflowIndex = itemElements.length;
    itemElements.find((item, index) => {
        if (item.offsetTop !== lastTop) {
            rowCount++;
            lastTop = item.offsetTop;
        }
        if (rowCount > 2) {
            overflowIndex = index;
            return true;
        }
        return false;
    });
    itemElements.slice(overflowIndex).forEach(item => item.classList.add("fn__none"));
};

export class Font extends ToolbarItem {
    public element: HTMLElement;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        super(protyle, menuItem);
        this.element.addEventListener("click", () => {
            if (protyle.toolbar.subElement.dataset.subElementSource === SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE &&
                !protyle.toolbar.subElement.classList.contains("fn__none")) {
                protyle.toolbar.subElement.classList.add("fn__none");
                closeSubElement(protyle.toolbar);
                focusByRange(protyle.toolbar.range);
                return;
            }
            closeSubElement(protyle.toolbar);
            /// #if !MOBILE
            if (protyle.toolbar.element.classList.contains("fn__none")) {
                protyle.toolbar.render(protyle, protyle.toolbar.range);
            }
            /// #else
            protyle.toolbar.element.classList.add("fn__none");
            /// #endif
            const triggerRect = this.element.getBoundingClientRect();
            const visibleTriggerRect = triggerRect.width > 0 && triggerRect.height > 0 ? triggerRect : undefined;
            protyle.toolbar.subElement.innerHTML = "";
            protyle.toolbar.subElement.style.width = "";
            protyle.toolbar.subElement.style.padding = "";
            const appearanceElement = appearanceMenu(protyle, getFontNodeElements(protyle));
            protyle.toolbar.subElement.append(appearanceElement);
            /// #if !MOBILE
            setSubElementSource(protyle.toolbar, SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE);
            /// #endif
            protyle.toolbar.subElement.style.zIndex = (++window.siyuan.zIndex).toString();
            protyle.toolbar.subElement.classList.remove("fn__none");
            limitRecentFontStyleRows(appearanceElement);
            focusByRange(protyle.toolbar.range);
            /// #if !MOBILE
            protyle.toolbar.setSelectionElementPosition(
                protyle, protyle.toolbar.subElement, visibleTriggerRect, appearanceElement
            );
            /// #endif
        });
    }
}

export const getFontSizeInfo = (protyle: IProtyle, nodeElements?: Element[]) => {
    let textElement: HTMLElement;
    let fontSizeElement: HTMLElement;
    if (nodeElements && nodeElements.length > 0) {
        textElement = nodeElements[0] as HTMLElement;
        fontSizeElement = textElement;
    } else {
        textElement = hasClosestByAttribute(protyle.toolbar.range.startContainer, "data-type", "text") as HTMLElement;
        if (!textElement) {
            textElement = protyle.toolbar.range.cloneContents().querySelector('[data-type~="text"]') as HTMLElement;
        }
        const startContainer = protyle.toolbar.range.startContainer;
        fontSizeElement = startContainer.nodeType === Node.ELEMENT_NODE ?
            startContainer as HTMLElement : startContainer.parentElement;
    }

    let baseFontSize = window.siyuan.config.editor.fontSize;
    const baseElement = textElement?.isConnected ? textElement.parentElement : fontSizeElement;
    if (baseElement) {
        baseFontSize = parseFloat(getComputedStyle(baseElement).fontSize) || baseFontSize;
    }

    let fontSize = textElement?.style.fontSize;
    if (!fontSize && fontSizeElement) {
        fontSize = getComputedStyle(fontSizeElement).fontSize;
    }
    return {
        fontSize: fontSize || window.siyuan.config.editor.fontSize + "px",
        baseFontSize,
    };
};

export const convertFontSize = (fontSize: string, unit: "px" | "em", baseFontSize: number) => {
    const value = parseFloat(fontSize);
    const base = baseFontSize || window.siyuan.config.editor.fontSize;
    if (unit === "em") {
        return fontSize.endsWith("em") ? value + "em" : parseFloat((value / base).toFixed(2)) + "em";
    }
    return fontSize.endsWith("px") ? Math.round(value) + "px" : Math.round(value * base) + "px";
};

export const appearanceMenu = (protyle: IProtyle, nodeElements?: Element[],
                               onChange?: (type: string, color?: string) => void) => {
    const builtinStyleLabels: Record<TBuiltinInlineStyleID, string> = {
        error: window.siyuan.languages.errorStyle,
        warning: window.siyuan.languages.warningStyle,
        info: window.siyuan.languages.infoStyle,
        success: window.siyuan.languages.successStyle,
    };
    const renderOrderedButtons = (type: TInlineStyleType) => {
        const data = getInlineStylesCache();
        return getVisibleOrderedStyleKeys(type, data).map(key => {
            if (isBuiltinOrderKey(type, key)) {
                if (type === "color") {
                    return `<button class="color__square" style="color:var(--b3-font-color${key})" data-type="color">A</button>`;
                }
                if (type === "backgroundColor") {
                    return `<button class="color__square" style="background-color:var(--b3-font-background${key})" data-type="backgroundColor"></button>`;
                }
                const preview = getBuiltinInlineStylePreview(key as TBuiltinInlineStyleID);
                return "<button class=\"color__square ariaLabel\" data-position=\"3south\" data-type=\"style1\" " +
                    `aria-label="${builtinStyleLabels[key as TBuiltinInlineStyleID]}" style="color:${preview.color};` +
                    `background-color:${preview.backgroundColor};">A</button>`;
            }
            const style = getInlineStyleByID(key, data);
            if (!style) {
                return "";
            }
            const preview = getInlineStylePreview(style);
            return `<button class="color__square ariaLabel" data-position="3south" aria-label="${escapeAttr(style.name)}" data-inline-style-id="${style.id}" data-type="${type}" style="${preview.color ? `color:${preview.color};` : ""}${preview.backgroundColor ? `background-color:${preview.backgroundColor};` : ""}">${type === "backgroundColor" ? "" : "A"}</button>`;
        }).join("");
    };
    let colorHTML = "";
    INLINE_FONT_COLORS.slice(0, 1).forEach(item => {
        colorHTML += `<button ${item ? `class="color__square" style="color:${item}"` : `class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.default}"`} data-type="color">A</button>`;
    });
    colorHTML += renderOrderedButtons("color");
    let bgHTML = "";
    INLINE_BACKGROUND_COLORS.slice(0, 1).forEach(item => {
        bgHTML += `<button ${item ? `class="color__square" style="background-color:${item}"` : `class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.default}"`} data-type="backgroundColor"></button>`;
    });
    bgHTML += renderOrderedButtons("backgroundColor");
    const getManageHTML = (type: TInlineStyleType) => window.siyuan.config.readonly || window.siyuan.isPublish ? "" :
        `<button class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.manageColors}" data-action="manageInlineStyle" data-inline-style-type="${type}"><svg class="svg--mid"><use xlink:href="#iconSettings"></use></svg></button>`;

    const element = document.createElement("div");
    element.classList.add("protyle-font");
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
        lastColorHTML = `<div data-id="lastUsed" class="fn__flex">
    ${window.siyuan.languages.lastUsed}
    <span class="fn__space"></span>
    <kbd class="fn__kbd fn__flex-center${window.siyuan.config.keymap.editor.insert.lastUsed.custom ? "" : " fn__none"}">${updateHotkeyTip(window.siyuan.config.keymap.editor.insert.lastUsed.custom)}</kbd>
</div>
<div class="fn__hr--small"></div>
<div data-id="lastUsedWrap" class="fn__flex fn__flex-wrap" style="align-items: center">`;
        lastFonts.forEach((item: string) => {
            const lastFontStatus = item.split(Constants.ZWSP);
            const customStyle = getInlineStyleByValue(item);
            const customLabel = customStyle ? escapeAttr(customStyle.name) :
                (getInlineStyleIDFromValue(item) ? window.siyuan.languages.custom : "");
            switch (lastFontStatus[0]) {
                case "color":
                    lastColorHTML += `<button class="color__square ariaLabel" data-position="3south" aria-label="${customLabel || window.siyuan.languages.colorFont + (lastFontStatus[1] ? "" : " " + window.siyuan.languages.default)}" ${lastFontStatus[1] ? `style="color:${lastFontStatus[1]}"` : ""} data-type="${lastFontStatus[0]}">A</button>`;
                    break;
                case "backgroundColor":
                    lastColorHTML += `<button class="color__square ariaLabel" data-position="3south" aria-label="${customLabel || window.siyuan.languages.colorPrimary + (lastFontStatus[1] ? "" : " " + window.siyuan.languages.default)}" ${lastFontStatus[1] ? `style="background-color:${lastFontStatus[1]}"` : ""} data-type="${lastFontStatus[0]}"></button>`;
                    break;
                case "style2":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.hollow}" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;">A</button>`;
                    break;
                case "style4":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.shadow}" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)">A</button>`;
                    break;
                case "fontSize":
                    if (!disableFont) {
                        lastColorHTML += `<button data-type="${lastFontStatus[0]}" data-value="${lastFontStatus[1]}" class="protyle-font__style ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.fontSize} ${lastFontStatus[1]}">${lastFontStatus[1]}</button>`;
                    }
                    break;
                case "style1": {
                    const builtinStyleID = getBuiltinInlineStyleIDFromValue(item);
                    const preview = builtinStyleID ? getBuiltinInlineStylePreview(builtinStyleID) : {
                        backgroundColor: lastFontStatus[1],
                        color: lastFontStatus[2],
                    };
                    lastColorHTML += `<button class="color__square ariaLabel" data-position="3south" aria-label="${customLabel || (builtinStyleID ? builtinStyleLabels[builtinStyleID] : window.siyuan.languages.color + (lastFontStatus[1] ? "" : " " + window.siyuan.languages.default))}" ${lastFontStatus[1] ? `style="background-color:${preview.backgroundColor};color:${preview.color}"` : ""} data-type="${lastFontStatus[0]}">A</button>`;
                    break;
                }
                case "clear":
                    lastColorHTML += `<button style="height: 26px;display: flex;align-items: center;padding: 0 5px;" data-type="${lastFontStatus[0]}" class="protyle-font__style ariaLabel" aria-label="${window.siyuan.languages.clearFontStyle}"><svg class="svg--mid"><use xlink:href="#iconTrashcan"></use></svg></button>`;
                    break;
            }
        });
        lastColorHTML += "</div>";
    }
    const {fontSize, baseFontSize} = getFontSizeInfo(protyle, nodeElements);
    const applyFontStyle = (type: string, color?: string) => {
        fontEvent(protyle, nodeElements, type, color, true, onChange);
    };
    const closeSelectionToolbarAppearance = () => {
        if (protyle.toolbar.subElement.dataset.subElementSource !== SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE) {
            return;
        }
        protyle.toolbar.subElement.classList.add("fn__none");
        closeSubElement(protyle.toolbar);
        protyle.toolbar.render(protyle, protyle.toolbar.range);
        focusByRange(protyle.toolbar.range);
    };
    element.innerHTML = `${lastColorHTML}
<div class="fn__hr"></div>
<div data-id="color">${window.siyuan.languages.color}</div>
<div class="fn__hr--small"></div>
<div data-id="colorWrap" class="fn__flex fn__flex-wrap">
    <button class="color__square ariaLabel" data-position="3south" data-type="style1" aria-label="${window.siyuan.languages.default}">A</button>
    ${renderOrderedButtons("style1")}
    ${getManageHTML("style1")}
</div>
<div class="fn__hr"></div>
<div data-id="colorFont">${window.siyuan.languages.colorFont}</div>
<div class="fn__hr--small"></div>
<div data-id="colorFontWrap" class="fn__flex fn__flex-wrap">
    ${colorHTML}
    ${getManageHTML("color")}
</div>
<div class="fn__hr"></div>
<div data-id="colorPrimary">${window.siyuan.languages.colorPrimary}</div>
<div class="fn__hr--small"></div>
<div data-id="colorPrimaryWrap" class="fn__flex fn__flex-wrap">
    ${bgHTML}
    ${getManageHTML("backgroundColor")}
</div>
<div class="fn__hr"></div>
<div data-id="fontStyle">${window.siyuan.languages.fontStyle}</div>
<div class="fn__hr--small"></div>
<div data-id="fontStyleWrap" class="fn__flex">
    <button data-type="style2" class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.hollow}" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;">A</button>
    <button data-type="style4" class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.shadow}" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)">A</button>
</div>
<div class="fn__hr${disableFont ? " fn__none" : ""}"></div>
<div data-id="fontSize" class="fn__flex${disableFont ? " fn__none" : ""}">
    ${window.siyuan.languages.fontSize}
    <span class="fn__flex-1"></span>
    <label class="fn__flex">
        ${window.siyuan.languages.relativeFontSize}
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" ${fontSize.endsWith("em") ? "checked" : ""} type="checkbox">
        <span class="fn__space--small"></span>
    </label>
</div>
<div data-id="fontSizeWrap" class="${disableFont ? " fn__none" : ""}">
    <div class="fn__hr"></div>
    <div class="b3-tooltips b3-tooltips__n fn__flex${fontSize.endsWith("em") ? " fn__none" : ""}" aria-label="${fontSize}">   
        <input class="b3-slider fn__block" id="fontSizePX" max="72" min="9" step="1" type="range" value="${parseInt(fontSize)}">
    </div>
    <div class="b3-tooltips b3-tooltips__n fn__flex${fontSize.endsWith("em") ? "" : " fn__none"}" aria-label="${parseFloat(fontSize) * 100}%">   
        <input class="b3-slider fn__block" id="fontSizeEM" max="4.5" min="0.56" step="0.01" type="range" value="${parseFloat(fontSize)}">
    </div>
</div>
<div class="fn__hr--b"></div>
<div data-id="clearFontStyle" class="fn__flex">
    <div class="fn__space--small"></div>
    <button class="b3-button b3-button--remove fn__block" data-type="clear">
        <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.clearFontStyle}
    </button>
    <div class="fn__space--small"></div>
</div>`;
    element.addEventListener("click", function (event: Event) {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(element)) {
            const dataType = target.getAttribute("data-type");
            if (target.tagName === "BUTTON") {
                if (target.dataset.action === "manageInlineStyle") {
                    closeSubElement(protyle.toolbar);
                    protyle.toolbar.subElement.classList.add("fn__none");
                    protyle.toolbar.element.classList.add("fn__none");
                    openInlineStyleDialog(target.dataset.inlineStyleType as TInlineStyleType);
                } else if (dataType === "style1") {
                    applyFontStyle(dataType, encodeStyle1(target.style.backgroundColor, target.style.color));
                    closeSelectionToolbarAppearance();
                } else if (dataType === "fontSize") {
                    applyFontStyle(dataType, target.getAttribute("data-value"));
                    closeSelectionToolbarAppearance();
                } else if (dataType === "backgroundColor") {
                    applyFontStyle(dataType, target.style.backgroundColor);
                    closeSelectionToolbarAppearance();
                } else if (dataType === "color") {
                    applyFontStyle(dataType, target.style.color);
                    closeSelectionToolbarAppearance();
                } else {
                    applyFontStyle(dataType);
                    closeSelectionToolbarAppearance();
                }
                break;
            }
            target = target.parentElement;
        }
    });
    const switchElement = element.querySelector(".b3-switch") as HTMLInputElement;
    const fontSizePXElement = element.querySelector("#fontSizePX") as HTMLInputElement;
    const fontSizeEMElement = element.querySelector("#fontSizeEM") as HTMLInputElement;
    switchElement.addEventListener("change", function () {
        if (switchElement.checked) {
            const em = convertFontSize(fontSizePXElement.value + "px", "em", baseFontSize);
            fontSizeEMElement.parentElement.setAttribute("aria-label", (parseFloat(em) * 100).toFixed(0) + "%");
            fontSizeEMElement.value = parseFloat(em).toString();

            fontSizePXElement.parentElement.classList.add("fn__none");
            fontSizeEMElement.parentElement.classList.remove("fn__none");
            applyFontStyle("fontSize", fontSizeEMElement.value + "em");
        } else {
            const px = convertFontSize(fontSizeEMElement.value + "em", "px", baseFontSize);
            fontSizePXElement.parentElement.setAttribute("aria-label", px);
            fontSizePXElement.value = parseFloat(px).toString();

            fontSizePXElement.parentElement.classList.remove("fn__none");
            fontSizeEMElement.parentElement.classList.add("fn__none");
            applyFontStyle("fontSize", fontSizePXElement.value + "px");
        }
    });
    fontSizePXElement.addEventListener("change", function () {
        applyFontStyle("fontSize", fontSizePXElement.value + "px");
    });
    fontSizeEMElement.addEventListener("change", function () {
        applyFontStyle("fontSize", fontSizeEMElement.value + "em");
    });
    fontSizePXElement.addEventListener("input", function () {
        fontSizePXElement.parentElement.setAttribute("aria-label", fontSizePXElement.value + "px");
    });
    fontSizeEMElement.addEventListener("input", function () {
        fontSizeEMElement.parentElement.setAttribute("aria-label", (parseFloat(fontSizeEMElement.value) * 100).toFixed(0) + "%");
    });
    return element;
};

export const fontEvent = (protyle: IProtyle, nodeElements: Element[], type?: string, color?: string,
                          focusRange = true, onChange?: (type: string, color?: string) => void) => {
    let localFontStyles = window.siyuan.storage[Constants.LOCAL_FONTSTYLES];
    if (type) {
        const value = `${type}${Constants.ZWSP}${color}`;
        const recentKey = getRecentInlineStyleKey(value);
        localFontStyles = [value, ...localFontStyles.filter((item: string) =>
            getRecentInlineStyleKey(item) !== recentKey)].slice(0, MAX_RECENT_FONT_STYLES);
        window.siyuan.storage[Constants.LOCAL_FONTSTYLES] = localFontStyles;
        setStorageVal(Constants.LOCAL_FONTSTYLES, window.siyuan.storage[Constants.LOCAL_FONTSTYLES]);
    } else {
        const visibleFontStyles = filterHiddenRecentInlineStyles(localFontStyles);
        if (visibleFontStyles.length === 0) {
            type = "style1";
            const firstKey = getVisibleOrderedStyleKeys("style1")[0];
            if (firstKey && isBuiltinOrderKey("style1", firstKey)) {
                color = getBuiltinInlineStyleApplication(firstKey as TBuiltinInlineStyleID).color;
            } else {
                const style = getInlineStyleByID(firstKey);
                color = (style && getInlineStyleApplication(style)?.color) || encodeStyle1();
            }
        } else {
            const fontStyles = visibleFontStyles[0].split(Constants.ZWSP);
            type = fontStyles.splice(0, 1)[0];
            color = fontStyles.join(Constants.ZWSP);
        }
    }
    if (onChange) {
        onChange(type, color);
        return;
    }
    if (nodeElements && nodeElements.length > 0) {
        updateBatchTransaction(nodeElements, protyle, (e: HTMLElement) => {
            if (type === "clear") {
                e.style.color = "";
                e.style.webkitTextFillColor = "";
                e.style.webkitTextStroke = "";
                e.style.textShadow = "";
                e.style.backgroundColor = "";
                e.style.fontSize = "";
                e.style.removeProperty("--b3-parent-background");
            } else if (type === "style1") {
                const style = decodeStyle1(color);
                e.style.backgroundColor = style.backgroundColor;
                e.style.color = style.color;
                e.style.setProperty("--b3-parent-background", style.backgroundColor);
            } else if (type === "style2") {
                e.style.webkitTextStroke = "0.2px var(--b3-theme-on-background)";
                e.style.webkitTextFillColor = "transparent";
            } else if (type === "style4") {
                e.style.textShadow = "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)";
            } else if (type === "color") {
                e.style.color = color;
            } else if (type === "backgroundColor") {
                e.style.backgroundColor = color;
                e.style.setProperty("--b3-parent-background", color);
            } else if (type === "fontSize") {
                e.style.fontSize = color;
            }
            if ((type === "fontSize" || type === "clear") && e.getAttribute("data-type") === "NodeCodeBlock") {
                lineNumberRender(e.querySelector(".hljs"));
            }
        });
        if (focusRange) {
            focusByRange(protyle.toolbar.range);
        }
    } else {
        if (type === "clear") {
            protyle.toolbar.setInlineMark(protyle, "clear", "range", {type: "text"}, focusRange);
        } else {
            protyle.toolbar.setInlineMark(protyle, "text", "range", {type, color}, focusRange);
        }
    }
};

export const setFontStyle = (textElement: HTMLElement, textOption: ITextOption) => {
    const setBlockRef = (blockRefOption: string) => {
        const blockRefData = blockRefOption.split(Constants.ZWSP);
        // 标签等元素中包含 ZWSP，需移除后拼接 https://github.com/siyuan-note/siyuan/issues/6466
        const id = blockRefData.splice(0, 1)[0];
        textElement.setAttribute("data-id", id);
        textElement.setAttribute("data-subtype", blockRefData.splice(0, 1)[0]);
        textElement.removeAttribute("data-href");
        let text = blockRefData.join("");
        if (text.replace(/\s/g, "") === "") {
            text = id;
        }
        textElement.innerText = text;
    };
    const setLink = (textOption: string) => {
        const options = textOption.split(Constants.ZWSP);
        textElement.setAttribute("data-href", options[0]);
        textElement.removeAttribute("data-subtype");
        textElement.removeAttribute("data-id");
        if (options[1]) {
            textElement.textContent = options[1];
        }
    };
    const setFileAnnotation = (textOption: string) => {
        const options = textOption.split(Constants.ZWSP);
        textElement.setAttribute("data-id", options[0]);
        textElement.removeAttribute("data-href");
        textElement.removeAttribute("data-subtype");
        if (options[1]) {
            textElement.textContent = options[1];
        }
    };

    if (textOption) {
        switch (textOption.type) {
            case "color":
                textElement.style.color = textOption.color;
                break;
            case "fontSize":
                textElement.style.fontSize = textOption.color;
                break;
            case "backgroundColor":
                textElement.style.backgroundColor = textOption.color;
                break;
            case "style1": {
                const style = decodeStyle1(textOption.color);
                textElement.style.backgroundColor = style.backgroundColor;
                textElement.style.color = style.color;
                break;
            }
            case "style2":
                textElement.style.webkitTextStroke = "0.2px var(--b3-theme-on-background)";
                textElement.style.webkitTextFillColor = "transparent";
                break;
            case "style4":
                textElement.style.textShadow = "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)";
                break;
            case "id":
                setBlockRef(textOption.color);
                break;
            case "inline-math":
                textElement.className = "render-node";
                textElement.setAttribute("contenteditable", "false");
                textElement.setAttribute("data-subtype", "math");
                textElement.setAttribute("data-content", textElement.textContent.replace(Constants.ZWSP, ""));
                textElement.removeAttribute("data-render");
                textElement.textContent = "";
                break;
            case "a":
                setLink(textOption.color);
                break;
            case "file-annotation-ref":
                setFileAnnotation(textOption.color);
                break;
            case "inline-memo":
                textElement.removeAttribute("contenteditable");
                textElement.removeAttribute("data-content");
                break;
        }

        if (!textElement.getAttribute("style")) {
            textElement.removeAttribute("style");
        }
    }
};

export const hasSameTextStyle = (currentElement: HTMLElement, sideElement: HTMLElement, textObj?: ITextOption) => {
    if (!textObj && currentElement) {
        const types = sideElement.getAttribute("data-type").split(" ");
        if (types.includes("inline-math") || types.includes("inline-memo") ||
            types.includes("a")) {
            return false;
        }
        if (types.includes("block-ref")) {
            if (currentElement.getAttribute("data-id") !== sideElement.getAttribute("data-id") ||
                currentElement.getAttribute("data-subtype") !== sideElement.getAttribute("data-subtype") ||
                currentElement.textContent !== sideElement.textContent) {
                return false;
            }
        }
        if (types.includes("file-annotation-ref")) {
            if (currentElement.getAttribute("data-id") !== sideElement.getAttribute("data-id") ||
                currentElement.textContent !== sideElement.textContent) {
                return false;
            }
        }
        if (sideElement.style.color === currentElement.style.color &&
            sideElement.style.webkitTextFillColor === currentElement.style.webkitTextFillColor &&
            sideElement.style.webkitTextStroke === currentElement.style.webkitTextStroke &&
            sideElement.style.textShadow === currentElement.style.textShadow &&
            sideElement.style.backgroundColor === currentElement.style.backgroundColor &&
            sideElement.style.fontSize === currentElement.style.fontSize) {
            return true;
        }
        return false;
    }

    if (textObj) {
        if (textObj.type === "text") {
            // 清除样式
            return !sideElement.style.color &&
                !sideElement.style.webkitTextFillColor &&
                !sideElement.style.webkitTextStroke &&
                !sideElement.style.textShadow &&
                !sideElement.style.fontSize &&
                !sideElement.style.backgroundColor;
        }
        if (textObj.type === "color") {
            return textObj.color === sideElement.style.color;
        }
        if (textObj.type === "backgroundColor") {
            return textObj.color === sideElement.style.backgroundColor;
        }
        if (textObj.type === "style1") {
            const style = decodeStyle1(textObj.color);
            return style.backgroundColor === sideElement.style.backgroundColor &&
                style.color === sideElement.style.color;
        }
        if (textObj.type === "style2") {
            return "transparent" === sideElement.style.webkitTextFillColor &&
                "0.2px var(--b3-theme-on-background)" === sideElement.style.webkitTextStroke;
        }
        if (textObj.type === "style4") {
            return "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)" === sideElement.style.textShadow;
        }
        if (textObj.type === "fontSize") {
            return textObj.color === sideElement.style.fontSize;
        }
    }
    return false;
};

export const getFontNodeElements = (protyle: IProtyle) => {
    let nodeElements: Element[];
    if (protyle.toolbar.range.toString() === "") {
        nodeElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
        if (nodeElements.length === 0) {
            const nodeElement = hasClosestBlock(protyle.toolbar.range.startContainer);
            if (nodeElement) {
                nodeElements = [nodeElement];
            }
        }
    }
    return nodeElements;
};
