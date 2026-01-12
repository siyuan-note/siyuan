import {setStorageVal, updateHotkeyTip} from "../util/compatibility";
import {ToolbarItem} from "./ToolbarItem";
import {setPosition} from "../../util/setPosition";
import {focusByRange, getSelectionPosition} from "../util/selection";
import {Constants} from "../../constants";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {updateBatchTransaction} from "../wysiwyg/transaction";
import {lineNumberRender} from "../render/highlightRender";

export class Font extends ToolbarItem {
    public element: HTMLElement;

    constructor(protyle: IProtyle, menuItem: IMenuItem) {
        super(protyle, menuItem);
        this.element.addEventListener("click", () => {
            protyle.toolbar.element.classList.add("fn__none");
            protyle.toolbar.subElement.innerHTML = "";
            protyle.toolbar.subElement.style.width = "";
            protyle.toolbar.subElement.style.padding = "";
            protyle.toolbar.subElement.append(appearanceMenu(protyle, getFontNodeElements(protyle)));
            protyle.toolbar.subElement.style.zIndex = (++window.siyuan.zIndex).toString();
            protyle.toolbar.subElement.classList.remove("fn__none");
            protyle.toolbar.subElementCloseCB = undefined;
            focusByRange(protyle.toolbar.range);
            /// #if !MOBILE
            const position = getSelectionPosition(protyle.wysiwyg.element, protyle.toolbar.range);
            setPosition(protyle.toolbar.subElement, position.left, position.top + 18, 26);
            /// #endif
        });
    }
}

export const appearanceMenu = (protyle: IProtyle, nodeElements?: Element[]) => {
    let colorHTML = "";
    ["", "var(--b3-font-color1)", "var(--b3-font-color2)", "var(--b3-font-color3)", "var(--b3-font-color4)",
        "var(--b3-font-color5)", "var(--b3-font-color6)", "var(--b3-font-color7)", "var(--b3-font-color8)",
        "var(--b3-font-color9)", "var(--b3-font-color10)", "var(--b3-font-color11)", "var(--b3-font-color12)",
        "var(--b3-font-color13)"].forEach((item) => {
        colorHTML += `<button ${item ? `class="color__square" style="color:${item}"` : `class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.default}"`} data-type="color">A</button>`;
    });
    let bgHTML = "";
    ["", "var(--b3-font-background1)", "var(--b3-font-background2)", "var(--b3-font-background3)", "var(--b3-font-background4)",
        "var(--b3-font-background5)", "var(--b3-font-background6)", "var(--b3-font-background7)", "var(--b3-font-background8)",
        "var(--b3-font-background9)", "var(--b3-font-background10)", "var(--b3-font-background11)", "var(--b3-font-background12)",
        "var(--b3-font-background13)"].forEach((item) => {
        bgHTML += `<button ${item ? `class="color__square" style="background-color:${item}"` : `class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.default}"`} data-type="backgroundColor"></button>`;
    });

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
    const lastFonts = window.siyuan.storage[Constants.LOCAL_FONTSTYLES];
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
            switch (lastFontStatus[0]) {
                case "color":
                    lastColorHTML += `<button class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.colorFont}${lastFontStatus[1] ? "" : " " + window.siyuan.languages.default}" ${lastFontStatus[1] ? `style="color:${lastFontStatus[1]}"` : ""} data-type="${lastFontStatus[0]}">A</button>`;
                    break;
                case "backgroundColor":
                    lastColorHTML += `<button class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.colorPrimary}${lastFontStatus[1] ? "" : " " + window.siyuan.languages.default}" ${lastFontStatus[1] ? `style="background-color:${lastFontStatus[1]}"` : ""} data-type="${lastFontStatus[0]}"></button>`;
                    break;
                case "style2":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="protyle-font__style" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;">${window.siyuan.languages.hollow}</button>`;
                    break;
                case "style4":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="protyle-font__style" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)">${window.siyuan.languages.shadow}</button>`;
                    break;
                case "fontSize":
                    if (!disableFont) {
                        lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="protyle-font__style">${lastFontStatus[1]}</button>`;
                    }
                    break;
                case "style1":
                    lastColorHTML += `<button class="color__square ariaLabel" data-position="3south" aria-label="${window.siyuan.languages.color}${lastFontStatus[1] ? "" : " " + window.siyuan.languages.default}" ${lastFontStatus[1] ? `style="background-color:${lastFontStatus[1]};color:${lastFontStatus[2]}"` : ""} data-type="${lastFontStatus[0]}">A</button>`;
                    break;
                case "clear":
                    lastColorHTML += `<button style="height: 26px;display: flex;align-items: center;padding: 0 5px;" data-type="${lastFontStatus[0]}" class="protyle-font__style ariaLabel" aria-label="${window.siyuan.languages.clearFontStyle}"><svg class="svg--mid"><use xlink:href="#iconTrashcan"></use></svg></button>`;
                    break;
            }
        });
        lastColorHTML += "</div>";
    }
    let textElement: HTMLElement;
    let fontSize = window.siyuan.config.editor.fontSize + "px";
    if (nodeElements && nodeElements.length > 0) {
        textElement = nodeElements[0] as HTMLElement;
    } else {
        textElement = protyle.toolbar.range.cloneContents().querySelector('[data-type~="text"]') as HTMLElement;
        if (!textElement) {
            textElement = hasClosestByAttribute(protyle.toolbar.range.startContainer, "data-type", "text") as HTMLElement;
        }
    }
    if (textElement) {
        fontSize = textElement.style.fontSize || window.siyuan.config.editor.fontSize + "px";
    }
    element.innerHTML = `${lastColorHTML}
<div class="fn__hr"></div>
<div data-id="color">${window.siyuan.languages.color}</div>
<div class="fn__hr--small"></div>
<div data-id="colorWrap" class="fn__flex fn__flex-wrap">
    <button class="color__square ariaLabel" data-position="3south" data-type="style1" aria-label="${window.siyuan.languages.default}">A</button>
    <button class="color__square" data-type="style1" style="color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);">A</button>
    <button class="color__square" data-type="style1" style="color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);">A</button>
    <button class="color__square" data-type="style1" style="color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);">A</button>
    <button class="color__square" data-type="style1" style="color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);">A</button>
</div>
<div class="fn__hr"></div>
<div data-id="colorFont">${window.siyuan.languages.colorFont}</div>
<div class="fn__hr--small"></div>
<div data-id="colorFontWrap" class="fn__flex fn__flex-wrap">
    ${colorHTML}
</div>
<div class="fn__hr"></div>
<div data-id="colorPrimary">${window.siyuan.languages.colorPrimary}</div>
<div class="fn__hr--small"></div>
<div data-id="colorPrimaryWrap" class="fn__flex fn__flex-wrap">
    ${bgHTML}
</div>
<div class="fn__hr"></div>
<div data-id="fontStyle">${window.siyuan.languages.fontStyle}</div>
<div class="fn__hr--small"></div>
<div data-id="fontStyleWrap" class="fn__flex">
    <button data-type="style2" class="protyle-font__style" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;">${window.siyuan.languages.hollow}</button>
    <button data-type="style4" class="protyle-font__style" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)">${window.siyuan.languages.shadow}</button>
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
                if (dataType === "style1") {
                    fontEvent(protyle, nodeElements, dataType, target.style.backgroundColor + Constants.ZWSP + target.style.color);
                } else if (dataType === "fontSize") {
                    fontEvent(protyle, nodeElements, dataType, target.textContent.trim());
                } else if (dataType === "backgroundColor") {
                    fontEvent(protyle, nodeElements, dataType, target.style.backgroundColor);
                } else if (dataType === "color") {
                    fontEvent(protyle, nodeElements, dataType, target.style.color);
                } else {
                    fontEvent(protyle, nodeElements, dataType);
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
            // px -> em
            const em = parseFloat((parseInt(fontSizePXElement.value) / 16).toFixed(2));
            fontSizeEMElement.parentElement.setAttribute("aria-label", (em * 100).toString() + "%");
            fontSizeEMElement.value = em.toString();

            fontSizePXElement.parentElement.classList.add("fn__none");
            fontSizeEMElement.parentElement.classList.remove("fn__none");
            fontEvent(protyle, nodeElements, "fontSize", fontSizeEMElement.value + "em");
        } else {
            const px = Math.round(parseFloat(fontSizeEMElement.value) * 16);
            fontSizePXElement.parentElement.setAttribute("aria-label", px + "px");
            fontSizePXElement.value = px.toString();

            fontSizePXElement.parentElement.classList.remove("fn__none");
            fontSizeEMElement.parentElement.classList.add("fn__none");
            fontEvent(protyle, nodeElements, "fontSize", fontSizePXElement.value + "px");
        }
    });
    fontSizePXElement.addEventListener("change", function () {
        fontEvent(protyle, nodeElements, "fontSize", fontSizePXElement.value + "px");
    });
    fontSizeEMElement.addEventListener("change", function () {
        fontEvent(protyle, nodeElements, "fontSize", fontSizeEMElement.value + "em");
    });
    fontSizePXElement.addEventListener("input", function () {
        fontSizePXElement.parentElement.setAttribute("aria-label", fontSizePXElement.value + "px");
    });
    fontSizeEMElement.addEventListener("input", function () {
        fontSizeEMElement.parentElement.setAttribute("aria-label", (parseFloat(fontSizeEMElement.value) * 100).toFixed(0) + "%");
    });
    return element;
};

export const fontEvent = (protyle: IProtyle, nodeElements: Element[], type?: string, color?: string) => {
    let localFontStyles = window.siyuan.storage[Constants.LOCAL_FONTSTYLES];
    if (type) {
        localFontStyles.splice(0, 0, `${type}${Constants.ZWSP}${color}`);
        localFontStyles = [...new Set(localFontStyles)];
        if (localFontStyles.length > 8) {
            localFontStyles.splice(8, 1);
        }
        window.siyuan.storage[Constants.LOCAL_FONTSTYLES] = localFontStyles;
        setStorageVal(Constants.LOCAL_FONTSTYLES, window.siyuan.storage[Constants.LOCAL_FONTSTYLES]);
    } else {
        if (localFontStyles.length === 0) {
            type = "style1";
            color = "var(--b3-card-error-color)" + Constants.ZWSP + "var(--b3-card-error-background)";
        } else {
            const fontStyles = localFontStyles[0].split(Constants.ZWSP);
            type = fontStyles.splice(0, 1)[0];
            color = fontStyles.join(Constants.ZWSP);
        }
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
                const colorList = color.split(Constants.ZWSP);
                e.style.backgroundColor = colorList[0];
                e.style.color = colorList[1];
                e.style.setProperty("--b3-parent-background", colorList[0]);
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
        focusByRange(protyle.toolbar.range);
    } else {
        if (type === "clear") {
            protyle.toolbar.setInlineMark(protyle, "clear", "range", {type: "text"});
        } else {
            protyle.toolbar.setInlineMark(protyle, "text", "range", {type, color});
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
            case "style1":
                textElement.style.backgroundColor = textOption.color.split(Constants.ZWSP)[0];
                textElement.style.color = textOption.color.split(Constants.ZWSP)[1];
                break;
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
            return textObj.color.split(Constants.ZWSP)[0] === sideElement.style.color &&
                textObj.color.split(Constants.ZWSP)[1] === sideElement.style.backgroundColor;
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
