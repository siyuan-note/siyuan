import {setStorageVal, updateHotkeyTip} from "../util/compatibility";
import {ToolbarItem} from "./ToolbarItem";
import {setPosition} from "../../util/setPosition";
import {focusByRange, getSelectionPosition} from "../util/selection";
import {Constants} from "../../constants";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {updateBatchTransaction} from "../wysiwyg/transaction";

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
    ["var(--b3-font-color1)", "var(--b3-font-color2)", "var(--b3-font-color3)", "var(--b3-font-color4)",
        "var(--b3-font-color5)", "var(--b3-font-color6)", "var(--b3-font-color7)", "var(--b3-font-color8)",
        "var(--b3-font-color9)", "var(--b3-font-color10)", "var(--b3-font-color11)", "var(--b3-font-color12)",
        "var(--b3-font-color13)"].forEach((item) => {
        colorHTML += `<button class="color__square" data-type="color" style="color:${item}">A</button>`;
    });
    let bgHTML = "";
    ["var(--b3-font-background1)", "var(--b3-font-background2)", "var(--b3-font-background3)", "var(--b3-font-background4)",
        "var(--b3-font-background5)", "var(--b3-font-background6)", "var(--b3-font-background7)", "var(--b3-font-background8)",
        "var(--b3-font-background9)", "var(--b3-font-background10)", "var(--b3-font-background11)", "var(--b3-font-background12)",
        "var(--b3-font-background13)"].forEach((item) => {
        bgHTML += `<button class="color__square" data-type="backgroundColor" style="background-color:${item}"></button>`;
    });

    const element = document.createElement("div");
    element.classList.add("protyle-font");
    let lastColorHTML = "";
    const lastFonts = window.siyuan.storage[Constants.LOCAL_FONTSTYLES];
    if (lastFonts.length > 0) {
        lastColorHTML = `<div class="fn__flex">
    ${window.siyuan.languages.lastUsed}
    <span class="fn__space"></span>
    <kbd class="ft__on-surface fn__flex-center">${updateHotkeyTip(window.siyuan.config.keymap.editor.insert.lastUsed.custom)}</kbd>
</div>
<div class="fn__hr--small"></div>
<div class="fn__flex" style="align-items: center">`;
        lastFonts.forEach((item: string) => {
            const lastFontStatus = item.split(Constants.ZWSP);
            switch (lastFontStatus[0]) {
                case "color":
                    lastColorHTML += `<button class="color__square" data-type="${lastFontStatus[0]}" style="color:${lastFontStatus[1]}">A</button>`;
                    break;
                case "backgroundColor":
                    lastColorHTML += `<button class="color__square" data-type="${lastFontStatus[0]}" style="background-color:${lastFontStatus[1]}"></button>`;
                    break;
                case "style2":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="protyle-font__style" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;">${window.siyuan.languages.hollow}</button>`;
                    break;
                case "style4":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="protyle-font__style" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)">${window.siyuan.languages.shadow}</button>`;
                    break;
                case "fontSize":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="protyle-font__style">${lastFontStatus[1]}</button>`;
                    break;
                case "style1":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" style="background-color:${lastFontStatus[1]};color:${lastFontStatus[2]}" class="color__square">A</button>`;
                    break;
                case "clear":
                    lastColorHTML += `<button data-type="${lastFontStatus[0]}" class="protyle-font__style">${window.siyuan.languages.clearFontStyle}</button>`;
                    break;
            }
        });
        lastColorHTML += "</div>";
    }
    let textElement: HTMLElement;
    let fontSize = "16px";
    if (nodeElements && nodeElements.length > 0) {
        textElement = nodeElements[0] as HTMLElement;
    } else {
        textElement = protyle.toolbar.range.cloneContents().querySelector('[data-type~="text"]') as HTMLElement;
        if (!textElement) {
            textElement = hasClosestByAttribute(protyle.toolbar.range.startContainer, "data-type", "text") as HTMLElement;
        }
    }
    if (textElement) {
        fontSize = textElement.style.fontSize || "16px";
    }
    element.innerHTML = `${lastColorHTML}
<div class="fn__hr"></div>
<div>${window.siyuan.languages.color}</div>
<div class="fn__hr--small"></div>
<div class="fn__flex">
    <button class="color__square" data-type="style1" style="color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);">A</button>
    <button class="color__square" data-type="style1" style="color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);">A</button>
    <button class="color__square" data-type="style1" style="color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);">A</button>
    <button class="color__square" data-type="style1" style="color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);">A</button>
</div>
<div class="fn__hr"></div>
<div>${window.siyuan.languages.colorFont}</div>
<div class="fn__hr--small"></div>
<div class="fn__flex">
    ${colorHTML}
</div>
<div class="fn__hr"></div>
<div>${window.siyuan.languages.colorPrimary}</div>
<div class="fn__hr--small"></div>
<div class="fn__flex">
    ${bgHTML}
</div>
<div class="fn__hr"></div>
<div>${window.siyuan.languages.fontStyle}</div>
<div class="fn__hr--small"></div>
<div class="fn__flex">
    <button data-type="style2" class="protyle-font__style" style="-webkit-text-stroke: 0.2px var(--b3-theme-on-background);-webkit-text-fill-color : transparent;">${window.siyuan.languages.hollow}</button>
    <button data-type="style4" class="protyle-font__style" style="text-shadow: 1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)">${window.siyuan.languages.shadow}</button>
</div>
<div class="fn__hr"></div>
<div>${window.siyuan.languages.fontSize}</div>
<div class="fn__hr--small"></div>
<div class="fn__flex">
    <select class="b3-select fn__block">
        <option ${fontSize === "12px" ? "selected" : ""} value="12px">12px</option>
        <option ${fontSize === "13px" ? "selected" : ""} value="13px">13px</option>
        <option ${fontSize === "14px" ? "selected" : ""} value="14px">14px</option>
        <option ${fontSize === "15px" ? "selected" : ""} value="15px">15px</option>
        <option ${fontSize === "16px" ? "selected" : ""} value="16px">16px</option>
        <option ${fontSize === "19px" ? "selected" : ""} value="19px">19px</option>
        <option ${fontSize === "22px" ? "selected" : ""} value="22px">22px</option>
        <option ${fontSize === "24px" ? "selected" : ""} value="24px">24px</option>
        <option ${fontSize === "29px" ? "selected" : ""} value="29px">29px</option>
        <option ${fontSize === "32px" ? "selected" : ""} value="32px">32px</option>
        <option ${fontSize === "40px" ? "selected" : ""} value="40px">40px</option>
        <option ${fontSize === "48px" ? "selected" : ""} value="48px">48px</option>
    </select>
</div>
<div class="fn__hr"></div>
<button class="b3-button b3-button--cancel" data-type="clear">
    <svg><use xlink:href="#iconTrashcan"></use></svg>${window.siyuan.languages.clearFontStyle}
</button>`;
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
    element.querySelector("select").addEventListener("change", function (event: Event) {
        fontEvent(protyle, nodeElements, "fontSize", (event.target as HTMLSelectElement).value);
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
            type = fontStyles[0];
            color = fontStyles[1];
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
            } else if (type === "style1") {
                const colorList = color.split(Constants.ZWSP);
                e.style.backgroundColor = colorList[0];
                e.style.color = colorList[1];
            } else if (type === "style2") {
                e.style.webkitTextStroke = "0.2px var(--b3-theme-on-background)";
                e.style.webkitTextFillColor = "transparent";
            } else if (type === "style4") {
                e.style.textShadow = "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)";
            } else if (type === "color") {
                e.style.color = color;
            } else if (type === "backgroundColor") {
                e.style.backgroundColor = color;
            } else if (type === "fontSize") {
                e.style.fontSize = color;
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
        textElement.setAttribute("data-id", blockRefData.splice(0, 1)[0]);
        textElement.setAttribute("data-subtype", blockRefData.splice(0, 1)[0]);
        textElement.removeAttribute("data-href");
        textElement.innerText = blockRefData.join("");
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
                textElement.removeAttribute("data-subtype");
                textElement.removeAttribute("data-content");
                break;
        }
    }
};

export const hasSameTextStyle = (currentElement: HTMLElement, sideElement: HTMLElement, textObj: ITextOption) => {
    if (!textObj) {
        return true;
    }
    if (textObj.type === "inline-math" || textObj.type === "inline-memo" || textObj.type === "a") {
        return false;
    }
    if (textObj.type === "id") {
        if (currentElement.nodeType !== 3) {
            return currentElement.getAttribute("data-id") === sideElement.getAttribute("data-id") &&
                currentElement.getAttribute("data-subtype") === sideElement.getAttribute("data-subtype") &&
                currentElement.textContent === sideElement.textContent;
        }
        const blockRefData = textObj.color.split(Constants.ZWSP);
        return blockRefData[0] === sideElement.getAttribute("data-id") &&
            blockRefData[1] === sideElement.getAttribute("data-subtype") &&
            blockRefData[2] === sideElement.textContent;
    }

    if (textObj.type === "file-annotation-ref") {
        if (currentElement.nodeType !== 3) {
            return currentElement.getAttribute("data-id") === sideElement.getAttribute("data-id") &&
                currentElement.textContent === sideElement.textContent;
        }
        return textObj.color === sideElement.getAttribute("data-id");
    }

    let color = "";
    let webkitTextFillColor = "";
    let webkitTextStroke = "";
    let textShadow = "";
    let backgroundColor = "";
    let fontSize = "";
    if (currentElement.nodeType !== 3) {
        color = currentElement.style.color;
        webkitTextFillColor = currentElement.style.webkitTextFillColor;
        webkitTextStroke = currentElement.style.webkitTextStroke;
        textShadow = currentElement.style.textShadow;
        backgroundColor = currentElement.style.backgroundColor;
        fontSize = currentElement.style.fontSize;
    }
    if (textObj.type === "text") {
        // 清除样式
        return color === sideElement.style.color &&
            webkitTextFillColor === sideElement.style.webkitTextFillColor &&
            webkitTextStroke === sideElement.style.webkitTextStroke &&
            textShadow === sideElement.style.textShadow &&
            fontSize === sideElement.style.fontSize &&
            backgroundColor === sideElement.style.backgroundColor;
    }
    if (textObj.type === "color") {
        return textObj.color === sideElement.style.color &&
            webkitTextFillColor === sideElement.style.webkitTextFillColor &&
            webkitTextStroke === sideElement.style.webkitTextStroke &&
            textShadow === sideElement.style.textShadow &&
            fontSize === sideElement.style.fontSize &&
            backgroundColor === sideElement.style.backgroundColor;
    }
    if (textObj.type === "backgroundColor") {
        return color === sideElement.style.color &&
            webkitTextFillColor === sideElement.style.webkitTextFillColor &&
            webkitTextStroke === sideElement.style.webkitTextStroke &&
            textShadow === sideElement.style.textShadow &&
            fontSize === sideElement.style.fontSize &&
            textObj.color === sideElement.style.backgroundColor;
    }
    if (textObj.type === "style1") {
        return textObj.color.split(Constants.ZWSP)[0] === sideElement.style.color &&
            webkitTextFillColor === sideElement.style.webkitTextFillColor &&
            webkitTextStroke === sideElement.style.webkitTextStroke &&
            textShadow === sideElement.style.textShadow &&
            fontSize === sideElement.style.fontSize &&
            textObj.color.split(Constants.ZWSP)[1] === sideElement.style.backgroundColor;
    }
    if (textObj.type === "style2") {
        return color === sideElement.style.color &&
            "transparent" === sideElement.style.webkitTextFillColor &&
            "0.2px var(--b3-theme-on-background)" === sideElement.style.webkitTextStroke &&
            textShadow === sideElement.style.textShadow &&
            fontSize === sideElement.style.fontSize &&
            backgroundColor === sideElement.style.backgroundColor;
    }
    if (textObj.type === "style4") {
        return color === sideElement.style.color &&
            webkitTextFillColor === sideElement.style.webkitTextFillColor &&
            webkitTextStroke === sideElement.style.webkitTextStroke &&
            fontSize === sideElement.style.fontSize &&
            "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)" === sideElement.style.textShadow &&
            backgroundColor === sideElement.style.backgroundColor;
    }
    if (textObj.type === "fontSize") {
        return color === sideElement.style.color &&
            webkitTextFillColor === sideElement.style.webkitTextFillColor &&
            webkitTextStroke === sideElement.style.webkitTextStroke &&
            textShadow === sideElement.style.textShadow &&
            textObj.color === sideElement.style.fontSize &&
            backgroundColor === sideElement.style.backgroundColor;
    }
    return true; // 清除字体样式会使用 "text" 作为标识
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
