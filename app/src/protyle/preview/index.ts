import {isOnlyMeta, writeText} from "../util/compatibility";
import {focusByRange} from "../util/selection";
import {openByMobile} from "../../editor/openLink";
import {showMessage} from "../../dialog/message";
import {isLocalPath, pathPosix} from "../../util/pathName";
import {processSiYuanUri} from "../../util/uri";
import {previewDocImage} from "./image";
import {getDiagramBlock, previewDiagram} from "./diagram";
import {needSubscribe} from "../../util/needSubscribe";
import {Constants} from "../../constants";
import {getSearch, isMobile} from "../../util/functions";
/// #if !BROWSER
import {shell} from "electron";
import {
    enhanceRichClipboard,
    hasRichClipboardImages,
    hasRichClipboardMath,
    hasRichClipboardTables,
    prepareExternalClipboardHTML,
} from "../util/richClipboard";
/// #endif
/// #if !MOBILE
import {openAsset, openBy} from "../../editor/util";
import {getAllModels} from "../../layout/getAll";
/// #endif
import {fetchPost} from "../../util/fetch";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {speechRender} from "../render/speechRender";
import {avRender} from "../render/av/render";
import {getPadding} from "../ui/initUI";
import {hasTopClosestByAttribute} from "../util/hasClosest";
import {addScriptSync} from "../util/addScript";
import {prepareWechatCopy, prepareZhihuCopy} from "./platformCopy";
import {isHEIFPath, isBrowserRenderableImagePath} from "../../util/imageURL";

export class Preview {
    public element: HTMLElement;
    public previewElement: HTMLElement;
    private mdTimeoutId: number;
    private copyingToX = false;
    private copyEventHandler?: (event: ClipboardEvent) => void;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-preview fn__none";

        const previewElement = document.createElement("div");
        previewElement.className = "b3-typography";
        if (protyle.options.classes.preview) {
            previewElement.classList.add(protyle.options.classes.preview);
        }
        const actions = protyle.options.preview.actions;
        const actionElement = document.createElement("div");
        actionElement.className = "protyle-preview__action";
        const actionHtml: string[] = [];
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            if (typeof action === "object") {
                actionHtml.push(`<button type="button" data-type="${action.key}" class="${action.className}">${action.text}</button>`);
                continue;
            }
            switch (action) {
                case "desktop":
                    actionHtml.push(`<button type="button" class="protyle-preview__action--current" data-type="desktop">${window.siyuan.languages.desktop}</button>`);
                    break;
                case "tablet":
                    actionHtml.push(`<button type="button" data-type="tablet">${window.siyuan.languages.tablet}</button>`);
                    break;
                case "mobile":
                    actionHtml.push(`<button type="button" data-type="mobile">${window.siyuan.languages.mobile}</button>`);
                    break;
                case "mp-wechat":
                    actionHtml.push(`<button type="button" data-type="mp-wechat" class="b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.copyToWechatMP}"><svg><use xlink:href="#iconMp"></use></svg></button>`);
                    break;
                case "zhihu":
                    actionHtml.push(`<button type="button" data-type="zhihu" class="b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.copyToZhihu}"><svg><use xlink:href="#iconZhihu"></use></svg></button>`);
                    break;
                case "yuque":
                    actionHtml.push(`<button type="button" data-type="yuque" class="b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.copyToYuque}"><svg><use xlink:href="#iconYuque"></use></svg></button>`);
                    break;
            }
        }
        actionElement.innerHTML = actionHtml.join("");
        this.element.appendChild(actionElement);
        this.element.appendChild(previewElement);

        /// #if !BROWSER
        this.copyEventHandler = (event: ClipboardEvent) => {
            if (this.copyingToX || !event.clipboardData) {
                return;
            }

            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
                return;
            }
            const range = selection.getRangeAt(0);
            if (!previewElement.contains(range.startContainer) || !previewElement.contains(range.endContainer)) {
                return;
            }

            const copyElement = document.createElement("div");
            copyElement.appendChild(range.cloneContents());
            const copiedHTML = copyElement.innerHTML;
            const hasImages = hasRichClipboardImages(copiedHTML);
            const hasMath = hasRichClipboardMath(copiedHTML);
            const hasTables = hasRichClipboardTables(copiedHTML);
            if (!hasImages && !hasMath && !hasTables) {
                return;
            }
            const clipboardHTML = hasMath || hasTables ?
                prepareExternalClipboardHTML(copiedHTML) : copiedHTML;

            const marker = `<!--siyuan-rich-clipboard='${Lute.NewNodeID()}'-->`;
            const text = selection.toString();
            const html = marker + clipboardHTML;
            event.preventDefault();
            event.clipboardData.setData("text/plain", text);
            event.clipboardData.setData("text/html", html);
            if (hasImages) {
                enhanceRichClipboard(text, html, protyle.notebookId, {
                    marker,
                    removeMarker: true,
                });
            }
        };
        document.addEventListener("copy", this.copyEventHandler);
        /// #endif

        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.tagName === "A") {
                    const linkAddress = target.getAttribute("href");
                    if (linkAddress.startsWith("#")) {
                        // 导出预览模式点击块引转换后的脚注跳转不正确 https://github.com/siyuan-note/siyuan/issues/5700
                        const hash = linkAddress.substring(1);
                        previewElement.querySelector('[data-node-id="' + hash + '"], [id="' + hash + '"]').scrollIntoView();
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    }

                    if (isMobile()) {
                        openByMobile(linkAddress);
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    if (isLocalPath(linkAddress)) {
                        /// #if !MOBILE
                        if (isOnlyMeta(event)) {
                            openBy(linkAddress, "folder");
                        } else if (event.shiftKey) {
                            openBy(linkAddress, "app");
                        } else if (isHEIFPath(linkAddress) && !isBrowserRenderableImagePath(linkAddress)) {
                            openBy(linkAddress, "app");
                        } else if (Constants.SIYUAN_ASSETS_EXTS.includes(pathPosix().extname((linkAddress).split("?")[0]).toLowerCase())) {
                            openAsset(protyle.app, linkAddress.split("?page")[0], parseInt(getSearch("page", linkAddress)));
                        }
                        /// #endif
                    } else {
                        if (processSiYuanUri(protyle.app, linkAddress)) {
                            break;
                        }
                        /// #if !BROWSER
                        shell.openExternal(linkAddress).catch((e) => {
                            showMessage(e);
                        });
                        /// #else
                        window.open(linkAddress);
                        /// #endif
                    }
                    break;
                } else if (target.tagName === "IMG") {
                    previewDocImage((event.target as HTMLElement).getAttribute("src"), protyle.block.rootID);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (target.tagName === "BUTTON") {
                    const type = target.getAttribute("data-type");
                    if (type !== "mp-wechat" && type !== "zhihu" && type !== "yuque") {
                        actionElement.querySelectorAll("button").forEach((item) => {
                            item.classList.remove("protyle-preview__action--current");
                        });
                        target.classList.add("protyle-preview__action--current");
                    }
                    const actionCustom = actions.find((w: IPreviewActionCustom) => w?.key === type) as IPreviewActionCustom;
                    if (actionCustom) {
                        actionCustom.click(type);
                    } else if ((type === "mp-wechat" || type === "zhihu" || type === "yuque")) {
                        const tempElement = document.createElement("div");
                        tempElement.appendChild(this.element.lastElementChild.cloneNode(true));
                        this.copyToX(tempElement, protyle, type);
                    } else if (type === "desktop") {
                        previewElement.style.width = "";
                        this.updatePadding(getPadding(protyle));
                    } else if (type === "tablet") {
                        previewElement.style.width = "1024px";
                        previewElement.style.padding = "8px 16px";
                    } else {
                        previewElement.style.width = "360px";
                        previewElement.style.padding = "8px";
                    }
                }
                target = target.parentElement;
            }
            const nodeElement = hasTopClosestByAttribute(event.target as HTMLElement, "id", undefined);
            if (nodeElement) {
                // 用于点击后大纲定位
                this.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                    item.classList.remove("selected");
                });
                nodeElement.classList.add("selected");
                /// #if !MOBILE
                if (protyle.model) {
                    getAllModels().outline.forEach(item => {
                        if (item.blockId === protyle.block.rootID) {
                            item.setCurrentByPreview(nodeElement);
                        }
                    });
                }
                /// #else
                window.siyuan.mobile.docks.outline?.setCurrentByPreview(nodeElement);
                /// #endif
                const diagramElement = getDiagramBlock(nodeElement);
                if (diagramElement) {
                    previewDiagram(diagramElement);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
            }
        });

        this.previewElement = previewElement;
    }

    public destroy() {
        window.clearTimeout(this.mdTimeoutId);
        /// #if !BROWSER
        if (this.copyEventHandler) {
            document.removeEventListener("copy", this.copyEventHandler);
            this.copyEventHandler = undefined;
        }
        /// #endif
    }

    public updatePadding(padding: { left: number, right: number, bottom: number, top: number }) {
        if (!this.element.classList.contains("fn__none") &&
            this.element.querySelector('.protyle-preview__action [data-type="desktop"]')?.classList.contains("protyle-preview__action--current")) {
            this.previewElement.style.padding = `${padding.top}px ${padding.left}px ${padding.bottom}px ${padding.right}px`;
        }
    }

    public render(protyle: IProtyle) {
        if (this.element.style.display === "none") {
            return;
        }
        this.updatePadding(getPadding(protyle));

        let loadingElement = this.element.querySelector(".fn__loading");
        if (!loadingElement) {
            this.element.insertAdjacentHTML("beforeend", `<div style="flex-direction: column;" class="fn__loading">
    <img width="48px" src="/stage/loading-pure.svg">
</div>`);
            loadingElement = this.element.querySelector(".fn__loading");
        }
        this.mdTimeoutId = window.setTimeout(() => {
            fetchPost("/api/export/preview", {
                id: protyle.block.id || protyle.options.blockId || protyle.block.parentID,
            }, response => {
                const oldScrollTop = protyle.preview.previewElement.scrollTop;
                protyle.preview.previewElement.innerHTML = response.data.html;
                /// #if MOBILE
                protyle.preview.previewElement.querySelector(`#${CSS.escape(protyle.block.rootID)}`)
                    ?.classList.add("protyle-preview__title");
                /// #endif
                processRender(protyle.preview.previewElement);
                highlightRender(protyle.preview.previewElement);
                avRender(protyle.preview.previewElement, protyle);
                speechRender(protyle.preview.previewElement, window.siyuan.config.appearance.lang);
                protyle.preview.previewElement.scrollTop = oldScrollTop;
                loadingElement.remove();
            });
        }, protyle.options.preview.delay);
    }

    private link2online(copyElement: HTMLElement) {
        if (needSubscribe("")) {
            return;
        }
        copyElement.querySelectorAll("[href],[src]").forEach(item => {
            const oldLink = item.getAttribute("href") || item.getAttribute("src");
            if (oldLink && oldLink.startsWith("assets/")) {
                const newLink = Constants.ASSETS_ADDRESS + window.siyuan.user.userId + "/" + oldLink;
                if (item.getAttribute("href")) {
                    item.setAttribute("href", newLink);
                } else {
                    item.setAttribute("src", newLink);
                }
            }
        });
    }

    private async copyToX(copyElement: HTMLElement, protyle: IProtyle, type?: string) {
        // fix math render
        if (type === "mp-wechat") {
            this.link2online(copyElement);
            copyElement.querySelectorAll(".katex-html .base").forEach((item: HTMLElement) => {
                item.style.display = "initial";
            });
            copyElement.querySelectorAll("mjx-container > svg").forEach((item) => {
                item.setAttribute("width", (parseInt(item.getAttribute("width")) * 8) + "px");
            });
            if (typeof window.MathJax === "undefined") {
                window.MathJax = {
                    svg: {
                        fontCache: "none"
                    },
                };
            }
            await addScriptSync(`${Constants.PROTYLE_CDN}/js/mathjax/tex-svg-full.js`, "protyleMathJaxScript");
            await window.MathJax.startup.promise;
            copyElement.querySelectorAll('[data-subtype="math"]').forEach(mathElement => {
                const node = window.MathJax.tex2svg(Lute.UnEscapeHTMLStr(mathElement.getAttribute("data-content")).trim(), {display: mathElement.tagName === "DIV"});
                node.querySelector("mjx-assistive-mml").remove();
                mathElement.innerHTML = node.outerHTML;
            });
            prepareWechatCopy(copyElement, this.previewElement);
        } else if (type === "zhihu") {
            this.link2online(copyElement);
            copyElement.querySelectorAll('[data-subtype="math"]').forEach((item: HTMLElement) => {
                // https://github.com/siyuan-note/siyuan/issues/10015
                item.outerHTML = `<img class="Formula-image" data-eeimg="true" src="//www.zhihu.com/equation?tex=" alt="${item.getAttribute("data-content")}" style="${item.tagName === "DIV" ? "display: block; max-width: 100%;" : ""}margin: 0 auto;">`;
            });
            prepareZhihuCopy(copyElement);
        } else if (type === "yuque") {
            fetchPost("/api/lute/copyStdMarkdown", {
                id: protyle.block.id || protyle.options.blockId || protyle.block.parentID,
                assetsDestSpace2Underscore: true,
                fillCSSVar: true,
                adjustHeadingLevel: true,
            }, (response) => {
                writeText(response.data);
                showMessage(`${window.siyuan.languages.pasteToYuque}`);
            });
            return;
        }

        // 防止背景色被粘贴到公众号中
        copyElement.style.backgroundColor = "#fff";
        // 代码背景
        copyElement.querySelectorAll("code").forEach((item) => {
            item.style.backgroundImage = "none";
        });
        const copyEditElement = copyElement.querySelector(".b3-typography") as HTMLElement;
        if (copyEditElement.firstElementChild.tagName === "DIV") {
            // 最后/第一个块是公式块时无法复制下来
            copyElement.insertAdjacentHTML("afterbegin", "<p>&zwj;</p>");
        }
        if (copyEditElement.lastElementChild.tagName === "DIV") {
            copyElement.insertAdjacentHTML("beforeend", "<p>&zwj;</p>");

        }
        this.element.append(copyElement);
        let cloneRange;
        if (getSelection().rangeCount > 0) {
            cloneRange = getSelection().getRangeAt(0).cloneRange();
        }
        const range = copyElement.ownerDocument.createRange();
        if (copyEditElement.firstElementChild.tagName === "DIV") {
            range.setStart(copyElement.firstElementChild, 0);
        } else {
            range.setStartBefore(copyElement.firstElementChild);
        }
        if (copyEditElement.lastElementChild.tagName === "DIV") {
            range.setEndBefore(copyElement.lastElementChild);
        } else {
            range.setEndAfter(copyElement.lastElementChild);
        }
        focusByRange(range);
        this.copyingToX = true;
        try {
            document.execCommand("copy");
        } finally {
            this.copyingToX = false;
        }
        this.element.lastElementChild.remove();
        focusByRange(cloneRange);
        if (type) {
            showMessage(`${type === "zhihu" ? window.siyuan.languages.pasteToZhihu : window.siyuan.languages.pasteToWechatMP}`);
        }
    }

}
