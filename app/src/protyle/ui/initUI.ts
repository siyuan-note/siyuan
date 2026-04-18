import {setEditMode} from "../util/setEditMode";
import {scrollEvent} from "../scroll/event";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";
import {isMac} from "../util/compatibility";
import {setInlineStyle} from "../../util/assets";
import {fetchPost} from "../../util/fetch";
import {lineNumberRender} from "../render/highlightRender";
import {hideMessage, showMessage} from "../../dialog/message";
import {genUUID} from "../../util/genID";
import {getContenteditableElement, getLastBlock} from "../wysiwyg/getBlock";
import {genEmptyElement, genHeadingElement} from "../../block/util";
import {transaction} from "../wysiwyg/transaction";
import {focusByRange} from "../util/selection";
/// #if !MOBILE
import {moveResize} from "../../dialog/moveResize";
/// #endif
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    isInEmbedBlock
} from "../util/hasClosest";
import {hideElements} from "./hideElements";

export const initUI = (protyle: IProtyle) => {
    protyle.contentElement = document.createElement("div");
    protyle.contentElement.className = "protyle-content";

    if (protyle.options.render.background || protyle.options.render.title) {
        protyle.contentElement.innerHTML = '<div class="protyle-top"></div>';
        if (protyle.options.render.background) {
            protyle.contentElement.firstElementChild.appendChild(protyle.background.element);
        }
        if (protyle.options.render.title) {
            protyle.contentElement.firstElementChild.appendChild(protyle.title.element);
        }
    }

    protyle.contentElement.appendChild(protyle.wysiwyg.element);
    if (!protyle.options.action.includes(Constants.CB_GET_HISTORY)) {
        scrollEvent(protyle, protyle.contentElement);
    }
    protyle.element.append(protyle.contentElement);
    protyle.element.appendChild(protyle.preview.element);
    if (protyle.upload) {
        protyle.element.appendChild(protyle.upload.element);
    }
    if (protyle.options.render.scroll) {
        protyle.element.appendChild(protyle.scroll.element.parentElement);
    }
    if (protyle.gutter) {
        protyle.element.appendChild(protyle.gutter.element);
    }

    protyle.element.appendChild(protyle.hint.element);

    protyle.selectElement = document.createElement("div");
    protyle.selectElement.className = "protyle-select fn__none";
    protyle.element.appendChild(protyle.selectElement);

    protyle.element.appendChild(protyle.toolbar.element);
    protyle.element.appendChild(protyle.toolbar.subElement);
    /// #if !MOBILE
    moveResize(protyle.toolbar.subElement, () => {
        const pinElement = protyle.toolbar.subElement.querySelector('.block__icons [data-type="pin"]');
        if (pinElement) {
            pinElement.querySelector("svg use").setAttribute("xlink:href", "#iconUnpin");
            pinElement.setAttribute("aria-label", window.siyuan.languages.unpin);
            protyle.toolbar.subElement.firstElementChild.setAttribute("data-drag", "true");
        }
    });
    /// #endif

    protyle.element.append(protyle.highlight.styleElement);

    addLoading(protyle);

    setEditMode(protyle, protyle.options.mode);
    document.execCommand("DefaultParagraphSeparator", false, "p");

    let wheelTimeout: number;
    const wheelId = genUUID();
    const isMacOS = isMac();
    const ZOOM_THRESHOLD = 20; // 按下 Ctrl / Cmd 滚动时累加 deltaY，达到阈值时改动一级字号
    const WHEEL_IDLE_MS = 200; // 单轮滚动的间隔时间，超过该时间后重置累加值
    let accumDeltaY = 0;
    let resetTimer: number;
    let wheelActive = false; // 记录是否处于同一轮滚动中
    let modifierOnset = false; // 记录同一轮滚动的首次滚动是否按下 Ctrl / Cmd
    protyle.contentElement.addEventListener("mousewheel", (event: WheelEvent) => {
        if (!window.siyuan.config.editor.fontSizeScrollZoom || event.shiftKey || event.deltaY === 0) {
            // 用 event.shiftKey || event.deltaY === 0 检测横向滚动，因为 Mac 触控板快速划动时 deltaX 可能很大，即使容器并不能发生横向滚动
            return;
        }
        // 浏览器无法区分触控板与鼠标滚轮 https://github.com/w3c/pointerevents/issues/596
        // 用「首轮是否带修饰键 + 空闲窗口」避免惯性或残留累加误触
        // Mac 在鼠标不移动的情况下 event.metaKey 状态更新滞后，参考 https://github.com/tldraw/tldraw/issues/7981
        const modifierPressed = isMacOS ? window.siyuan.metaIsPressed : event.ctrlKey;
        if (!modifierPressed) {
            accumDeltaY = 0;
        }
        clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
            wheelActive = false;
            accumDeltaY = 0;
        }, WHEEL_IDLE_MS);
        if (!wheelActive) {
            wheelActive = true;
            modifierOnset = modifierPressed;
        }
        if (!modifierPressed || !modifierOnset) {
            // 触控板惯性会在松手后仍产生滚轮事件，避免划动后再按下 Ctrl / Cmd 会调整字号 https://ld246.com/article/1764296257377
            // 要在单轮滚动的最后一个滚动事件触发之后等待 WHEEL_IDLE_MS 再按下 Ctrl / Cmd 滚动才能调整字号
            return;
        }
        // 仅 Windows 按下 Ctrl 之后滚动鼠标无法滚动容器，其他情况下都需要 preventDefault 阻止编辑器滚动
        event.preventDefault();
        event.stopPropagation();
        if (accumDeltaY !== 0 && Math.sign(event.deltaY) !== Math.sign(accumDeltaY)) {
            accumDeltaY = 0;
        }
        accumDeltaY += event.deltaY;
        if (accumDeltaY <= -ZOOM_THRESHOLD) {
            if (window.siyuan.config.editor.fontSize >= 72) {
                return;
            }
            window.siyuan.config.editor.fontSize++;
        } else if (accumDeltaY >= ZOOM_THRESHOLD) {
            if (window.siyuan.config.editor.fontSize <= 9) {
                return;
            }
            window.siyuan.config.editor.fontSize--;
        } else {
            return;
        }
        accumDeltaY = 0;
        setInlineStyle();
        clearTimeout(wheelTimeout);
        showMessage(`${window.siyuan.languages.fontSize} ${window.siyuan.config.editor.fontSize}px<span class="fn__space"></span>
<button class="b3-button b3-button--white">${window.siyuan.languages.reset} 16px</button>`, undefined, undefined, wheelId);
        wheelTimeout = window.setTimeout(() => {
            fetchPost("/api/setting/setEditor", window.siyuan.config.editor);
            protyle.wysiwyg.element.querySelectorAll(".code-block .protyle-linenumber__rows").forEach((block: HTMLElement) => {
                lineNumberRender(block.parentElement);
            });
            document.querySelector(`#message [data-id="${wheelId}"] button`)?.addEventListener("click", () => {
                window.siyuan.config.editor.fontSize = 16;
                setInlineStyle();
                fetchPost("/api/setting/setEditor", window.siyuan.config.editor);
                hideMessage(wheelId);
                protyle.wysiwyg.element.querySelectorAll(".code-block .protyle-linenumber__rows").forEach((block: HTMLElement) => {
                    lineNumberRender(block.parentElement);
                });
            });
        }, Constants.TIMEOUT_LOAD);
    }, {passive: false});
    protyle.contentElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
        hideElements(["hint", "util"], protyle);
        // wysiwyg 元素下方点击无效果 https://github.com/siyuan-note/siyuan/issues/12009
        if (protyle.disabled ||
            // 选中块时，禁止添加空块 https://github.com/siyuan-note/siyuan/issues/13905
            protyle.contentElement.querySelector(".protyle-wysiwyg--select") ||
            (!event.target.classList.contains("protyle-content") && !event.target.classList.contains("protyle-wysiwyg"))) {
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/14190 选中最后一个块末尾点击底部时，range 会有值，需使用 setTimeout，最新测试无需 setTimeout 了，且会影响移动端键盘弹起故移除
        // 选中文本禁止添加空块 https://github.com/siyuan-note/siyuan/issues/13905
        if (window.getSelection().rangeCount > 0) {
            const currentRange = window.getSelection().getRangeAt(0);
            if (currentRange.toString() !== "" && protyle.wysiwyg.element.contains(currentRange.startContainer)) {
                return;
            }
        }
        const lastElement = protyle.wysiwyg.element.lastElementChild;
        const lastRect = lastElement.getBoundingClientRect();
        const range = document.createRange();
        if (event.y > lastRect.bottom) {
            const lastEditElement = getContenteditableElement(getLastBlock(lastElement));
            if (!protyle.options.click.preventInsetEmptyBlock && (
                !lastEditElement ||
                (lastElement.getAttribute("data-type") !== "NodeParagraph" && protyle.wysiwyg.element.getAttribute("data-doc-type") !== "NodeListItem") ||
                (lastElement.getAttribute("data-type") === "NodeParagraph" && getContenteditableElement(lastEditElement).innerHTML !== ""))
            ) {
                let emptyElement: Element;
                if (lastElement.getAttribute("data-type") === "NodeHeading" && lastElement.getAttribute("fold") === "1") {
                    emptyElement = genHeadingElement(lastElement) as Element;
                } else {
                    emptyElement = genEmptyElement(false, false);
                }
                protyle.wysiwyg.element.insertAdjacentElement("beforeend", emptyElement);
                transaction(protyle, [{
                    action: "insert",
                    data: emptyElement.outerHTML,
                    id: emptyElement.getAttribute("data-node-id"),
                    previousID: emptyElement.previousElementSibling.getAttribute("data-node-id"),
                    parentID: protyle.block.parentID
                }], [{
                    action: "delete",
                    id: emptyElement.getAttribute("data-node-id")
                }]);
                const emptyEditElement = getContenteditableElement(emptyElement) as HTMLInputElement;
                range.selectNodeContents(emptyEditElement);
                range.collapse(true);
                focusByRange(range);
                // 需等待 range 更新再次进行渲染
                if (protyle.options.render.breadcrumb) {
                    setTimeout(() => {
                        protyle.breadcrumb.render(protyle);
                    }, Constants.TIMEOUT_TRANSITION);
                }
            } else if (lastEditElement) {
                range.selectNodeContents(lastEditElement);
                range.collapse(false);
                focusByRange(range);
            }
            protyle.toolbar.range = range;
        }
    });
    let overAttr = false;
    /// #if !MOBILE
    protyle.element.addEventListener("mouseover", (event: KeyboardEvent & {
        target: HTMLElement
    }) => {
        // attr
        const attrElement = hasClosestByClassName(event.target, "protyle-attr");
        if (attrElement && !attrElement.parentElement.classList.contains("protyle-title")) {
            const hlElement = protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--hl");
            if (hlElement) {
                hlElement.classList.remove("protyle-wysiwyg--hl");
            }
            overAttr = true;
            attrElement.parentElement.classList.add("protyle-wysiwyg--hl");
            return;
        } else if (overAttr) {
            const hlElement = protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--hl");
            if (hlElement) {
                hlElement.classList.remove("protyle-wysiwyg--hl");
            }
            overAttr = false;
        }

        const nodeElement = hasClosestBlock(event.target);
        if (protyle.options.render.gutter && nodeElement) {
            if (nodeElement && (nodeElement.classList.contains("list") || nodeElement.classList.contains("li"))) {
                // 光标在列表下部应显示右侧的元素，而不是列表本身。放在 windowEvent 中的 mousemove 下处理
                return;
            }
            const embedElement = isInEmbedBlock(nodeElement);
            if (embedElement) {
                protyle.gutter.render(protyle, embedElement);
                return;
            }
            protyle.gutter.render(protyle, nodeElement, event.target);
            return;
        }

        // gutter
        const buttonElement = hasClosestByTag(event.target, "BUTTON");
        if (buttonElement && buttonElement.parentElement.classList.contains("protyle-gutters")) {
            const type = buttonElement.getAttribute("data-type");
            if (type === "fold" || type === "NodeAttributeViewRow") {
                Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl, .av__row--hl")).forEach(item => {
                    item.classList.remove("protyle-wysiwyg--hl", "av__row--hl");
                });
                return;
            }
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${buttonElement.getAttribute("data-node-id")}"]`)).find(item => {
                if (!isInEmbedBlock(item) && protyle.gutter.isMatchNode(item)) {
                    const bodyQueryClass = (buttonElement.dataset.groupId && buttonElement.dataset.groupId !== "undefined") ? `.av__body[data-group-id="${buttonElement.dataset.groupId}"] ` : "";
                    const rowItem = item.querySelector(bodyQueryClass + `.av__row[data-id="${buttonElement.dataset.rowId}"]`);
                    Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl, .av__row--hl")).forEach(hlItem => {
                        if (item !== hlItem) {
                            hlItem.classList.remove("protyle-wysiwyg--hl");
                        }
                        if (rowItem && rowItem !== hlItem) {
                            rowItem.classList.remove("av__row--hl");
                        }
                    });
                    if (type === "NodeAttributeViewRowMenu") {
                        rowItem.classList.add("av__row--hl");
                    } else {
                        item.classList.add("protyle-wysiwyg--hl");
                    }
                    return true;
                }
            });
            event.preventDefault();
            return;
        }

        // 面包屑
        if (protyle.selectElement.classList.contains("fn__none")) {
            const svgElement = hasClosestByAttribute(event.target, "data-node-id", null);
            if (svgElement && svgElement.parentElement.classList.contains("protyle-breadcrumb__bar")) {
                protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => {
                    item.classList.remove("protyle-wysiwyg--hl");
                });
                const nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${svgElement.getAttribute("data-node-id")}"]`);
                if (nodeElement) {
                    nodeElement.classList.add("protyle-wysiwyg--hl");
                }
            }
        }
    });
    /// #endif
};

export const addLoading = (protyle: IProtyle, msg?: string) => {
    protyle.element.removeAttribute("data-loading");
    setTimeout(() => {
        if (protyle.element.getAttribute("data-loading") !== "finished") {
            protyle.element.insertAdjacentHTML("beforeend", `<div style="background-color: var(--b3-theme-background);flex-direction: column;" class="fn__loading wysiwygLoading">
    <img width="48px" src="/stage/loading-pure.svg">
    <div style="color: var(--b3-theme-on-surface);margin-top: 8px;">${msg || ""}</div>
</div>`);
        }
    }, Constants.TIMEOUT_LOAD);
};

export const removeLoading = (protyle: IProtyle) => {
    protyle.element.setAttribute("data-loading", "finished");
    protyle.element.querySelectorAll(".wysiwygLoading").forEach(item => {
        item.remove();
    });
};

export const setPadding = (protyle: IProtyle) => {
    if (protyle.options.action.includes(Constants.CB_GET_HISTORY)) {
        return {
            width: 0,
            padding: 0
        };
    }
    const padding = getPadding(protyle);
    const paddingLeft = padding.left;
    const paddingRight = padding.right;

    if (protyle.options.backlinkData) {
        protyle.wysiwyg.element.style.padding = `4px ${paddingRight}px 4px ${paddingLeft}px`;
    } else {
        protyle.wysiwyg.element.style.padding = `${padding.top}px ${paddingRight}px ${padding.bottom}px ${paddingLeft}px`;
    }
    if (protyle.options.render.background) {
        protyle.background.element.querySelector(".protyle-background__ia").setAttribute("style", `margin-left:${paddingLeft}px;margin-right:${paddingRight}px`);
    }
    if (protyle.options.render.title) {
        // pc 端 文档名 attr 过长和添加标签等按钮重合
        protyle.title.element.style.margin = `16px ${paddingRight}px 0 ${paddingLeft}px`;
    }

    // https://github.com/siyuan-note/siyuan/issues/15021
    protyle.element.style.setProperty("--b3-width-protyle", protyle.element.clientWidth + "px");
    protyle.element.style.setProperty("--b3-width-protyle-content", protyle.contentElement.clientWidth + "px");
    const realWidth = protyle.wysiwyg.element.getAttribute("data-realwidth");
    const newWidth = protyle.wysiwyg.element.clientWidth - paddingLeft - paddingRight;
    protyle.wysiwyg.element.setAttribute("data-realwidth", newWidth.toString());
    protyle.element.style.setProperty("--b3-width-protyle-wysiwyg", newWidth.toString() + "px");
    return {
        width: realWidth ? Math.abs(parseFloat(realWidth) - newWidth) : 0,
    };
};

export const getPadding = (protyle: IProtyle) => {
    let right = 16;
    let left = 24;
    let bottom = 16;
    if (protyle.options.typewriterMode) {
        bottom = protyle.element.clientHeight / 2;
    }
    if (!isMobile()) {
        let isFullWidth = protyle.wysiwyg.element.getAttribute(Constants.CUSTOM_SY_FULLWIDTH);
        if (!isFullWidth) {
            isFullWidth = window.siyuan.config.editor.fullWidth ? "true" : "false";
        }
        let padding = (protyle.element.clientWidth - Constants.SIZE_EDITOR_WIDTH) / 2;
        if (isFullWidth === "false" && padding > 96) {
            if (padding > Constants.SIZE_EDITOR_WIDTH) {
                // 超宽屏调整 https://ld246.com/article/1668266637363
                padding = protyle.element.clientWidth * .382 / 1.382;
            }
            padding = Math.ceil(padding);
            left = padding;
            right = padding;
        } else if (protyle.element.clientWidth > Constants.SIZE_EDITOR_WIDTH) {
            left = 96;
            right = 96;
        }
    }
    return {
        left, right, bottom, top: 16
    };
};
