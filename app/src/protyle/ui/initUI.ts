import {setEditMode} from "../util/setEditMode";
import {scrollEvent} from "../scroll/event";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";
import {hasClosestByAttribute, hasClosestByClassName} from "../util/hasClosest";
import {isMac} from "../util/compatibility";
import {setInlineStyle} from "../../util/assets";
import {fetchPost} from "../../util/fetch";
import {lineNumberRender} from "../render/highlightRender";

export const initUI = (protyle: IProtyle) => {
    protyle.contentElement = document.createElement("div");
    protyle.contentElement.className = "protyle-content";
    if (protyle.options.render.background) {
        protyle.contentElement.appendChild(protyle.background.element);
    }
    if (protyle.options.render.title) {
        protyle.contentElement.appendChild(protyle.title.element);
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

    // 触摸屏背景和嵌入块按钮显示
    protyle.contentElement.addEventListener("touchstart", (event) => {
        // https://github.com/siyuan-note/siyuan/issues/6328
        if (protyle.disabled) {
            return;
        }
        const target = event.target as HTMLElement;
        if (hasClosestByClassName(target, "protyle-icons") ||
            hasClosestByClassName(target, "item") ||
            target.classList.contains("protyle-background__icon")) {
            return;
        }
        if (hasClosestByClassName(target, "protyle-background")) {
            protyle.background.element.classList.toggle("protyle-background--mobileshow");
            return;
        }
        const embedBlockElement = hasClosestByAttribute(target, "data-type", "NodeBlockQueryEmbed");
        if (embedBlockElement) {
            embedBlockElement.firstElementChild.classList.toggle("protyle-icons--show");
        }
    });
    let wheelTimeout: number;
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
        wheelTimeout = window.setTimeout(() => {
            fetchPost("/api/setting/setEditor", window.siyuan.config.editor);
            if (window.siyuan.config.editor.codeSyntaxHighlightLineNum) {
                protyle.wysiwyg.element.querySelectorAll(".code-block .protyle-linenumber").forEach((block: HTMLElement) => {
                    lineNumberRender(block);
                });
            }
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
    let left = 16;
    let right = 24;
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
    let bottomHeight = "16px";
    if (protyle.options.typewriterMode) {
        if (isMobile()) {
            bottomHeight = window.innerHeight / 5 + "px";
        } else {
            bottomHeight = protyle.element.clientHeight / 2 + "px";
        }
    }
    if (protyle.options.backlinkData) {
        protyle.wysiwyg.element.style.padding = `4px ${left}px 4px ${right}px`;
    } else {
        protyle.wysiwyg.element.style.padding = `16px ${left}px ${bottomHeight} ${right}px`;
    }
    if (protyle.options.render.background) {
        protyle.background.element.lastElementChild.setAttribute("style", `left:${left}px`);
        protyle.background.element.querySelector(".protyle-background__img .protyle-icons").setAttribute("style", `right:${left}px`);
    }
    if (protyle.options.render.title) {
        protyle.title.element.style.margin = `16px ${left}px 0 ${right}px`;
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
