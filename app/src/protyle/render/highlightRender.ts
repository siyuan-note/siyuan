import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {focusByOffset} from "../util/selection";
import {setCodeTheme} from "../../util/assets";
import {hasClosestByClassName} from "../util/hasClosest";

export const highlightRender = (element: Element, cdn = Constants.PROTYLE_CDN) => {
    let codeElements: NodeListOf<Element>;
    let isPreview = false;
    if (element.classList.contains("code-block")) {
        // 编辑器内代码块编辑渲染
        codeElements = element.querySelectorAll("[spellcheck]");
    } else {
        if (element.classList.contains("item__readme")) {
            // bazaar reademe
            codeElements = element.querySelectorAll("pre code");
            codeElements.forEach(item => {
                item.parentElement.setAttribute("lineNumber", "false");
            });
        } else if (element.classList.contains("b3-typography")) {
            // preview & export html markdown
            codeElements = element.querySelectorAll(".code-block code");
            isPreview = true;
        } else {
            codeElements = element.querySelectorAll(".code-block [spellcheck]");
        }
    }
    if (codeElements.length === 0) {
        return;
    }

    setCodeTheme(cdn);

    addScript(`${cdn}/js/highlight.js/highlight.min.js?v=11.7.0`, "protyleHljsScript").then(() => {
        addScript(`${cdn}/js/highlight.js/third-languages.js?v=1.0.1`, "protyleHljsThirdScript").then(() => {
            codeElements.forEach((block: HTMLElement) => {
                const iconElements = block.parentElement.querySelectorAll(".protyle-icon");
                if (iconElements.length === 2) {
                    iconElements[0].setAttribute("aria-label", window.siyuan.languages.copy);
                    iconElements[1].setAttribute("aria-label", window.siyuan.languages.more);
                }
                if (block.getAttribute("data-render") === "true") {
                    return;
                }
                const wbrElement = block.querySelector("wbr");
                let startIndex = 0;
                if (wbrElement) {
                    let previousSibling = wbrElement.previousSibling;
                    while (previousSibling) {
                        startIndex += previousSibling.textContent.length;
                        while (!previousSibling.previousSibling && previousSibling.parentElement.tagName !== "DIV") {
                            // 高亮 span 中输入
                            previousSibling = previousSibling.parentElement;
                        }
                        previousSibling = previousSibling.previousSibling;
                    }
                    wbrElement.remove();
                }

                let language;
                if (isPreview) {
                    language = block.parentElement.getAttribute("data-language"); // preview
                } else if (block.previousElementSibling) {
                    language = block.previousElementSibling.firstElementChild.textContent;
                } else {
                    // bazaar readme
                    language = block.className.replace("language-", "");
                }
                if (!hljs.getLanguage(language)) {
                    language = "plaintext";
                }
                block.classList.add("hljs");
                block.setAttribute("data-render", "true");
                const autoEnter = block.parentElement.getAttribute("linewrap");
                const ligatures = block.parentElement.getAttribute("ligatures");
                const lineNumber = block.parentElement.getAttribute("linenumber");
                if (autoEnter === "true" || (autoEnter !== "false" && window.siyuan.config.editor.codeLineWrap)) {
                    block.style.setProperty("white-space", "pre-wrap");
                    block.style.setProperty("word-break", "break-all");
                } else {
                    // https://ld246.com/article/1684031600711 该属性会导致有 tab 后光标跳至末尾，目前无解
                    block.style.setProperty("white-space", "pre");
                    block.style.setProperty("word-break", "initial");
                }
                if (ligatures === "true" || (ligatures !== "false" && window.siyuan.config.editor.codeLigatures)) {
                    block.style.fontVariantLigatures = "normal";
                } else {
                    block.style.fontVariantLigatures = "none";
                }
                const languageElement = block.parentElement.querySelector(".protyle-action__language") as HTMLElement;
                if (!isPreview && (lineNumber === "true" || (lineNumber !== "false" && window.siyuan.config.editor.codeSyntaxHighlightLineNum))) {
                    // 需要先添加 class 以防止抖动 https://ld246.com/article/1648116585443
                    block.classList.add("protyle-linenumber");
                    lineNumberRender(block);
                    if (languageElement) {
                        languageElement.style.marginLeft = "3.6em";
                    }
                } else if (block.nextElementSibling?.classList.contains("protyle-linenumber__rows")) {
                    block.classList.remove("protyle-linenumber");
                    block.nextElementSibling.remove();
                    if (languageElement) {
                        languageElement.style.marginLeft = "";
                    }
                }
                // 搜索定位
                const layoutElement = hasClosestByClassName(block, "search__layout", true);
                if (layoutElement && block.parentElement.getAttribute("data-node-id") === layoutElement.querySelector("#searchList > .b3-list-item--focus")?.getAttribute("data-node-id")) {
                    const matchElement = block.querySelector('span[data-type="search-mark"]');
                    if (matchElement) {
                        matchElement.scrollIntoView();
                    }
                }
                block.innerHTML = hljs.highlight(
                    block.textContent + (block.textContent.endsWith("\n") ? "" : "\n"), // https://github.com/siyuan-note/siyuan/issues/4609
                    {
                        language,
                        ignoreIllegals: true
                    }).value;
                if (wbrElement && getSelection().rangeCount > 0) {
                    focusByOffset(block, startIndex, startIndex);
                }
            });
        });
    });
};

export const lineNumberRender = (block: HTMLElement) => {
    if (block.parentElement.getAttribute("lineNumber") === "false") {
        return;
    }
    if (block.nextElementSibling && block.nextElementSibling.clientHeight === block.clientHeight) {
        return;
    }
    block.classList.add("protyle-linenumber");
    // clientHeight 总是取的整数
    block.parentElement.style.lineHeight = `${((parseInt(block.parentElement.style.fontSize) || window.siyuan.config.editor.fontSize) * 1.625 * 0.85).toFixed(0)}px`;
    const lineNumberTemp = document.createElement("div");
    lineNumberTemp.className = "hljs protyle-linenumber";
    lineNumberTemp.setAttribute("style", `padding-top:0 !important;padding-bottom:0 !important;min-height:auto !important;white-space:${block.style.whiteSpace};word-break:${block.style.wordBreak};font-variant-ligatures:${block.style.fontVariantLigatures};`);
    lineNumberTemp.setAttribute("contenteditable", "true");
    block.insertAdjacentElement("afterend", lineNumberTemp);

    let lineNumberHTML = "";
    const lineList = block.textContent.split(/\r\n|\r|\n|\u2028|\u2029/g);
    if (lineList[lineList.length - 1] === "" && lineList.length > 1) {
        lineList.pop();
    }
    const isWrap = block.style.wordBreak === "break-all";
    lineList.map((line) => {
        let lineHeight = "";
        if (isWrap) {
            lineNumberTemp.textContent = line || "\n";
            // 不能使用 lineNumberTemp.getBoundingClientRect().height.toFixed(1) 否则
            // windows 需等待字体下载完成再计算，否则导致不换行，高度计算错误
            // https://github.com/siyuan-note/siyuan/issues/9029
            // https://github.com/siyuan-note/siyuan/issues/9140
            lineHeight = ` style="height:${lineNumberTemp.clientHeight}px;"`;
        }
        lineNumberHTML += `<span${lineHeight}></span>`;
    });

    lineNumberTemp.remove();
    const height = block.offsetHeight;
    if (block.nextElementSibling?.classList.contains("protyle-linenumber__rows")) {
        block.nextElementSibling.innerHTML = lineNumberHTML;
        (block.nextElementSibling as HTMLElement).style.height = height + "px";
    } else {
        block.insertAdjacentHTML("afterend", `<span contenteditable="false" style="height:${height}px" class="protyle-linenumber__rows">${lineNumberHTML}</span>`);
    }
};
