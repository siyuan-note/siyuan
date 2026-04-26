import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {focusByOffset} from "../util/selection";
import {setCodeTheme} from "./util";
import {escapeHtml} from "../../util/escape";

type ShikiModule = typeof import("./shikiInit");

const isShikiEngine = () => {
    return window.siyuan.config.appearance.codeBlockEngine === "shiki";
};

const getLanguageFromBlock = (block: HTMLElement, isPreview: boolean): string => {
    let language: string;
    if (isPreview) {
        language = block.parentElement.getAttribute("data-language");
    } else if (block.previousElementSibling) {
        language = block.previousElementSibling.firstElementChild.textContent;
    } else {
        // bazaar readme
        language = block.className.replace("language-", "");
    }
    return language;
};

const applyBlockStyles = (block: HTMLElement, hljsElement: HTMLElement) => {
    const autoEnter = block.parentElement.getAttribute("linewrap");
    const ligatures = block.parentElement.getAttribute("ligatures");
    if (autoEnter === "true" || (autoEnter !== "false" && window.siyuan.config.editor.codeLineWrap)) {
        hljsElement.style.setProperty("white-space", "pre-wrap");
        hljsElement.style.setProperty("word-break", "break-word");
    } else {
        hljsElement.style.setProperty("white-space", "pre");
        hljsElement.style.setProperty("word-break", "initial");
    }
    if (ligatures === "true" || (ligatures !== "false" && window.siyuan.config.editor.codeLigatures)) {
        hljsElement.style.fontVariantLigatures = "normal";
    } else {
        hljsElement.style.fontVariantLigatures = "none";
    }
};

const applyLineNumbers = (block: HTMLElement, isPreview: boolean, zoom: number) => {
    const lineNumber = block.parentElement.getAttribute("linenumber");
    if (block.firstElementChild) {
        if (!isPreview && (lineNumber === "true" || (lineNumber !== "false" && window.siyuan.config.editor.codeSyntaxHighlightLineNum))) {
            block.firstElementChild.className = "protyle-linenumber__rows";
            block.firstElementChild.setAttribute("contenteditable", "false");
            lineNumberRender(block, zoom);
            block.style.display = "";
        } else {
            block.firstElementChild.className = "fn__none";
            block.firstElementChild.innerHTML = "";
            (block.lastElementChild as HTMLElement).style.paddingLeft = "";
            block.style.display = "block";
        }
    }
};

const renderBlockHljs = (block: HTMLElement, isPreview: boolean, zoom: number) => {
    const wbrElement = block.querySelector("wbr");
    let startIndex = 0;
    if (wbrElement) {
        let previousSibling = wbrElement.previousSibling;
        while (previousSibling) {
            startIndex += previousSibling.textContent.length;
            while (!previousSibling.previousSibling && previousSibling.parentElement.tagName !== "DIV") {
                previousSibling = previousSibling.parentElement;
            }
            previousSibling = previousSibling.previousSibling;
        }
        wbrElement.remove();
    }

    let language = getLanguageFromBlock(block, isPreview);
    if (!window.hljs.getLanguage(language)) {
        language = "plaintext";
    }
    block.classList.add("hljs");
    const hljsElement = block.lastElementChild ? block.lastElementChild as HTMLElement : block;
    applyBlockStyles(block, hljsElement);
    const codeText = hljsElement.textContent;
    applyLineNumbers(block, isPreview, zoom);
    hljsElement.innerHTML = window.hljs.highlight(
        codeText + (codeText.endsWith("\n") ? "" : "\n"),
        {
            language,
            ignoreIllegals: true
        }).value;
    if (wbrElement && getSelection().rangeCount > 0) {
        focusByOffset(block, startIndex, startIndex);
    }
};

const renderBlockShiki = async (block: HTMLElement, isPreview: boolean, zoom: number, shiki: ShikiModule) => {
    const wbrElement = block.querySelector("wbr");
    let startIndex = 0;
    if (wbrElement) {
        let previousSibling = wbrElement.previousSibling;
        while (previousSibling) {
            startIndex += previousSibling.textContent.length;
            while (!previousSibling.previousSibling && previousSibling.parentElement.tagName !== "DIV") {
                previousSibling = previousSibling.parentElement;
            }
            previousSibling = previousSibling.previousSibling;
        }
        wbrElement.remove();
    }

    let language = getLanguageFromBlock(block, isPreview);
    language = await shiki.ensureShikiLang(language);

    block.classList.add("hljs");
    const hljsElement = block.lastElementChild ? block.lastElementChild as HTMLElement : block;
    applyBlockStyles(block, hljsElement);
    const codeText = hljsElement.textContent;
    applyLineNumbers(block, isPreview, zoom);
    const result = shiki.shikiHighlight(
        codeText + (codeText.endsWith("\n") ? "" : "\n"),
        language
    );
    hljsElement.innerHTML = result.html;
    // Apply Shiki theme background and foreground colors
    if (result.bg) {
        block.style.backgroundColor = result.bg;
    }
    if (result.fg) {
        block.style.color = result.fg;
    }
    if (wbrElement && getSelection().rangeCount > 0) {
        focusByOffset(block, startIndex, startIndex);
    }
};

export const highlightRender = (element: Element, cdn = Constants.PROTYLE_CDN, zoom = 1) => {
    let codeElements: NodeListOf<Element>;
    let isPreview = false;
    if (element.classList.contains("code-block")) {
        // 编辑器内代码块编辑渲染
        codeElements = element.querySelectorAll(".hljs");
    } else {
        if (element.classList.contains("item__readme")) {
            // bazaar reademe
            codeElements = element.querySelectorAll("pre code");
            codeElements.forEach(item => {
                item.parentElement.setAttribute("linenumber", "false");
            });
        } else if (element.classList.contains("b3-typography")) {
            // preview & export html markdown
            codeElements = element.querySelectorAll(".code-block code");
            isPreview = true;
        } else {
            codeElements = element.querySelectorAll(".code-block .hljs");
        }
    }
    if (codeElements.length === 0) {
        return;
    }

    setCodeTheme(cdn);

    if (isShikiEngine()) {
        import(/* webpackChunkName: "shiki-init" */ "./shikiInit").then((shiki) => {
            return shiki.initShiki().then(() => shiki);
        }).then((shiki) => {
            codeElements.forEach((block: HTMLElement) => {
                if (block.getAttribute("data-render") === "true") {
                    return;
                }
                block.setAttribute("data-render", "true");
                const iconElements = block.parentElement.querySelectorAll(".protyle-icon");
                if (iconElements.length === 2) {
                    iconElements[0].setAttribute("aria-label", window.siyuan.languages.copy);
                    iconElements[1].setAttribute("aria-label", window.siyuan.languages.more);
                }
                renderBlockShiki(block, isPreview, zoom, shiki);
            });
        });
    } else {
        addScript(`${cdn}/js/highlight.js/highlight.min.js?v=11.11.1`, "protyleHljsScript").then(() => {
            addScript(`${cdn}/js/highlight.js/third-languages.js?v=2.0.1`, "protyleHljsThirdScript").then(() => {
                codeElements.forEach((block: HTMLElement) => {
                    if (block.getAttribute("data-render") === "true") {
                        return;
                    }
                    block.setAttribute("data-render", "true");
                    const iconElements = block.parentElement.querySelectorAll(".protyle-icon");
                    if (iconElements.length === 2) {
                        iconElements[0].setAttribute("aria-label", window.siyuan.languages.copy);
                        iconElements[1].setAttribute("aria-label", window.siyuan.languages.more);
                    }
                    renderBlockHljs(block, isPreview, zoom);
                });
            });
        });
    }
};

export const lineNumberRender = (hljsElement: HTMLElement, zoom = 1) => {
    const lineNumber = hljsElement.parentElement.getAttribute("lineNumber");
    if (lineNumber === "false") {
        return;
    }
    if (!window.siyuan.config.editor.codeSyntaxHighlightLineNum && lineNumber !== "true") {
        return;
    }
    const codeElement = hljsElement.lastElementChild as HTMLElement;
    if (hljsElement.firstElementChild.clientHeight === codeElement.clientHeight && codeElement.style.wordBreak !== "break-word") {
        return;
    }
    // clientHeight 总是取的整数
    hljsElement.parentElement.style.lineHeight = `${((parseInt(hljsElement.parentElement.style.fontSize) || window.siyuan.config.editor.fontSize) * 1.625 * 0.85).toFixed(0)}px`;
    const lineList = codeElement.textContent.split(/\r\n|\r|\n|\u2028|\u2029/g);
    if (lineList[lineList.length - 1] === "" && lineList.length > 1) {
        lineList.pop();
    }
    hljsElement.firstElementChild.innerHTML = `<span>${lineList.length}</span>`;
    codeElement.style.paddingLeft = `${hljsElement.firstElementChild.clientWidth + 16}px`;
    let lineNumberHTML = "";
    if (codeElement.style.wordBreak === "break-word") {
        // 代码块开启了换行
        const codeElementStyle = window.getComputedStyle(codeElement);
        const lineNumberTemp = document.createElement("div");
        lineNumberTemp.className = "hljs";
        // 不能使用 codeElement.clientWidth，被忽略小数点导致宽度不一致
        // 需要手动复制字体样式 https://ld246.com/article/1762527296449
        lineNumberTemp.innerHTML = `<div contenteditable="true" style="padding-left:${codeElement.style.paddingLeft};
width: ${codeElement.getBoundingClientRect().width / zoom}px;
white-space:${codeElementStyle.whiteSpace};
word-break:${codeElementStyle.wordBreak};
font-variant-ligatures:${codeElementStyle.fontVariantLigatures};
font-family:${codeElementStyle.fontFamily};
font-size:${codeElementStyle.fontSize};
line-height:${codeElementStyle.lineHeight};
font-weight:${codeElementStyle.fontWeight};
padding-right:0;max-height: none;box-sizing: border-box;position: absolute;padding-top:0 !important;padding-bottom:0 !important;min-height:auto !important;"></div>`;
        lineNumberTemp.firstElementChild.innerHTML = lineList.map(line =>
            `<div>${line.trim() ? escapeHtml(line) : "&nbsp;" }</div>`
        ).join("");
        hljsElement.insertAdjacentElement("afterend", lineNumberTemp);

        const childNodes = lineNumberTemp.firstElementChild.children;
        for (let i = 0; i < childNodes.length; i++) {
            lineNumberHTML += `<span style="height:${childNodes[i].clientHeight}px"></span>`;
        }
        lineNumberTemp.remove();
    } else {
        lineNumberHTML = "<span></span>".repeat(lineList.length);
    }
    hljsElement.firstElementChild.innerHTML = lineNumberHTML;
    // https://github.com/siyuan-note/siyuan/issues/12726
    if (hljsElement.scrollHeight > hljsElement.clientHeight) {
        if (getSelection().rangeCount > 0) {
            const range = getSelection().getRangeAt(0);
            if (hljsElement.contains(range.startContainer)) {
                const brElement = document.createElement("br");
                range.insertNode(brElement);
                brElement.scrollIntoView({block: "nearest"});
                brElement.remove();
            }
        }
    }
};
