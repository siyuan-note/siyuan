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

export const initUI = (protyle: IProtyle) => {
    protyle.contentElement = document.createElement("div");
    protyle.contentElement.className = "protyle-content";
    protyle.contentElement.innerHTML = '<div class="protyle-top"></div>';
    if (protyle.options.render.background) {
        protyle.contentElement.firstElementChild.appendChild(protyle.background.element);
    }
    if (protyle.options.render.title) {
        protyle.contentElement.firstElementChild.appendChild(protyle.title.element);
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

    addLoading(protyle);

    setEditMode(protyle, protyle.options.mode);
    document.execCommand("DefaultParagraphSeparator", false, "p");

    let wheelTimeout: number;
    const wheelId = genUUID();
    const isMacOS = isMac();
    protyle.contentElement.addEventListener("mousewheel", (event: WheelEvent) => {
        if (!window.siyuan.config.editor.fontSizeScrollZoom || (isMacOS && !event.metaKey) || (!isMacOS && !event.ctrlKey) || event.deltaX !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.deltaY < 0) {
            if (window.siyuan.config.editor.fontSize < 72) {
                window.siyuan.config.editor.fontSize++;
            } else {
                return;
            }
        } else if (event.deltaY > 0) {
            if (window.siyuan.config.editor.fontSize > 9) {
                window.siyuan.config.editor.fontSize--;
            } else {
                return;
            }
        }
        setInlineStyle();
        clearTimeout(wheelTimeout);
        showMessage(`${window.siyuan.languages.fontSize} ${window.siyuan.config.editor.fontSize}px<span class="fn__space"></span>
<button class="b3-button b3-button--small b3-button--white">${window.siyuan.languages.reset} 16px</button>`, undefined, undefined, wheelId);
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
    const oldLeft = parseInt(protyle.wysiwyg.element.style.paddingLeft);
    const padding = getPadding(protyle);
    const left = padding.left;
    const right = padding.right;
    if (protyle.options.backlinkData) {
        protyle.wysiwyg.element.style.padding = `4px ${right}px 4px ${left}px`;
    } else {
        protyle.wysiwyg.element.style.padding = `${padding.top}px ${right}px ${padding.bottom}px ${left}px`;
    }
    if (protyle.options.render.background) {
        protyle.background.element.querySelector(".protyle-background__ia").setAttribute("style", `margin-left:${left}px;margin-right:${right}px`);
    }
    if (protyle.options.render.title) {
        /// #if MOBILE
        protyle.title.element.style.margin = `16px ${right}px 0 ${left}px`;
        /// #else
        protyle.title.element.style.margin = `5px ${right}px 0 ${left}px`;
        /// #endif
    }
    if (window.siyuan.config.editor.displayBookmarkIcon) {
        const editorAttrElement = document.getElementById("editorAttr");
        if (editorAttrElement) {
            editorAttrElement.innerHTML = `.protyle-wysiwyg--attr .b3-tooltips:after { max-width: ${protyle.wysiwyg.element.clientWidth - left - right}px; }`;
        }
    }
    const oldWidth = protyle.wysiwyg.element.getAttribute("data-realwidth");
    const newWidth = protyle.wysiwyg.element.clientWidth - parseInt(protyle.wysiwyg.element.style.paddingLeft) - parseInt(protyle.wysiwyg.element.style.paddingRight);
    protyle.wysiwyg.element.setAttribute("data-realwidth", newWidth.toString());
    return {
        width: Math.abs(parseInt(oldWidth) - newWidth),
        padding: Math.abs(oldLeft - parseInt(protyle.wysiwyg.element.style.paddingLeft))
    };
};

export const getPadding = (protyle: IProtyle) => {
    let right = 16;
    let left = 24;
    let bottom = 16;
    if (protyle.options.typewriterMode) {
        if (isMobile()) {
            bottom = window.innerHeight / 5;
        } else {
            bottom = protyle.element.clientHeight / 2;
        }
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
