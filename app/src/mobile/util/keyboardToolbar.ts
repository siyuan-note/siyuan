import {listIndent, listOutdent} from "../../protyle/wysiwyg/list";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByMatchTag
} from "../../protyle/util/hasClosest";
import {moveToDown, moveToUp} from "../../protyle/wysiwyg/move";
import {Constants} from "../../constants";
import {focusByRange, getSelectionPosition} from "../../protyle/util/selection";
import {getCurrentEditor} from "../editor";
import {fontEvent, getFontNodeElements} from "../../protyle/toolbar/Font";
import {hideElements} from "../../protyle/ui/hideElements";
import {softEnter} from "../../protyle/wysiwyg/enter";
import {isInAndroid} from "../../protyle/util/compatibility";

let renderKeyboardToolbarTimeout: number;
let showUtil = false;

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

export const renderTextMenu = (protyle: IProtyle, toolbarElement: Element) => {
    let colorHTML = "";
    ["var(--b3-font-color1)", "var(--b3-font-color2)", "var(--b3-font-color3)", "var(--b3-font-color4)",
        "var(--b3-font-color5)", "var(--b3-font-color6)", "var(--b3-font-color7)", "var(--b3-font-color8)",
        "var(--b3-font-color9)", "var(--b3-font-color10)", "var(--b3-font-color11)", "var(--b3-font-color12)",
        "var(--b3-font-color13)"].forEach((item, index) => {
        colorHTML += `<button class="keyboard__slash-item" data-type="color">
    <span class="keyboard__slash-icon" style="color:${item}">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.colorFont} ${index + 1}</span>
</button>`;
    });
    let bgHTML = "";
    ["var(--b3-font-background1)", "var(--b3-font-background2)", "var(--b3-font-background3)", "var(--b3-font-background4)",
        "var(--b3-font-background5)", "var(--b3-font-background6)", "var(--b3-font-background7)", "var(--b3-font-background8)",
        "var(--b3-font-background9)", "var(--b3-font-background10)", "var(--b3-font-background11)", "var(--b3-font-background12)",
        "var(--b3-font-background13)"].forEach((item, index) => {
        bgHTML += `<button class="keyboard__slash-item" data-type="backgroundColor">
    <span class="keyboard__slash-icon" style="background-color:${item}">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.colorPrimary} ${index + 1}</span>
</button>`;
    });

    const nodeElements = getFontNodeElements(protyle);
    let disableFont = false;
    nodeElements?.find((item: HTMLElement) => {
        if (item.classList.contains("list") || item.classList.contains("li")) {
            disableFont = true;
            return true;
        }
    });

    let lastColorHTML = "";
    const lastFonts = window.siyuan.storage[Constants.LOCAL_FONTSTYLES];
    if (lastFonts.length > 0) {
        lastColorHTML = `<div class="keyboard__slash-title">
    ${window.siyuan.languages.lastUsed}
</div>
<div class="keyboard__slash-block">`;
        lastFonts.forEach((item: string) => {
            const lastFontStatus = item.split(Constants.ZWSP);
            switch (lastFontStatus[0]) {
                case "color":
                    lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-icon" style="color:${lastFontStatus[1]}">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.colorFont} ${parseInt(lastFontStatus[1].replace("var(--b3-font-color", "")) + 1}</span>
</button>`;
                    break;
                case "backgroundColor":
                    lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-icon" style="background-color:${lastFontStatus[1]}">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages.colorPrimary} ${parseInt(lastFontStatus[1].replace("var(--b3-font-background", "")) + 1}</span>
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
                    lastColorHTML += `<button class="keyboard__slash-item" data-type="${lastFontStatus[0]}">
    <span class="keyboard__slash-icon" style="background-color:${lastFontStatus[1]};color:${lastFontStatus[2]}">A</span>
    <span class="keyboard__slash-text">${window.siyuan.languages[lastFontStatus[2].replace("var(--b3-card-", "").replace("-color)", "") + "Style"]}</span>
</button>`;
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
    const utilElement = toolbarElement.querySelector(".keyboard__util") as HTMLElement;
    utilElement.innerHTML = `${lastColorHTML}
<div class="keyboard__slash-title">${window.siyuan.languages.color}</div>
<div class="keyboard__slash-block">
    <button class="keyboard__slash-item" data-type="style1">
        <span class="keyboard__slash-icon" style="color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);">A</span>
        <span class="keyboard__slash-text">${window.siyuan.languages.errorStyle}</span>
    </button>
    <button class="keyboard__slash-item" data-type="style1">
        <span class="keyboard__slash-icon" style="color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);">A</span>
        <span class="keyboard__slash-text">${window.siyuan.languages.warningStyle}</span>
    </button>
    <button class="keyboard__slash-item" data-type="style1">
        <span class="keyboard__slash-icon" style="color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);">A</span>
        <span class="keyboard__slash-text">${window.siyuan.languages.infoStyle}</span>
    </button>
    <button class="keyboard__slash-item" data-type="style1">
        <span class="keyboard__slash-icon" style="color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);">A</span>
        <span class="keyboard__slash-text">${window.siyuan.languages.successStyle}</span>
    </button>
</div>
<div class="keyboard__slash-title">${window.siyuan.languages.colorFont}</div>
<div class="keyboard__slash-block">
    ${colorHTML}
</div>
<div class="keyboard__slash-title">${window.siyuan.languages.colorPrimary}</div>
<div class="keyboard__slash-block">
    ${bgHTML}
</div>
<div class="keyboard__slash-title">${window.siyuan.languages.fontStyle}</div>
<div class="keyboard__slash-block">
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
<div class="keyboard__slash-title${disableFont ? " fn__none" : ""}">${window.siyuan.languages.fontSize}</div>
<div class="keyboard__slash-block${disableFont ? " fn__none" : ""}">
    <select class="b3-select fn__block" style="width: calc(50% - 8px);margin: 4px 0 8px 0;">
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
</div>`;
    utilElement.querySelector("select").addEventListener("change", function (event: Event) {
        fontEvent(protyle, nodeElements, "fontSize", (event.target as HTMLSelectElement).value);
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
    const utilElement = toolbarElement.querySelector(".keyboard__util") as HTMLElement;
    utilElement.innerHTML = `<div class="keyboard__slash-title"></div>
<div class="keyboard__slash-block">
    ${getSlashItem(Constants.ZWSP, "iconMarkdown", window.siyuan.languages.template)}
    ${getSlashItem(Constants.ZWSP + 1, "iconBoth", window.siyuan.languages.widget)}
    ${getSlashItem(Constants.ZWSP + 2, "iconImage", window.siyuan.languages.assets)}
    ${getSlashItem("((", "iconRef", window.siyuan.languages.ref, "true")}
    ${getSlashItem("{{", "iconSQL", window.siyuan.languages.blockEmbed, "true")}
    ${getSlashItem(Constants.ZWSP + 5, "iconSparkles", "AI Chat")}
    ${getSlashItem('<div data-type="NodeAttributeView" data-av-type="table"></div>', "iconDatabase", window.siyuan.languages.database, "true")}
    ${getSlashItem(Constants.ZWSP + 4, "iconFile", window.siyuan.languages.newSubDocRef)}
</div>
<div class="keyboard__slash-title"></div>
<div class="keyboard__slash-block">
    ${getSlashItem(Constants.ZWSP + 3, "iconDownload", window.siyuan.languages.insertAsset + '<input class="b3-form__upload" type="file"' + (protyle.options.upload.accept ? (' multiple="' + protyle.options.upload.accept + '"') : "") + "/>", "true")}
    ${isInAndroid() ? getSlashItem(Constants.ZWSP + 3, "iconCamera", window.siyuan.languages.insertPhoto + '<input class="b3-form__upload" capture="user" type="file"' + (protyle.options.upload.accept ? (' multiple="' + protyle.options.upload.accept + '"') : "") + "/>", "true") : ""}
    ${getSlashItem('<iframe sandbox="allow-forms allow-presentation allow-same-origin allow-scripts allow-modals" src="" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>', "iconLanguage", window.siyuan.languages.insertIframeURL, "true")}
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
    ${getSlashItem("* " + Lute.Caret, "iconList", window.siyuan.languages.list, "true")}
    ${getSlashItem("1. " + Lute.Caret, "iconOrderedList", window.siyuan.languages["ordered-list"], "true")}
    ${getSlashItem("* [ ] " + Lute.Caret, "iconCheck", window.siyuan.languages.check, "true")}
    ${getSlashItem("> " + Lute.Caret, "iconQuote", window.siyuan.languages.quote, "true")}
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
    ${getSlashItem(`style${Constants.ZWSP}color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);`, '<div style="color: var(--b3-card-info-color);background-color: var(--b3-card-info-background);" class="keyboard__slash-icon">A</div>', window.siyuan.languages.infoStyle, "true")}
    ${getSlashItem(`style${Constants.ZWSP}color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);`, '<div style="color: var(--b3-card-success-color);background-color: var(--b3-card-success-background);" class="keyboard__slash-icon">A</div>', window.siyuan.languages.successStyle, "true")}
    ${getSlashItem(`style${Constants.ZWSP}color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);`, '<div style="color: var(--b3-card-warning-color);background-color: var(--b3-card-warning-background);" class="keyboard__slash-icon">A</div>', window.siyuan.languages.warningStyle, "true")}
    ${getSlashItem(`style${Constants.ZWSP}color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);`, '<div style="color: var(--b3-card-error-color);background-color: var(--b3-card-error-background);" class="keyboard__slash-icon">A</div>', window.siyuan.languages.errorStyle, "true")}
    ${getSlashItem(`style${Constants.ZWSP}`, '<div class="keyboard__slash-icon">A</div>', window.siyuan.languages.clearFontStyle, "true")}
</div>${pluginHTML}`;
    protyle.hint.bindUploadEvent(protyle, utilElement);
};

export const showKeyboardToolbarUtil = (oldScrollTop: number) => {
    window.siyuan.menus.menu.remove();
    showUtil = true;

    const toolbarElement = document.getElementById("keyboardToolbar");
    let keyboardHeight = toolbarElement.getAttribute("data-keyboardheight");
    keyboardHeight = (keyboardHeight ? (parseInt(keyboardHeight) + 42) : window.outerHeight / 2) + "px";
    const editor = getCurrentEditor();
    if (editor) {
        editor.protyle.element.parentElement.style.paddingBottom = keyboardHeight;
        editor.protyle.contentElement.scrollTop = oldScrollTop;
    }
    setTimeout(() => {
        toolbarElement.style.height = keyboardHeight;
    }, Constants.TIMEOUT_TRANSITION); // 防止抖动
    setTimeout(() => {
        showUtil = false;
    }, 1000);   // 防止光标改变后斜杆菜单消失
};

const hideKeyboardToolbarUtil = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.style.height = "";
    const editor = getCurrentEditor();
    if (editor) {
        editor.protyle.element.parentElement.style.paddingBottom = "42px";
    }
    toolbarElement.querySelector('.keyboard__action[data-type="add"]').classList.remove("protyle-toolbar__item--current");
    toolbarElement.querySelector('.keyboard__action[data-type="text"]').classList.remove("protyle-toolbar__item--current");
    toolbarElement.querySelector('.keyboard__action[data-type="done"] use').setAttribute("xlink:href", "#iconKeyboardHide");
};

const renderKeyboardToolbar = () => {
    clearTimeout(renderKeyboardToolbarTimeout);
    renderKeyboardToolbarTimeout = window.setTimeout(() => {
        if (getSelection().rangeCount === 0 ||
            window.siyuan.config.readonly ||
            document.getElementById("toolbarName").getAttribute("readonly") === "readonly" ||
            window.screen.height - window.innerHeight < 160 ||  // reloadSync 会导致 selectionchange，从而导致键盘没有弹起的情况下出现工具栏
            !document.activeElement || (
                document.activeElement &&
                !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) &&
                !document.activeElement.classList.contains("protyle-wysiwyg") &&
                document.activeElement.getAttribute("contenteditable") !== "true"
            )) {
            hideKeyboardToolbar();
            return;
        }
        // 编辑器设置界面点击空白或关闭，焦点不知何故会飘移到编辑器上
        if (document.activeElement &&
            !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) && (
                document.getElementById("menu").style.transform === "translateX(0px)" ||
                document.getElementById("model").style.transform === "translateY(0px)"
            )) {
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
        if (!isProtyle) {
            dynamicElements[0].classList.add("fn__none");
            dynamicElements[1].classList.add("fn__none");
            return;
        }

        const selectText = range.toString();
        if (selectText || dynamicElements[0].querySelector('[data-type="goinline"]').classList.contains("protyle-toolbar__item--current")) {
            dynamicElements[0].classList.add("fn__none");
            dynamicElements[1].classList.remove("fn__none");
        } else {
            dynamicElements[0].classList.remove("fn__none");
            dynamicElements[1].classList.add("fn__none");
        }

        const protyle = getCurrentEditor().protyle;
        if (!dynamicElements[0].classList.contains("fn__none")) {
            if (protyle.undo.undoStack.length === 0) {
                dynamicElements[0].querySelector('[data-type="undo"]').setAttribute("disabled", "disabled");
            } else {
                dynamicElements[0].querySelector('[data-type="undo"]').removeAttribute("disabled");
            }
            if (protyle.undo.redoStack.length === 0) {
                dynamicElements[0].querySelector('[data-type="redo"]').setAttribute("disabled", "disabled");
            } else {
                dynamicElements[0].querySelector('[data-type="redo"]').removeAttribute("disabled");
            }
            const nodeElement = hasClosestBlock(range.startContainer);
            if (nodeElement) {
                const outdentElement = dynamicElements[0].querySelector('[data-type="outdent"]');
                if (nodeElement.parentElement.classList.contains("li")) {
                    outdentElement.classList.remove("fn__none");
                    outdentElement.nextElementSibling.classList.remove("fn__none");
                } else {
                    outdentElement.classList.add("fn__none");
                    outdentElement.nextElementSibling.classList.add("fn__none");
                }
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
    if (!toolbarElement.classList.contains("fn__none")) {
        return;
    }
    toolbarElement.classList.remove("fn__none");
    toolbarElement.style.zIndex = (++window.siyuan.zIndex).toString();
    const modelElement = document.getElementById("model");
    if (modelElement.style.transform === "translateY(0px)") {
        modelElement.style.paddingBottom = "42px";
    }
    const range = getSelection().getRangeAt(0);
    const editor = getCurrentEditor();
    if (editor && editor.protyle.wysiwyg.element.contains(range.startContainer)) {
        editor.protyle.element.parentElement.style.paddingBottom = "42px";
    }
    getCurrentEditor().protyle.app.plugins.forEach(item => {
        item.eventBus.emit("mobile-keyboard-show");
    });
    setTimeout(() => {
        const contentElement = hasClosestByClassName(range.startContainer, "protyle-content", true);
        if (contentElement) {
            const contentTop = contentElement.getBoundingClientRect().top;
            const cursorTop = getSelectionPosition(contentElement).top;
            if (cursorTop < window.innerHeight - 42 && cursorTop > contentTop) {
                return;
            }
            contentElement.scroll({
                top: contentElement.scrollTop + cursorTop - window.innerHeight + 42 + 26,
                left: contentElement.scrollLeft,
                behavior: "smooth"
            });
        }
    }, Constants.TIMEOUT_TRANSITION);
};

export const hideKeyboardToolbar = () => {
    if (showUtil) {
        return;
    }
    const toolbarElement = document.getElementById("keyboardToolbar");
    if (toolbarElement.classList.contains("fn__none")) {
        return;
    }
    toolbarElement.classList.add("fn__none");
    toolbarElement.style.height = "";
    const editor = getCurrentEditor();
    if (editor) {
        editor.protyle.element.parentElement.style.paddingBottom = "";
    }
    const modelElement = document.getElementById("model");
    if (modelElement.style.transform === "translateY(0px)") {
        modelElement.style.paddingBottom = "";
    }
    getCurrentEditor().protyle.app.plugins.forEach(item => {
        item.eventBus.emit("mobile-keyboard-hide");
    });
};

export const activeBlur = () => {
    (document.activeElement as HTMLElement).blur();
};

export const initKeyboardToolbar = () => {
    let preventRender = false;
    document.addEventListener("selectionchange", () => {
        if (!preventRender) {
            renderKeyboardToolbar();
        }
    }, false);

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
            <button class="keyboard__action" data-type="tag"><svg><use xlink:href="#iconTags"></use></svg></button>
            <button class="keyboard__action" data-type="inline-math"><svg><use xlink:href="#iconMath"></use></svg></button>
            <button class="keyboard__action" data-type="inline-memo"><svg><use xlink:href="#iconM"></use></svg></button>
            <button class="keyboard__action" data-type="goback"><svg><use xlink:href="#iconCloseRound"></use></svg></button>
        </div>
    </div>
    <span class="keyboard__split"></span>
    <button class="keyboard__action" data-type="done"><svg style="width: 36px"><use xlink:href="#iconKeyboardHide"></use></svg></button>
</div>
<div class="keyboard__util"></div>`;
    toolbarElement.addEventListener("click", (event) => {
        const protyle = getCurrentEditor()?.protyle;
        const target = event.target as HTMLElement;
        const slashBtnElement = hasClosestByClassName(event.target as HTMLElement, "keyboard__slash-item");
        if (slashBtnElement && !slashBtnElement.getAttribute("data-type")) {
            const dataValue = decodeURIComponent(slashBtnElement.getAttribute("data-value"));
            protyle.hint.fill(dataValue, protyle, false);   // 点击后 range 会改变
            if (dataValue !== Constants.ZWSP + 3) {
                event.preventDefault();
                event.stopPropagation();
            }
            if (slashBtnElement.getAttribute("data-focus") === "true") {
                focusByRange(protyle.toolbar.range);
            }
            return;
        }
        const buttonElement = hasClosestByMatchTag(target, "BUTTON");
        if (!buttonElement || buttonElement.getAttribute("disabled")) {
            return;
        }
        const type = buttonElement.getAttribute("data-type");
        // appearance
        if (["clear", "style2", "style4", "color", "backgroundColor", "fontSize", "style1"].includes(type)) {
            const nodeElements = getFontNodeElements(protyle);
            const itemElement = buttonElement.firstElementChild as HTMLElement;
            if (type === "style1") {
                fontEvent(protyle, nodeElements, type, itemElement.style.backgroundColor + Constants.ZWSP + itemElement.style.color);
            } else if (type === "fontSize") {
                fontEvent(protyle, nodeElements, type, itemElement.textContent.trim());
            } else if (type === "backgroundColor") {
                fontEvent(protyle, nodeElements, type, itemElement.style.backgroundColor);
            } else if (type === "color") {
                fontEvent(protyle, nodeElements, type, itemElement.style.color);
            } else {
                fontEvent(protyle, nodeElements, type);
            }
        }

        event.preventDefault();
        event.stopPropagation();
        if (getSelection().rangeCount === 0) {
            return;
        }

        const range = getSelection().getRangeAt(0);
        if (type === "done") {
            if (toolbarElement.clientHeight > 100) {
                hideKeyboardToolbarUtil();
                focusByRange(range);
            } else {
                activeBlur();
                hideKeyboardToolbar();
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
            }
            return;
        } else if (type === "moveup") {
            moveToUp(protyle, nodeElement, range);
            focusByRange(range);
            return;
        } else if (type === "movedown") {
            moveToDown(protyle, nodeElement, range);
            focusByRange(range);
            return;
        } else if (type === "softLine") {
            range.extractContents();
            softEnter(range, nodeElement, protyle);
            focusByRange(range);
            return;
        } else if (type === "add") {
            if (buttonElement.classList.contains("protyle-toolbar__item--current")) {
                hideKeyboardToolbarUtil();
                focusByRange(range);
            } else {
                buttonElement.classList.add("protyle-toolbar__item--current");
                toolbarElement.querySelector('.keyboard__action[data-type="done"] use').setAttribute("xlink:href", "#iconCloseRound");
                const oldScrollTop = protyle.contentElement.scrollTop;
                renderSlashMenu(protyle, toolbarElement);
                showKeyboardToolbarUtil(oldScrollTop);
            }
            return;
        } else if (type === "block") {
            protyle.gutter.renderMenu(protyle, nodeElement);
            window.siyuan.menus.menu.fullscreen();
            activeBlur();
            hideKeyboardToolbar();
            return;
        } else if (type === "outdent") {
            listOutdent(protyle, [nodeElement.parentElement], range);
            focusByRange(range);
            return;
        } else if (type === "indent") {
            listIndent(protyle, [nodeElement.parentElement], range);
            focusByRange(range);
            return;
        }
    });
};
