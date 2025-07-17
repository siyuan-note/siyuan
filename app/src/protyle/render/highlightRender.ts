import {addScript} from "../util/addScript";
import {Constants} from "../../constants";
import {focusByOffset} from "../util/selection";
import {setCodeTheme} from "../../util/assets";

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

    addScript(`${cdn}/js/highlight.js/highlight.min.js?v=11.11.1`, "protyleHljsScript").then(() => {
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
                if (!window.hljs.getLanguage(language)) {
                    language = "plaintext";
                }
                block.classList.add("hljs");
                block.setAttribute("data-render", "true");
                const autoEnter = block.parentElement.getAttribute("linewrap");
                const ligatures = block.parentElement.getAttribute("ligatures");
                const lineNumber = block.parentElement.getAttribute("linenumber");
                const hljsElement = block.lastElementChild ? block.lastElementChild as HTMLElement : block;
                if (autoEnter === "true" || (autoEnter !== "false" && window.siyuan.config.editor.codeLineWrap)) {
                    hljsElement.style.setProperty("white-space", "pre-wrap");
                    hljsElement.style.setProperty("word-break", "break-word");
                } else {
                    // https://ld246.com/article/1684031600711 该属性会导致有 tab 后光标跳至末尾，目前无解
                    hljsElement.style.setProperty("white-space", "pre");
                    hljsElement.style.setProperty("word-break", "initial");
                }
                if (ligatures === "true" || (ligatures !== "false" && window.siyuan.config.editor.codeLigatures)) {
                    hljsElement.style.fontVariantLigatures = "normal";
                } else {
                    hljsElement.style.fontVariantLigatures = "none";
                }
                const codeText = hljsElement.textContent;
                if (block.firstElementChild) {
                    if (!isPreview && (lineNumber === "true" || (lineNumber !== "false" && window.siyuan.config.editor.codeSyntaxHighlightLineNum))) {
                        // 需要先添加 class 以防止抖动 https://ld246.com/article/1648116585443
                        block.firstElementChild.className = "protyle-linenumber__rows";
                        block.firstElementChild.setAttribute("contenteditable", "false");
                        lineNumberRender(block, zoom);
                        block.style.display = "";
                    } else {
                        block.firstElementChild.className = "fn__none";
                        block.firstElementChild.innerHTML = "";
                        hljsElement.style.paddingLeft = "";
                        block.style.display = "block";
                    }
                }
                hljsElement.innerHTML = window.hljs.highlight(
                    codeText + (codeText.endsWith("\n") ? "" : "\n"), // https://github.com/siyuan-note/siyuan/issues/4609
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

// 添加一个 Map 来跟踪正在渲染的代码块，用于停止前一次调用
const renderingBlocks = new Map<HTMLElement, symbol>();

export const lineNumberRender = (block: HTMLElement, zoom = 1) => {
    const lineNumber = block.parentElement.getAttribute("lineNumber");
    if (lineNumber === "false") {
        return;
    }
    if (!window.siyuan.config.editor.codeSyntaxHighlightLineNum && lineNumber !== "true") {
        return;
    }

    // 生成唯一 token，配合下方循环内的检查，实现“如果更新这个 block 的行号的过程中又对这个 block 调用了 lineNumberRender，则立即停止本次函数执行不继续更新行号，执行新一次 lineNumberRender 来更新行号”
    const renderToken = Symbol();
    renderingBlocks.set(block, renderToken);

    try {
        // clientHeight 总是取的整数
        block.parentElement.style.lineHeight = `${((parseInt(block.parentElement.style.fontSize) || window.siyuan.config.editor.fontSize) * 1.625 * 0.85).toFixed(0)}px`;
        const codeElement = block.lastElementChild as HTMLElement;

        const lineList = codeElement.textContent.split(/\r\n|\r|\n|\u2028|\u2029/g);
        if (lineList[lineList.length - 1] === "" && lineList.length > 1) {
            lineList.pop();
        }

        if (codeElement.style.wordBreak === "break-word") {
            // 代码块开启了换行
            const codeElementStyle = window.getComputedStyle(codeElement);
            const lineNumberTemp = document.createElement("div");
            lineNumberTemp.className = "hljs";
            // 不能使用 codeElement.clientWidth，被忽略小数点导致宽度不一致
            lineNumberTemp.setAttribute("style", `padding-left:${codeElement.style.paddingLeft};
width: ${codeElement.getBoundingClientRect().width / zoom}px;
white-space:${codeElementStyle.whiteSpace};
word-break:${codeElementStyle.wordBreak};
font-variant-ligatures:${codeElementStyle.fontVariantLigatures};
padding-right:0;max-height: none;box-sizing: border-box;position: absolute;padding-top:0 !important;padding-bottom:0 !important;min-height:auto !important;`);
            lineNumberTemp.setAttribute("contenteditable", "true");
            block.insertAdjacentElement("afterend", lineNumberTemp);

            // TODO 1 检查 block.firstElementChild 的 span 子元素数量（行号元素的数量），如果多了就在末尾移除多余的，如果少了就在末尾插入缺少的
            const existingSpans = block.firstElementChild.querySelectorAll("span");
            const expectedSpanCount = lineList.length;
            if (existingSpans.length > expectedSpanCount) {
                // 移除多余的 span 元素 - 使用 DocumentFragment 批量操作
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < expectedSpanCount; i++) {
                    fragment.appendChild(existingSpans[i]);
                }
                // 检查是否被中断
                if (renderingBlocks.get(block) !== renderToken) {
                    lineNumberTemp.remove();
                    return;
                }
                block.firstElementChild.innerHTML = "";
                block.firstElementChild.appendChild(fragment);
            } else if (existingSpans.length < expectedSpanCount) {
                // 插入缺少的 span 元素
                const missingCount = expectedSpanCount - existingSpans.length;
                const newSpansHTML = "<span></span>".repeat(missingCount);
                block.firstElementChild.insertAdjacentHTML("beforeend", newSpansHTML);
            }

            // TODO 2 然后逐个行号元素更新 span.style.height = `${height}px`;
            //  另外，看看更新 height 之前是否需要检查原始值与更新值不相等，看看性能怎么样
            // TODO 3 如果更新这个 block 的行号的过程中又对这个 block 调用了 lineNumberRender，则立即停止本次函数执行不继续更新行号，执行新一次 lineNumberRender 来更新行号
            const currentSpans = block.firstElementChild.querySelectorAll("span");
            for (let index = 0; index < lineList.length; index++) {
                // 检查是否被中断（即有新一次 lineNumberRender 调用）
                if (renderingBlocks.get(block) !== renderToken) {
                    lineNumberTemp.remove();
                    return;
                }
                const line = lineList[index];
                if (index < currentSpans.length) {
                    const span = currentSpans[index] as HTMLElement;
                    // windows 下空格高度为 0 https://github.com/siyuan-note/siyuan/issues/12346
                    lineNumberTemp.textContent = line.trim() ? line : "<br>";
                    // 不能使用 lineNumberTemp.getBoundingClientRect().height.toFixed(1) 否则
                    // windows 需等待字体下载完成再计算，否则导致不换行，高度计算错误
                    // https://github.com/siyuan-note/siyuan/issues/9029
                    // https://github.com/siyuan-note/siyuan/issues/9140
                    const newHeight = lineNumberTemp.clientHeight;
                    // 检查原始值与更新值是否相等，避免不必要的样式更新
                    const currentHeight = parseInt(span.style.height) || 0;
                    if (currentHeight !== newHeight) {
                        span.style.height = `${newHeight}px`;
                    }
                }
            }
            lineNumberTemp.remove();
        } else {
            // TODO 看看获取行号元素数量需要消耗多少时间
            //  如果性能够好，则行号元素数量有变化的话才执行：
            const existingSpans = block.firstElementChild.querySelectorAll("span");
            if (existingSpans.length !== lineList.length) {
                block.firstElementChild.innerHTML = "<span></span>".repeat(lineList.length);
            }
        }

        // 在行号更新完毕后再计算宽度
        const finalSpans = block.firstElementChild.querySelectorAll("span");
        if (finalSpans.length > 0) {
            // 使用最后一个行号元素来计算宽度
            const lastSpan = finalSpans[finalSpans.length - 1] as HTMLElement;
            lastSpan.textContent = lineList.length.toString();
            codeElement.style.paddingLeft = `${block.firstElementChild.clientWidth + 16}px`;
            lastSpan.textContent = ""; // 恢复为空字符串
        }

        // https://github.com/siyuan-note/siyuan/issues/12726
        if (block.scrollHeight > block.clientHeight) {
            if (getSelection().rangeCount > 0) {
                const range = getSelection().getRangeAt(0);
                if (block.contains(range.startContainer)) {
                    const brElement = document.createElement("br");
                    range.insertNode(brElement);
                    brElement.scrollIntoView({block: "nearest"});
                    brElement.remove();
                }
            }
        }
    } finally {
        // 只清理当前 token，防止误删后续渲染的 token
        if (renderingBlocks.get(block) === renderToken) {
            renderingBlocks.delete(block);
        }
    }
};
