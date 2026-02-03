import {hasNextSibling} from "./getBlock";
import {setLastNodeRange} from "../util/selection";
import {updateTransaction} from "./transaction";

export const tabCodeBlock = (protyle: IProtyle, nodeElement: HTMLElement,
                             range: Range, outdent = false) => {
    // https://github.com/siyuan-note/siyuan/issues/12650
    if (!hasNextSibling(range.endContainer) && range.endContainer.textContent.endsWith("\n") && range.endOffset > 0) {
        range.setEnd(range.endContainer, range.endOffset - 1);
    }
    const wbrElement = document.createElement("wbr");
    range.insertNode(wbrElement);
    range.setStartAfter(wbrElement);
    const oldHTML = nodeElement.outerHTML;
    let text = "";
    const tabSpace = window.siyuan.config.editor.codeTabSpaces === 0 ? "\t" : "".padStart(window.siyuan.config.editor.codeTabSpaces, " ");
    if (!outdent) {
        range.extractContents().textContent.split("\n").forEach((item: string) => {
            text += tabSpace + item + "\n";
        });
    } else {
        range.extractContents().textContent.split("\n").forEach((item: string) => {
            if (item.startsWith(tabSpace)) {
                text += item.replace(tabSpace, "") + "\n";
            } else {
                text += item + "\n";
            }
        });
    }
    let language = nodeElement.querySelector(".protyle-action__language").textContent;
    // 语言优先级处理 https://github.com/siyuan-note/siyuan/issues/14767
    if (range.commonAncestorContainer.nodeType === 1) {
        const snippetClassName = (range.commonAncestorContainer as HTMLElement).className;
        if (snippetClassName.startsWith("language-")) {
            language = snippetClassName.replace("language-", "");
            // https://github.com/siyuan-note/siyuan/issues/14767
            if (wbrElement.parentElement !== range.commonAncestorContainer) {
                wbrElement.parentElement.after(wbrElement);
                wbrElement.previousElementSibling.remove();
            }
        }
    }
    if (!window.hljs.getLanguage(language)) {
        language = "plaintext";
    }
    wbrElement.insertAdjacentHTML("afterend", window.hljs.highlight(text.substr(0, text.length - 1), {
        language,
        ignoreIllegals: true
    }).value + "<br>");
    range.setStart(wbrElement.nextSibling, 0);
    const brElement = wbrElement.parentElement.querySelector("br");
    setLastNodeRange(brElement.previousSibling as Element, range, false);
    brElement.remove();
    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
    wbrElement.remove();
};
