import {Divider} from "./Divider";
import {Font} from "./Font";
import {ToolbarItem} from "./ToolbarItem";
import {
    focusByRange,
    focusByWbr,
    focusSideBlock,
    getEditorRange,
    getSelectionOffset,
    getSelectionPosition, setFirstNodeRange, setLastNodeRange
} from "../util/selection";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName, hasClosestByMatchTag} from "../util/hasClosest";
import {Link} from "./Link";
import {setPosition} from "../../util/setPosition";
import {updateTransaction} from "../wysiwyg/transaction";
import {Constants} from "../../constants";
import {mathRender} from "../markdown/mathRender";
import {getEventName} from "../util/compatibility";
import {upDownHint} from "../../util/upDownHint";
import {highlightRender} from "../markdown/highlightRender";
import {
    getContenteditableElement,
    hasNextSibling,
    hasPreviousSibling
} from "../wysiwyg/getBlock";
import {processRender} from "../util/processCode";
import {BlockRef} from "./BlockRef";
import {hintMoveBlock, hintRef, hintRenderAssets, hintRenderTemplate, hintRenderWidget} from "../hint/extend";
import {blockRender} from "../markdown/blockRender";
/// #if !BROWSER
import {clipboard, nativeImage, NativeImage} from "electron";
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {fetchPost} from "../../util/fetch";
import {isBrowser, isMobile} from "../../util/functions";
import * as dayjs from "dayjs";
import {insertEmptyBlock} from "../../block/util";
import {matchHotKey} from "../util/hotKey";
import {unicode2Emoji} from "../../emoji";
import {escapeHtml} from "../../util/escape";
import {hideElements} from "../ui/hideElements";
import {linkMenu} from "../../menus/protyle";

export class Toolbar {
    public element: HTMLElement;
    public subElement: HTMLElement;
    public range: Range;
    public isNewEmptyInline: boolean;
    private toolbarHeight: number;

    constructor(protyle: IProtyle) {
        const options = protyle.options;

        const element = document.createElement("div");
        element.className = "protyle-toolbar fn__none";
        this.element = element;
        this.subElement = document.createElement("div");
        this.subElement.className = "protyle-util fn__none";
        this.toolbarHeight = 29;

        options.toolbar.forEach((menuItem: IMenuItem) => {
            const itemElement = this.genItem(protyle, menuItem);
            this.element.appendChild(itemElement);
        });
        this.isNewEmptyInline = false;
    }

    public render(protyle: IProtyle, range: Range, event?: KeyboardEvent) {
        this.range = range;
        const nodeElement = hasClosestBlock(range.startContainer);
        if (!nodeElement || protyle.disabled) {
            this.element.classList.add("fn__none");
            return;
        }
        // shift+方向键或三击选中，不同的块 https://github.com/siyuan-note/siyuan/issues/3891
        const startElement = hasClosestBlock(range.startContainer);
        const endElement = hasClosestBlock(range.endContainer);
        if (startElement && endElement && !startElement.isSameNode(endElement)) {
            if (event) { // 在 keyup 中使用 shift+方向键选中
                if (event.key === "ArrowLeft") {
                    this.range = setLastNodeRange(getContenteditableElement(startElement), range, false);
                } else {
                    this.range = setFirstNodeRange(getContenteditableElement(endElement), range);
                }
            } else {
                this.range = setLastNodeRange(getContenteditableElement(nodeElement), range, false);
            }
            focusByRange(this.range);
            if (this.range.toString() === "") {
                this.element.classList.add("fn__none");
                return;
            }
        }
        // 需放在 range 修改之后，否则 https://github.com/siyuan-note/siyuan/issues/4726
        if (nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
            this.element.classList.add("fn__none");
            return;
        }
        const rangePosition = getSelectionPosition(nodeElement, range);
        this.element.classList.remove("fn__none");
        setPosition(this.element, rangePosition.left - 52, rangePosition.top - this.toolbarHeight - 4);
        this.element.querySelectorAll(".protyle-toolbar__item--current").forEach(item => {
            item.classList.remove("protyle-toolbar__item--current");
        });
        const types = this.getCurrentType();
        types.forEach(item => {
            if (item === "blockRef") {
                return;
            }
            this.element.querySelector(`[data-type="${item}"]`).classList.add("protyle-toolbar__item--current");
        });
    }

    public getCurrentType(range = this.range) {
        const types: string[] = [];
        let startElement = range.startContainer as HTMLElement;
        if (startElement.nodeType === 3) {
            startElement = startElement.parentElement;
            if (startElement.getAttribute("data-type") === "virtual-block-ref" && !["DIV", "TD", "TH"].includes(startElement.parentElement.tagName)) {
                startElement = startElement.parentElement;
            }
        } else if (startElement.childElementCount > 0 && startElement.childNodes[range.startOffset]?.nodeType !== 3) {
            startElement = startElement.childNodes[range.startOffset] as HTMLElement;
        }
        if (!startElement || startElement.nodeType === 3) {
            return [];
        }
        let endElement = range.endContainer as HTMLElement;
        if (endElement.nodeType === 3) {
            endElement = endElement.parentElement;
            if (endElement.getAttribute("data-type") === "virtual-block-ref" && !["DIV", "TD", "TH"].includes(endElement.parentElement.tagName)) {
                endElement = endElement.parentElement;
            }
        } else if (endElement.childElementCount > 0 && endElement.childNodes[range.endOffset]?.nodeType !== 3) {
            endElement = endElement.childNodes[range.endOffset] as HTMLElement;
        }
        if (!endElement || endElement.nodeType === 3) {
            return [];
        }
        if (range.startOffset === range.startContainer.textContent.length) {
            const nextSibling = hasNextSibling(range.startContainer as Element);
            if (nextSibling && nextSibling.nodeType !== 3 && (nextSibling as Element).getAttribute("data-type") === "inline-math") {
                types.push("inline-math");
            }
        } else if (range.endOffset === 0) {
            const previousSibling = hasPreviousSibling(range.startContainer as Element);
            if (previousSibling && previousSibling.nodeType !== 3 && (previousSibling as Element).getAttribute("data-type") === "inline-math") {
                types.push("inline-math");
            }
        }
        if (startElement.tagName === "STRONG" || endElement.tagName === "STRONG") {
            types.push("bold");
        }
        if (startElement.tagName === "EM" || endElement.tagName === "EM") {
            types.push("italic");
        }
        if (startElement.tagName === "U" || endElement.tagName === "U") {
            types.push("underline");
        }
        if (startElement.tagName === "S" || endElement.tagName === "S") {
            types.push("strike");
        }
        if (startElement.tagName === "MARK" || endElement.tagName === "MARK") {
            types.push("mark");
        }
        if (startElement.tagName === "SUP" || endElement.tagName === "SUP") {
            types.push("sup");
        }
        if (startElement.tagName === "SUB" || endElement.tagName === "SUB") {
            types.push("sub");
        }
        if (startElement.tagName === "KBD" || endElement.tagName === "KBD") {
            types.push("kbd");
        }
        if (startElement.tagName === "SPAN" || endElement.tagName === "SPAN") {
            const startType = startElement.getAttribute("data-type");
            const endType = endElement.getAttribute("data-type");
            if (startType === "tag" || endType === "tag") {
                types.push("tag");
            } else if (startType === "a" || endType === "a") {
                types.push("link");
            } else if (startType === "block-ref" || endType === "block-ref") {
                types.push("blockRef");
            } else if (startType === "file-annotation-ref" || endType === "file-annotation-ref") {
                types.push("blockRef");
            } else if (startType === "inline-math") {
                types.push("inline-math");
            }
        }
        if (startElement.tagName === "CODE" || endElement.tagName === "CODE") {
            types.push("inline-code");
        }
        return types;
    }

    private genItem(protyle: IProtyle, menuItem: IMenuItem) {
        let menuItemObj;
        switch (menuItem.name) {
            case "bold":
            case "italic":
            case "strike":
            case "inline-code":
            case "mark":
            case "tag":
            case "underline":
            case "sup":
            case "sub":
            case "kbd":
            case "inline-math":
                menuItemObj = new ToolbarItem(protyle, menuItem);
                break;
            case "blockRef":
                menuItemObj = new BlockRef(protyle, menuItem);
                break;
            case "|":
                menuItemObj = new Divider();
                break;
            case "font":
                menuItemObj = new Font(protyle, menuItem);
                break;
            case "link":
                menuItemObj = new Link(protyle, menuItem);
                break;
        }
        if (!menuItemObj) {
            return;
        }
        return menuItemObj.element;
    }

    private pushNode(newNodes: Node[], element: Element | DocumentFragment) {
        element.childNodes.forEach((item: Element) => {
            if (item.nodeType !== 3 && (
                (item.getAttribute("data-type") === "inline-math" && item.textContent !== "") ||
                item.tagName === "BR" || item.getAttribute("data-type") === "backslash"
            )) {
                // 软换行、数学公式、转移符不能消失
                newNodes.push(item.cloneNode(true));
            } else {
                if (item.textContent === "") {
                    return;
                }
                newNodes.push(document.createTextNode(item.textContent));
            }
        });
    }

    public async setInlineMark(protyle: IProtyle, type: string, action: "remove" | "add" | "range" | "toolbar", focusAdd = false) {
        const nodeElement = hasClosestBlock(this.range.startContainer);
        if (!nodeElement) {
            return;
        }
        const types = this.getCurrentType();
        if (action === "add" && types.length > 0 && types.includes(type) && !focusAdd) {
            if (type === "link") {
                this.element.classList.add("fn__none");
                linkMenu(protyle, this.range.startContainer.parentElement);
                const rect = this.range.startContainer.parentElement.getBoundingClientRect();
                setPosition(window.siyuan.menus.menu.element, rect.left, rect.top + 13, 26);
            }
            return;
        }
        // 对已有字体样式的文字再次添加字体样式
        if (focusAdd && action === "add" && types.includes("bold") && this.range.startContainer.nodeType === 3 &&
            this.range.startContainer.parentNode.isSameNode(this.range.endContainer.parentNode)) {
            return;
        }
        let startElement = this.range.startContainer as Element;
        if (this.range.startContainer.nodeType === 3) {
            startElement = this.range.startContainer.parentElement;
            if (startElement.getAttribute("data-type") === "virtual-block-ref" && !["DIV", "TD", "TH"].includes(startElement.parentElement.tagName)) {
                startElement = startElement.parentElement;
            }
        }

        // table 选中处理
        const tableElement = hasClosestByAttribute(startElement, "data-type", "NodeTable");
        if (this.range.toString() !== "" && tableElement && this.range.commonAncestorContainer.nodeType !== 3) {
            const parentTag = (this.range.commonAncestorContainer as Element).tagName;
            if (parentTag !== "TH" && parentTag !== "TD") {
                const startCellElement = hasClosestByMatchTag(startElement, "TD") || hasClosestByMatchTag(startElement, "TH");
                const endCellElement = hasClosestByMatchTag(this.range.endContainer, "TD") || hasClosestByMatchTag(this.range.endContainer, "TH");
                if (!startCellElement && !endCellElement) {
                    const cellElement = tableElement.querySelector("th") || tableElement.querySelector("td");
                    this.range.setStartBefore(cellElement.firstChild);
                    this.range.setEndAfter(cellElement.lastChild);
                    startElement = cellElement;
                } else if (startCellElement &&
                    // 不能包含自身元素，否则对 cell 中的部分文字两次高亮后就会选中整个 cell。 https://github.com/siyuan-note/siyuan/issues/3649 第二点
                    !startCellElement.contains(this.range.endContainer)) {
                    const cloneRange = this.range.cloneRange();
                    this.range.setEndAfter(startCellElement.lastChild);
                    if (this.range.toString() === "" && endCellElement) {
                        this.range.setEnd(cloneRange.endContainer, cloneRange.endOffset);
                        this.range.setStartBefore(endCellElement.lastChild);
                    }
                    if (this.range.toString() === "") {
                        return;
                    }
                }
            }
        }

        if (this.range.toString() === "" && action === "range" && getSelectionOffset(startElement, protyle.wysiwyg.element).end === startElement.textContent.length &&
            this.range.startContainer.nodeType === 3 && !this.range.startContainer.parentElement.getAttribute("contenteditable") &&
            types.length > 0) {
            // 跳出行内元素
            const textNode = document.createTextNode(Constants.ZWSP);
            this.range.startContainer.parentElement.after(textNode);
            this.range.selectNodeContents(textNode);
            this.range.collapse(false);
            if (types.includes(type)) {
                // 如果不是同一种行内元素，需进行后续的渲染操作
                return;
            }
        }
        if (types.length > 0 && types.includes("link") && action === "range") {
            // 链接快捷键不应取消，应该显示链接信息
            linkMenu(protyle, this.range.startContainer.parentElement);
            const rect = this.range.startContainer.parentElement.getBoundingClientRect();
            setPosition(window.siyuan.menus.menu.element, rect.left, rect.top + 13, 26);
            return;
        }
        const wbrElement = document.createElement("wbr");
        this.range.insertNode(wbrElement);
        this.range.setStartAfter(wbrElement);
        const html = nodeElement.outerHTML;
        const actionBtn = action === "toolbar" ? this.element.querySelector(`[data-type="${type}"]`) : undefined;
        // 光标前标签移除
        const newNodes: Node[] = [];
        let startText = "";
        if (!["DIV", "TD", "TH"].includes(startElement.tagName)) {
            startText = startElement.textContent;
            this.pushNode(newNodes, startElement);
            startElement.remove();
        }
        // 光标后标签移除
        let endText = "";
        let endClone;
        if (!this.range.startContainer.isSameNode(this.range.endContainer)) {
            let endElement = this.range.endContainer as HTMLElement;
            if (this.range.endContainer.nodeType === 3) {
                endElement = this.range.endContainer.parentElement;
            }
            if (endElement.getAttribute("data-type") === "virtual-block-ref" && !["DIV", "TD", "TH"].includes(endElement.parentElement.tagName)) {
                endElement = endElement.parentElement;
            }
            if (!["DIV", "TD", "TH"].includes(endElement.tagName)) {
                endClone = endElement;
            }
        }
        const selectContents = this.range.extractContents();
        this.pushNode(newNodes, selectContents);
        if (endClone) {
            endText = endClone.textContent;
            this.pushNode(newNodes, endClone);
            endClone.remove();
        }
        if ((action === "toolbar" && actionBtn.classList.contains("protyle-toolbar__item--current")) ||
            action === "remove" || (action === "range" && types.length > 0 && types.includes(type))) {
            // 移除
            if (type === "inline-math" && newNodes.length === 1) {
                const textNode = document.createTextNode(newNodes[0].textContent);
                this.range.insertNode(textNode);
                this.range.selectNodeContents(textNode);
            } else {
                newNodes.forEach((item, index) => {
                    this.range.insertNode(item);
                    if (index !== newNodes.length - 1) {
                        this.range.collapse(false);
                    } else {
                        this.range.setEnd(item, item.textContent.length);
                    }
                });
                if (newNodes.length > 0) {
                    this.range.setStart(newNodes[0], 0);
                }
            }
            focusByRange(this.range);
            this.element.querySelectorAll(".protyle-toolbar__item--current").forEach(item => {
                item.classList.remove("protyle-toolbar__item--current");
            });
        } else {
            if (newNodes.length === 0) {
                newNodes.push(document.createTextNode(Constants.ZWSP));
            }
            // 添加
            let newElement: Element;
            const refText = startText + selectContents.textContent + endText;
            const refNode = document.createTextNode(refText);
            switch (type) {
                case "bold":
                    newElement = document.createElement("strong");
                    break;
                case "underline":
                    newElement = document.createElement("u");
                    break;
                case "italic":
                    newElement = document.createElement("em");
                    break;
                case "strike":
                    newElement = document.createElement("s");
                    break;
                case "inline-code":
                    newElement = document.createElement("code");
                    break;
                case "mark":
                    newElement = document.createElement("mark");
                    break;
                case "sup":
                    newElement = document.createElement("sup");
                    break;
                case "sub":
                    newElement = document.createElement("sub");
                    break;
                case "kbd":
                    newElement = document.createElement("kbd");
                    break;
                case "tag":
                    newElement = document.createElement("span");
                    newElement.setAttribute("data-type", "tag");
                    break;
                case "link":
                    newElement = document.createElement("span");
                    newElement.setAttribute("data-type", "a");
                    break;
                case "blockRef":
                    if (refText === "") {
                        wbrElement.remove();
                        return;
                    }
                    this.range.insertNode(refNode);
                    this.range.selectNodeContents(refNode);
                    hintRef(refText, protyle, true);
                    break;
                case "inline-math":
                    newElement = document.createElement("span");
                    newElement.className = "render-node";
                    newElement.setAttribute("contenteditable", "false");
                    newElement.setAttribute("data-type", "inline-math");
                    newElement.setAttribute("data-subtype", "math");
                    newElement.setAttribute("data-content", startText + selectContents.textContent + endText);
                    mathRender(newElement);
                    break;
            }
            if (newElement) {
                this.range.insertNode(newElement);
            }
            if (type === "inline-math") {
                this.range.setStartAfter(newElement);
                this.range.collapse(true);
                if (startText + selectContents.textContent + endText === "") {
                    this.showRender(protyle, newElement as HTMLElement);
                } else {
                    focusByRange(this.range);
                }
                this.element.classList.add("fn__none");
            } else if (type !== "blockRef") {
                newNodes.forEach(item => {
                    newElement.append(item);
                });
                if (newElement.textContent === Constants.ZWSP) {
                    this.isNewEmptyInline = true;
                    this.range.setStart(newElement.firstChild, 1);
                    this.range.collapse(true);
                } else {
                    if (!hasPreviousSibling(newElement)) {
                        // 列表内斜体后的最后一个字符无法选中 https://ld246.com/article/1629787455575
                        const nextSibling = hasNextSibling(newElement);
                        if (nextSibling && nextSibling.nodeType === 3) {
                            const textContent = nextSibling.textContent;
                            nextSibling.textContent = "";
                            nextSibling.textContent = textContent;
                        }
                    }
                    this.range.setStart(newElement.firstChild, 0);
                    this.range.setEnd(newElement.lastChild, newElement.lastChild.textContent.length);
                    focusByRange(this.range);
                }
                if (type === "link") {
                    let needShowLink = true;
                    let focusText = false;
                    try {
                        const clipText = await navigator.clipboard.readText();
                        // 选中链接时需忽略剪切板内容 https://ld246.com/article/1643035329737
                        if (protyle.lute.IsValidLinkDest(this.range.toString().trim())) {
                            (newElement as HTMLElement).setAttribute("data-href", this.range.toString().trim());
                            needShowLink = false;
                        } else if (protyle.lute.IsValidLinkDest(clipText)) {
                            (newElement as HTMLElement).setAttribute("data-href", clipText);
                            if (newElement.textContent.replace(Constants.ZWSP, "") !== "") {
                                needShowLink = false;
                            }
                            focusText = true;
                        }
                    } catch (e) {
                        console.log(e);
                    }
                    if (needShowLink) {
                        linkMenu(protyle, newElement as HTMLElement, focusText);
                        const rect = newElement.getBoundingClientRect();
                        setPosition(window.siyuan.menus.menu.element, rect.left, rect.top + 13, 26);
                    }
                }
            }
            if (actionBtn) {
                this.element.querySelectorAll(".protyle-toolbar__item--current").forEach(item => {
                    item.classList.remove("protyle-toolbar__item--current");
                });
                actionBtn.classList.add("protyle-toolbar__item--current");
            }
        }
        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
        wbrElement.remove();
    }

    public showFileAnnotationRef(protyle: IProtyle, refElement: HTMLElement) {
        const nodeElement = hasClosestBlock(refElement);
        if (!nodeElement) {
            return;
        }
        const id = nodeElement.getAttribute("data-node-id");
        let html = nodeElement.outerHTML;
        this.subElement.style.width = isMobile() ? "80vw" : Math.min(480, window.innerWidth) + "px";
        this.subElement.style.padding = "";
        this.subElement.innerHTML = `<div class="b3-form__space--small">
<label class="fn__flex">
    <span class="ft__on-surface fn__flex-center" style="width: 64px">ID</span>
    <div class="fn__space"></div>
    <input data-type="id" value="${refElement.getAttribute("data-id") || ""}" class="b3-text-field fn__block" readonly />
</label>
<div class="fn__hr"></div>
<label class="fn__flex">
    <span class="ft__on-surface fn__flex-center" style="width: 64px">${window.siyuan.languages.anchor}</span>
    <div class="fn__space"></div>
    <input data-type="anchor" class="b3-text-field fn__block" placeholder="${window.siyuan.languages.anchor}" />
</label>
<div class="fn__hr"></div>
<div class="fn__hr"></div>
<div class="fn__flex"><span class="fn__flex-1"></span>
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.remove}</button>
</div></div>`;
        this.subElement.querySelector(".b3-button--cancel").addEventListener(getEventName(), () => {
            refElement.insertAdjacentHTML("afterend", "<wbr>");
            const oldHTML = nodeElement.outerHTML;
            refElement.outerHTML = refElement.textContent;
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            this.subElement.classList.add("fn__none");
            focusByWbr(nodeElement, this.range);
        });
        const anchorElement = this.subElement.querySelector('[data-type="anchor"]') as HTMLInputElement;
        if (refElement.getAttribute("data-subtype") === "s") {
            anchorElement.value = refElement.textContent;
        }
        anchorElement.addEventListener("change", (event) => {
            refElement.after(document.createElement("wbr"));
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            html = nodeElement.outerHTML;
            nodeElement.querySelector("wbr").remove();
            event.stopPropagation();
        });
        anchorElement.addEventListener("input", (event) => {
            const target = event.target as HTMLInputElement;
            if (target.value) {
                refElement.innerHTML = Lute.EscapeHTMLStr(target.value);
            } else {
                refElement.innerHTML = "*";
            }
            event.stopPropagation();
        });
        anchorElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            if (event.key === "Enter" || event.key === "Escape") {
                this.subElement.classList.add("fn__none");
                this.range.setStart(refElement.firstChild, 0);
                this.range.setEnd(refElement.lastChild, refElement.lastChild.textContent.length);
                focusByRange(this.range);
                event.preventDefault();
                event.stopPropagation();
            }
        });
        this.subElement.classList.remove("fn__none");
        const nodeRect = refElement.getBoundingClientRect();
        setPosition(this.subElement, nodeRect.left, nodeRect.bottom, nodeRect.height + 4);
        this.element.classList.add("fn__none");
        anchorElement.select();
    }

    public showRender(protyle: IProtyle, renderElement: Element) {
        const nodeElement = hasClosestBlock(renderElement);
        if (!nodeElement) {
            return;
        }
        const id = nodeElement.getAttribute("data-node-id");
        const type = renderElement.getAttribute("data-type");
        let html = nodeElement.outerHTML;
        let title = "HTML";
        let placeholder = "";
        switch (renderElement.getAttribute("data-subtype")) {
            case "abc":
                title = window.siyuan.languages.staff;
                break;
            case "echarts":
                title = window.siyuan.languages.chart;
                break;
            case "flowchart":
                title = "Flow Chart";
                break;
            case "graphviz":
                title = "Graphviz";
                break;
            case "mermaid":
                title = "Mermaid";
                break;
            case "mindmap":
                placeholder = `- foo
  - bar
- baz`;
                title = window.siyuan.languages.mindmap;
                break;
            case "plantuml":
                title = "UML";
                break;
            case "math":
                if (type === "NodeMathBlock") {
                    title = window.siyuan.languages.math;
                } else {
                    title = window.siyuan.languages["inline-math"];
                }
                break;
        }
        if (type === "NodeBlockQueryEmbed") {
            title = window.siyuan.languages.blockEmbed;
        }
        const isPin = this.subElement.querySelector('[data-type="pin"]')?.classList.contains("ft__primary");
        const pinData: IObject = {};
        if (isPin) {
            const textElement = this.subElement.querySelector(".b3-text-field") as HTMLTextAreaElement;
            pinData.styleH = textElement.style.height;
            pinData.styleW = textElement.style.width;
        } else {
            this.subElement.style.width = "";
            this.subElement.style.padding = "0";
        }
        this.subElement.innerHTML = `<div ${(isPin && this.subElement.firstElementChild.getAttribute("data-drag") === "true") ? 'data-drag="true"' : ""} class="block__popover--move"><div class="block__icons block__icons--border fn__flex">
    ${title}
    <span class="fn__flex-1"></span>
    <label aria-label="${window.siyuan.languages.hideHeadingBelowBlocks}" style="overflow:inherit;" class="b3-tooltips b3-tooltips__nw${type !== "NodeBlockQueryEmbed" ? " fn__none" : ""}">
        <input type="checkbox" class="b3-switch">
        <span class="fn__space"></span>
    </label>
    <button data-type="refresh" class="block__icon b3-tooltips b3-tooltips__nw${(isPin && !this.subElement.querySelector('[data-type="refresh"]').classList.contains("ft__primary")) ? "" : " ft__primary"}${type === "NodeBlockQueryEmbed" ? " fn__none" : ""}" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href="#iconRefresh"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="before" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages["insert-before"]}"><svg><use xlink:href="#iconBefore"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="after" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages["insert-after"]}"><svg><use xlink:href="#iconAfter"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="copy" class="block__icon b3-tooltips b3-tooltips__nw${isBrowser() ? " fn__none" : ""}" aria-label="${window.siyuan.languages.copy} PNG"><svg><use xlink:href="#iconCopy"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="pin" class="block__icon b3-tooltips b3-tooltips__nw${isPin ? " ft__primary" : ""}" aria-label="${window.siyuan.languages.pin}"><svg><use xlink:href="#iconPin"></use></svg></button>
    <span class="fn__space"></span>
    <button data-type="close" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.close}"><svg style="width: 10px"><use xlink:href="#iconClose"></use></svg></button>
</div>
<textarea spellcheck="false" class="b3-text-field b3-text-field--text fn__block" placeholder="${placeholder}" style="width:${isMobile() ? "80vw" : Math.max(480, renderElement.clientWidth * 0.7) + "px"};max-height:50vh"></textarea></div>`;
        const autoHeight = () => {
            textElement.style.height = textElement.scrollHeight + "px";
            if (this.subElement.firstElementChild.getAttribute("data-drag") === "true") {
                if (textElement.getBoundingClientRect().bottom > window.innerHeight) {
                    this.subElement.style.top = window.innerHeight - this.subElement.clientHeight + "px";
                }
                return;
            }
            if (this.subElement.clientHeight <= window.innerHeight - nodeRect.bottom || this.subElement.clientHeight <= nodeRect.top) {
                if (type === "inline-math") {
                    setPosition(this.subElement, nodeRect.left, nodeRect.bottom, nodeRect.height);
                } else {
                    setPosition(this.subElement, nodeRect.left + (nodeRect.width - this.subElement.clientWidth) / 2, nodeRect.bottom, nodeRect.height);
                }
            } else {
                setPosition(this.subElement, nodeRect.right, nodeRect.bottom);
            }
        };
        this.subElement.querySelector(".block__icons").addEventListener("click", (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const btnElement = hasClosestByClassName(target, "b3-tooltips");
            if (!btnElement) {
                return;
            }
            event.stopPropagation();
            switch (btnElement.getAttribute("data-type")) {
                case "close":
                    this.subElement.classList.add("fn__none");
                    this.subElement.querySelector('[data-type="pin"]').classList.remove("ft__primary");
                    break;
                case "pin":
                    btnElement.classList.toggle("ft__primary");
                    break;
                case "refresh":
                    btnElement.classList.toggle("ft__primary");
                    break;
                case "before":
                    insertEmptyBlock(protyle, "beforebegin", id);
                    hideElements(["util"], protyle);
                    break;
                case "after":
                    insertEmptyBlock(protyle, "afterend", id);
                    hideElements(["util"], protyle);
                    break;
                case "copy":
                    /// #if !BROWSER
                    hideElements(["util"], protyle);
                    setTimeout(() => {
                        const rect = renderElement.getBoundingClientRect();
                        getCurrentWindow().webContents.capturePage({
                            x: Math.floor(rect.x),
                            y: Math.floor(rect.y) - 4, // 行内数学公式头部截不到
                            width: Math.floor(rect.width),
                            height: Math.floor(rect.height) + 4
                        }).then((image: NativeImage) => {
                            clipboard.writeImage(nativeImage.createFromBuffer(image.toPNG()));
                        });
                    }, 100);
                    /// #endif
                    break;
            }
        });
        this.subElement.querySelector(".block__icons").addEventListener("mousedown", (event: MouseEvent) => {
            if (hasClosestByClassName(event.target as HTMLElement, "block__icon")) {
                return;
            }
            const documentSelf = document;
            this.subElement.style.userSelect = "none";
            const dragBgElement = documentSelf.querySelector("#dragBg");
            dragBgElement.classList.remove("fn__none");
            const x = event.clientX - parseInt(this.subElement.style.left);
            const y = event.clientY - parseInt(this.subElement.style.top);
            setTimeout(() => {
                // windows 需等待 dragBgElement 显示后才可以进行 move https://github.com/siyuan-note/siyuan/issues/2950
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    let positionX = moveEvent.clientX - x;
                    let positionY = moveEvent.clientY - y;
                    if (positionX > window.innerWidth - this.subElement.clientWidth) {
                        positionX = window.innerWidth - this.subElement.clientWidth;
                    }
                    if (positionY > window.innerHeight - this.subElement.clientHeight) {
                        positionY = window.innerHeight - this.subElement.clientHeight;
                    }
                    this.subElement.style.left = Math.max(positionX, 0) + "px";
                    this.subElement.style.top = Math.max(positionY, Constants.SIZE_TOOLBAR_HEIGHT) + "px";
                    this.subElement.firstElementChild.setAttribute("data-drag", "true");
                };

                documentSelf.onmouseup = () => {
                    this.subElement.style.userSelect = "auto";
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    dragBgElement.classList.add("fn__none");
                };
            });
            return;
        });
        const textElement = this.subElement.querySelector(".b3-text-field") as HTMLTextAreaElement;
        if (type === "NodeHTMLBlock") {
            textElement.value = Lute.UnEscapeHTMLStr(renderElement.querySelector("protyle-html").getAttribute("data-content") || "");
        } else {
            const switchElement = this.subElement.querySelector(".b3-switch") as HTMLInputElement;
            if (nodeElement.getAttribute("custom-heading-mode") === "1") {
                switchElement.checked = true;
            }
            switchElement.addEventListener("change", () => {
                hideElements(["util"], protyle);
                nodeElement.setAttribute("custom-heading-mode", switchElement.checked ? "1" : "0");
                fetchPost("/api/attr/setBlockAttrs", {
                    id,
                    attrs: {"custom-heading-mode": switchElement.checked ? "1" : "0"}
                });
                renderElement.removeAttribute("data-render");
                blockRender(protyle, renderElement);
            });
            textElement.value = Lute.UnEscapeHTMLStr(renderElement.getAttribute("data-content") || "");
        }
        textElement.addEventListener("input", (event) => {
            if (!renderElement.parentElement) {
                return;
            }
            if (textElement.clientHeight !== textElement.scrollHeight) {
                autoHeight();
            }
            if (!this.subElement.querySelector('[data-type="refresh"]').classList.contains("ft__primary")) {
                return;
            }
            const target = event.target as HTMLTextAreaElement;
            if (type === "NodeHTMLBlock") {
                renderElement.querySelector("protyle-html").setAttribute("data-content", Lute.EscapeHTMLStr(target.value));
            } else {
                renderElement.setAttribute("data-content", Lute.EscapeHTMLStr(target.value));
                renderElement.removeAttribute("data-render");
            }
            if (!["NodeBlockQueryEmbed", "NodeHTMLBlock"].includes(type)) {
                processRender(renderElement);
            }

            event.stopPropagation();
        });
        textElement.addEventListener("change", (event) => {
            if (!renderElement.parentElement) {
                return;
            }
            if (!this.subElement.querySelector('[data-type="refresh"]').classList.contains("ft__primary")) {
                const target = event.target as HTMLTextAreaElement;
                if (type === "NodeHTMLBlock") {
                    renderElement.querySelector("protyle-html").setAttribute("data-content", Lute.EscapeHTMLStr(target.value));
                } else {
                    renderElement.setAttribute("data-content", Lute.EscapeHTMLStr(target.value));
                    renderElement.removeAttribute("data-render");
                }
                if (!["NodeBlockQueryEmbed", "NodeHTMLBlock"].includes(type)) {
                    processRender(renderElement);
                }
            }
            if (type === "NodeBlockQueryEmbed") {
                blockRender(protyle, renderElement);
            }
            if (this.range) {
                focusByRange(this.range);
            }
            if (type === "inline-math") {
                // 行内数学公式不允许换行 https://github.com/siyuan-note/siyuan/issues/2187
                renderElement.setAttribute("data-content", renderElement.getAttribute("data-content").replace(/\n/g, ""));
            }
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            html = nodeElement.outerHTML;
            event.stopPropagation();
        });
        textElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            if (event.key === "Escape" || matchHotKey("⌘Enter", event)) {
                this.subElement.classList.add("fn__none");
                this.subElement.querySelector('[data-type="pin"]').classList.remove("ft__primary");
                if (renderElement.tagName === "SPAN") {
                    const range = getEditorRange(renderElement);
                    range.setStartAfter(renderElement);
                    range.collapse(true);
                    focusByRange(range);
                } else {
                    focusSideBlock(renderElement);
                }
            } else if (event.key === "Tab") {
                const start = textElement.selectionStart;
                textElement.value = textElement.value.substring(0, start) + "\t" + textElement.value.substring(textElement.selectionEnd);
                textElement.selectionStart = textElement.selectionEnd = start + 1;
                event.preventDefault();
            }
        });

        this.subElement.classList.remove("fn__none");
        const nodeRect = renderElement.getBoundingClientRect();
        this.element.classList.add("fn__none");
        if (isPin) {
            textElement.style.width = pinData.styleW;
            textElement.style.height = pinData.styleH;
        } else {
            autoHeight();
        }
        textElement.select();
    }

    public showCodeLanguage(protyle: IProtyle, languageElement: HTMLElement) {
        const nodeElement = hasClosestBlock(languageElement);
        if (!nodeElement) {
            return;
        }
        this.range = getEditorRange(nodeElement);
        const id = nodeElement.getAttribute("data-node-id");
        let oldHtml = nodeElement.outerHTML;
        let html = "";
        Constants.CODE_LANGUAGES.forEach((item, index) => {
            html += `<div class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item}</div>`;
        });
        this.subElement.style.width = "";
        this.subElement.style.padding = "";
        this.subElement.innerHTML = `<div class="fn__flex-column" style="max-height:50vh"><input placeholder="${window.siyuan.languages.search}" style="margin: 4px 8px 8px 8px" class="b3-text-field"/>
<div class="b3-list fn__flex-1 b3-list--background" style="position: relative">${html}</div>
</div>`;

        const inputElement = this.subElement.querySelector("input");
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            upDownHint(this.subElement.lastElementChild.lastElementChild as HTMLElement, event);
            if (event.key === "Enter") {
                languageElement.textContent = this.subElement.querySelector(".b3-list-item--focus").textContent;
                localStorage.setItem(Constants.LOCAL_CODELANG, languageElement.textContent);
                const editElement = getContenteditableElement(nodeElement);
                const lineNumber = nodeElement.getAttribute("linenumber");
                if (lineNumber === "true" || (lineNumber !== "false" && window.siyuan.config.editor.codeSyntaxHighlightLineNum)) {
                    editElement.classList.add("protyle-linenumber");
                } else {
                    editElement.classList.remove("protyle-linenumber");
                }
                (editElement as HTMLElement).textContent = editElement.textContent;
                editElement.removeAttribute("data-render");
                highlightRender(nodeElement);
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHtml);
                oldHtml = nodeElement.outerHTML;
                event.preventDefault();
                event.stopPropagation();
            }
            if (event.key === "Escape" || event.key === "Enter") {
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
            }
        });
        inputElement.addEventListener("input", (event) => {
            const mathLanguages: string[] = [];
            Constants.CODE_LANGUAGES.forEach((item) => {
                if (item.indexOf(inputElement.value.toLowerCase()) > -1) {
                    mathLanguages.push(item);

                }
            });
            let html = "";
            // sort
            mathLanguages.sort((a, b) => {
                if (a.startsWith(inputElement.value.toLowerCase()) && b.startsWith(inputElement.value.toLowerCase())) {
                    if (a.length < b.length) {
                        return -1;
                    } else if (a.length === b.length) {
                        return 0;
                    } else {
                        return 1;
                    }
                } else if (a.startsWith(inputElement.value.toLowerCase())) {
                    return -1;
                } else if (b.startsWith(inputElement.value.toLowerCase())) {
                    return 1;
                } else {
                    return 0;
                }
            }).forEach((item) => {
                html += `<div class="b3-list-item">${item.replace(inputElement.value.toLowerCase(), "<b>" + inputElement.value.toLowerCase() + "</b>")}</div>`;
            });
            this.subElement.firstElementChild.lastElementChild.innerHTML = html;
            if (html) {
                this.subElement.firstElementChild.lastElementChild.firstElementChild.classList.add("b3-list-item--focus");
            }
            event.stopPropagation();
        });
        this.subElement.lastElementChild.lastElementChild.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const listElement = hasClosestByClassName(target, "b3-list-item");
            if (!listElement) {
                return;
            }
            languageElement.textContent = listElement.textContent;
            localStorage.setItem(Constants.LOCAL_CODELANG, languageElement.textContent);
            const nodeElement = hasClosestBlock(languageElement);
            if (nodeElement) {
                const editElement = getContenteditableElement(nodeElement);
                const lineNumber = nodeElement.getAttribute("linenumber");
                if (lineNumber === "true" || (lineNumber !== "false" && window.siyuan.config.editor.codeSyntaxHighlightLineNum)) {
                    editElement.classList.add("protyle-linenumber");
                } else {
                    editElement.classList.remove("protyle-linenumber");
                }
                (editElement as HTMLElement).textContent = editElement.textContent;
                editElement.removeAttribute("data-render");
                highlightRender(nodeElement);
                nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, id, nodeElement.outerHTML, oldHtml);
                oldHtml = nodeElement.outerHTML;
                this.subElement.classList.add("fn__none");
                focusByRange(this.range);
            }
        });
        this.subElement.classList.remove("fn__none");
        const nodeRect = languageElement.getBoundingClientRect();
        setPosition(this.subElement, nodeRect.left, nodeRect.bottom, nodeRect.height);
        this.element.classList.add("fn__none");
        inputElement.select();
    }

    public showTpl(protyle: IProtyle, nodeElement: HTMLElement, range: Range) {
        this.range = range;
        fetchPost("/api/search/searchTemplate", {
            k: "",
        }, (response) => {
            let html = "";
            response.data.blocks.forEach((item: { path: string, content: string }, index: number) => {
                html += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.content}</div>`;
            });
            this.subElement.style.width = "";
            this.subElement.style.padding = "";
            this.subElement.innerHTML = `<div class="fn__flex-column" style="max-height:50vh"><input style="margin: 4px 8px 8px 8px" class="b3-text-field"/>
<div class="b3-list fn__flex-1 b3-list--background" style="position: relative">${html}</div>
</div>`;

            const inputElement = this.subElement.querySelector("input");
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                upDownHint(this.subElement.lastElementChild.lastElementChild as HTMLElement, event);
                if (event.key === "Enter") {
                    hintRenderTemplate(decodeURIComponent(this.subElement.querySelector(".b3-list-item--focus").getAttribute("data-value")), protyle, nodeElement);
                    this.subElement.classList.add("fn__none");
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    this.subElement.classList.add("fn__none");
                    focusByRange(this.range);
                }
            });
            inputElement.addEventListener("input", (event) => {
                event.stopPropagation();
                fetchPost("/api/search/searchTemplate", {
                    k: inputElement.value,
                }, (response) => {
                    let searchHTML = "";
                    response.data.blocks.forEach((item: { path: string, content: string }, index: number) => {
                        searchHTML += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.content}</div>`;
                    });
                    this.subElement.firstElementChild.lastElementChild.innerHTML = searchHTML;
                });
            });
            this.subElement.lastElementChild.addEventListener("click", (event) => {
                const target = event.target as HTMLElement;
                const listElement = hasClosestByClassName(target, "b3-list-item");
                if (!listElement) {
                    return;
                }
                hintRenderTemplate(decodeURIComponent(listElement.getAttribute("data-value")), protyle, nodeElement);
            });
            const rangePosition = getSelectionPosition(nodeElement, range);
            this.subElement.classList.remove("fn__none");
            setPosition(this.subElement, rangePosition.left, rangePosition.top + 18, Constants.SIZE_TOOLBAR_HEIGHT);
            this.element.classList.add("fn__none");
            inputElement.select();
        });
    }

    public showWidget(protyle: IProtyle, nodeElement: HTMLElement, range: Range) {
        this.range = range;
        fetchPost("/api/search/searchWidget", {
            k: "",
        }, (response) => {
            let html = "";
            response.data.blocks.forEach((item: { content: string }, index: number) => {
                html += `<div class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.content}</div>`;
            });
            this.subElement.style.width = "";
            this.subElement.style.padding = "";
            this.subElement.innerHTML = `<div class="fn__flex-column" style="max-height:50vh"><input style="margin: 4px 8px 8px 8px" class="b3-text-field"/>
<div class="b3-list fn__flex-1 b3-list--background" style="position: relative">${html}</div>
</div>`;

            const inputElement = this.subElement.querySelector("input");
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                upDownHint(this.subElement.lastElementChild.lastElementChild as HTMLElement, event);
                if (event.key === "Enter") {
                    hintRenderWidget(this.subElement.querySelector(".b3-list-item--focus").textContent, protyle);
                    this.subElement.classList.add("fn__none");
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    this.subElement.classList.add("fn__none");
                    focusByRange(this.range);
                }
            });
            inputElement.addEventListener("input", (event) => {
                event.stopPropagation();
                fetchPost("/api/search/searchWidget", {
                    k: inputElement.value,
                }, (response) => {
                    let searchHTML = "";
                    response.data.blocks.forEach((item: { path: string, content: string }, index: number) => {
                        searchHTML += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.content}</div>`;
                    });
                    this.subElement.firstElementChild.lastElementChild.innerHTML = searchHTML;
                });
            });
            this.subElement.lastElementChild.addEventListener("click", (event) => {
                const target = event.target as HTMLElement;
                const listElement = hasClosestByClassName(target, "b3-list-item");
                if (!listElement) {
                    return;
                }
                hintRenderWidget(listElement.textContent, protyle);
            });
            const rangePosition = getSelectionPosition(nodeElement, range);
            this.subElement.classList.remove("fn__none");
            setPosition(this.subElement, rangePosition.left, rangePosition.top + 18, Constants.SIZE_TOOLBAR_HEIGHT);
            this.element.classList.add("fn__none");
            inputElement.select();
        });
    }

    public showAssets(protyle: IProtyle, nodeElement: HTMLElement, range: Range) {
        this.range = range;
        fetchPost("/api/search/searchAsset", {
            k: "",
        }, (response) => {
            let html = "";
            response.data.forEach((item: { hName: string, path: string }, index: number) => {
                html += `<di data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.hName}</di>`;
            });
            this.subElement.style.width = "";
            this.subElement.style.padding = "";
            this.subElement.innerHTML = `<div class="fn__flex-column" style="max-height:50vh"><input style="margin: 4px 8px 8px 8px" class="b3-text-field"/>
<div class="b3-list fn__flex-1 b3-list--background" style="position: relative">${html}</div>
</div>`;

            const inputElement = this.subElement.querySelector("input");
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                upDownHint(this.subElement.lastElementChild.lastElementChild as HTMLElement, event);
                if (event.key === "Enter") {
                    hintRenderAssets(this.subElement.querySelector(".b3-list-item--focus").getAttribute("data-value"), protyle);
                } else if (event.key === "Escape") {
                    this.subElement.classList.add("fn__none");
                    focusByRange(this.range);
                }
            });
            inputElement.addEventListener("input", (event) => {
                event.stopPropagation();
                fetchPost("/api/search/searchAsset", {
                    k: inputElement.value,
                }, (response) => {
                    let searchHTML = "";
                    response.data.forEach((item: { path: string, hName: string }, index: number) => {
                        searchHTML += `<div data-value="${item.path}" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}">${item.hName}</div>`;
                    });
                    this.subElement.firstElementChild.lastElementChild.innerHTML = searchHTML;
                });
            });
            this.subElement.lastElementChild.addEventListener("click", (event) => {
                const target = event.target as HTMLElement;
                const listElement = hasClosestByClassName(target, "b3-list-item");
                if (!listElement) {
                    return;
                }
                hintRenderAssets(listElement.getAttribute("data-value"), protyle);
            });
            const rangePosition = getSelectionPosition(nodeElement, range);
            this.subElement.classList.remove("fn__none");
            setPosition(this.subElement, rangePosition.left, rangePosition.top + 18, Constants.SIZE_TOOLBAR_HEIGHT);
            this.element.classList.add("fn__none");
            inputElement.select();
        });
    }

    public showFile(protyle: IProtyle, nodeElements: Element[], range: Range) {
        this.range = range;
        fetchPost("/api/filetree/searchDocs", {
            k: "",
        }, (response) => {
            let html = "";
            response.data.forEach((item: { boxIcon: string, box: string, hPath: string, path: string }) => {
                if (item.path === "/") {
                    return;
                }
                html += `<div class="b3-list-item${html === "" ? " b3-list-item--focus" : ""}" data-path="${item.path}" data-box="${item.box}">
    ${item.boxIcon ? ('<span class="b3-list-item__icon">' + unicode2Emoji(item.boxIcon) + "</span>") : ""}
    <span class="b3-list-item__text">${escapeHtml(item.hPath)}</span>
</div>`;
            });
            this.subElement.style.width = "";
            this.subElement.style.padding = "";
            this.subElement.innerHTML = `<div class="fn__flex-column" style="max-height:50vh"><input style="margin: 4px 8px 8px 8px" class="b3-text-field"/>
<div class="b3-list fn__flex-1 b3-list--background" style="position: relative">${html}</div>
</div>`;

            const inputElement = this.subElement.querySelector("input");
            inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
                event.stopPropagation();
                if (event.isComposing) {
                    return;
                }
                upDownHint(this.subElement.lastElementChild.lastElementChild as HTMLElement, event);
                if (event.key === "Enter") {
                    hintMoveBlock(this.subElement.querySelector(".b3-list-item--focus").getAttribute("data-path"), nodeElements, protyle);
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    this.subElement.classList.add("fn__none");
                    focusByRange(this.range);
                }
            });
            inputElement.addEventListener("input", (event) => {
                event.stopPropagation();
                fetchPost("/api/filetree/searchDocs", {
                    k: inputElement.value,
                }, (response) => {
                    let searchHTML = "";
                    response.data.forEach((item: { boxIcon: string, box: string, hPath: string, path: string }) => {
                        if (item.path === "/") {
                            return;
                        }
                        searchHTML += `<div class="b3-list-item${searchHTML === "" ? " b3-list-item--focus" : ""}" data-path="${item.path}" data-box="${item.box}">
    ${item.boxIcon ? ('<span class="b3-list-item__icon">' + unicode2Emoji(item.boxIcon) + "</span>") : ""}
    <span class="b3-list-item__text">${escapeHtml(item.hPath)}</span>
</div>`;
                    });
                    this.subElement.firstElementChild.lastElementChild.innerHTML = searchHTML;
                });
            });
            this.subElement.lastElementChild.addEventListener("click", (event) => {
                const target = event.target as HTMLElement;
                const listElement = hasClosestByClassName(target, "b3-list-item");
                if (!listElement) {
                    return;
                }
                hintMoveBlock(listElement.getAttribute("data-path"), nodeElements, protyle);
            });
            const rangePosition = getSelectionPosition(nodeElements[0], range);
            this.subElement.classList.remove("fn__none");
            setPosition(this.subElement, rangePosition.left, rangePosition.top + 18, Constants.SIZE_TOOLBAR_HEIGHT);
            this.element.classList.add("fn__none");
            inputElement.select();
        });
    }
}


