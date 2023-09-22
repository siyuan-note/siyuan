import {openByMobile, writeText} from "../util/compatibility";
import {focusByRange} from "../util/selection";
import {showMessage} from "../../dialog/message";
import {isLocalPath, pathPosix} from "../../util/pathName";
import {previewDocImage} from "./image";
import {needSubscribe} from "../../util/needSubscribe";
import {Constants} from "../../constants";
import {getSearch, isMobile} from "../../util/functions";
/// #if !BROWSER
import {shell} from "electron";
/// #endif
/// #if !MOBILE
import {openAsset, openBy, updateOutline} from "../../editor/util";
import {getAllModels} from "../../layout/getAll";
import {setPanelFocus} from "../../layout/util";
/// #endif
import {fetchPost} from "../../util/fetch";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {speechRender} from "../render/speechRender";
import {avRender} from "../render/av/render";

export class Preview {
    public element: HTMLElement;
    public previewElement: HTMLElement;
    private mdTimeoutId: number;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-preview fn__none";

        const previewElement = document.createElement("div");
        previewElement.className = "b3-typography";
        if (protyle.options.classes.preview) {
            previewElement.classList.add(protyle.options.classes.preview);
        }
        previewElement.style.padding = protyle.wysiwyg.element.style.padding;

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
                    actionHtml.push('<button type="button" class="protyle-preview__action--current" data-type="desktop">Desktop</button>');
                    break;
                case "tablet":
                    actionHtml.push('<button type="button" data-type="tablet">Tablet</button>');
                    break;
                case "mobile":
                    actionHtml.push('<button type="button" data-type="mobile">Mobile/Wechat</button>');
                    break;
                case "mp-wechat":
                    actionHtml.push('<button type="button" data-type="mp-wechat" class="b3-tooltips b3-tooltips__w" aria-label="复制到公众号"><svg><use xlink:href="#iconMp"></use></svg></button>');
                    break;
                case "zhihu":
                    actionHtml.push('<button type="button" data-type="zhihu" class="b3-tooltips b3-tooltips__w" aria-label="复制到知乎"><svg><use xlink:href="#iconZhihu"></use></svg></button>');
                    break;
                case "yuque":
                    actionHtml.push('<button type="button" data-type="yuque" class="b3-tooltips b3-tooltips__w" aria-label="复制到语雀"><svg><use xlink:href="#iconYuque"></use></svg></button>');
                    break;
            }
        }
        actionElement.innerHTML = actionHtml.join("");
        this.element.appendChild(actionElement);
        this.element.appendChild(previewElement);

        this.element.addEventListener("click", (event) => {
            if (protyle.model) {
                setPanelFocus(protyle.model.element.parentElement.parentElement);
                updateOutline(getAllModels(), protyle.model.editor.protyle);
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.tagName === "A") {
                    const linkAddress = target.getAttribute("href");
                    if (linkAddress.startsWith("#")) {
                        // 导出预览模式点击块引转换后的脚注跳转不正确 https://github.com/siyuan-note/siyuan/issues/5700
                        previewElement.querySelector(linkAddress).scrollIntoView();
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
                        if (event.metaKey || event.ctrlKey) {
                            openBy(linkAddress, "folder");
                        } else if (event.shiftKey) {
                            openBy(linkAddress, "app");
                        } else if (Constants.SIYUAN_ASSETS_EXTS.includes(pathPosix().extname((linkAddress.split("?page")[0])))) {
                            openAsset(protyle.app, linkAddress.split("?page")[0], parseInt(getSearch("page", linkAddress)));
                        }
                        /// #endif
                    } else {
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
                    previewDocImage((event.target as HTMLImageElement).src, protyle.block.rootID);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (target.tagName === "BUTTON") {
                    const type = target.getAttribute("data-type");
                    const actionCustom = actions.find((w: IPreviewActionCustom) => w?.key === type) as IPreviewActionCustom;
                    if (actionCustom) {
                        actionCustom.click(type);
                    } else if ((type === "mp-wechat" || type === "zhihu" || type === "yuque")) {
                        this.copyToX(this.element.lastElementChild.cloneNode(true) as HTMLElement, protyle, type);
                    } else if (type === "desktop") {
                        previewElement.style.width = "";
                        previewElement.style.padding = protyle.wysiwyg.element.style.padding;
                    } else if (type === "tablet") {
                        previewElement.style.width = "1024px";
                        previewElement.style.padding = "8px 16px";
                    } else {
                        previewElement.style.width = "360px";
                        previewElement.style.padding = "8px";
                    }
                    this.render(protyle);
                    actionElement.querySelectorAll("button").forEach((item) => {
                        item.classList.remove("protyle-preview__action--current");
                    });
                    target.classList.add("protyle-preview__action--current");
                }
                target = target.parentElement;
            }
        });

        this.previewElement = previewElement;
    }

    public render(protyle: IProtyle, cb?: (outlineData: IBlockTree[]) => void) {
        if (this.element.style.display === "none") {
            return;
        }
        let loadingElement = this.element.querySelector(".fn__loading");
        if (!loadingElement) {
            this.element.insertAdjacentHTML("beforeend", `<div style="flex-direction: column;" class="fn__loading">
    <img width="48px" src="/stage/loading-pure.svg">
</div>`);
            loadingElement = this.element.querySelector(".fn__loading");
        }
        this.mdTimeoutId = window.setTimeout(() => {
            fetchPost("/api/export/preview", {
                id: protyle.block.parentID || protyle.options.blockId,
            }, response => {
                const oldScrollTop = protyle.preview.previewElement.scrollTop;
                protyle.preview.previewElement.innerHTML = response.data.html;
                processRender(protyle.preview.previewElement);
                highlightRender(protyle.preview.previewElement);
                avRender(protyle.preview.previewElement, protyle);
                speechRender(protyle.preview.previewElement, protyle.options.lang);
                protyle.preview.previewElement.scrollTop = oldScrollTop;
                /// #if MOBILE
                if (cb) {
                    cb(response.data.outline);
                }
                /// #else
                response.data = response.data.outline;
                getAllModels().outline.forEach(item => {
                    if (item.type === "pin" || (item.type === "local" && item.blockId === protyle.block.rootID)) {
                        item.isPreview = true;
                        item.update(response, protyle.block.rootID);
                        if (item.type === "pin") {
                            item.updateDocTitle(protyle.background.ial);
                        }
                    }
                });
                /// #endif
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

    private copyToX(copyElement: HTMLElement, protyle: IProtyle, type?: string) {
        // fix math render
        if (type === "mp-wechat") {
            this.link2online(copyElement);
            copyElement.querySelectorAll(".katex-html .base").forEach((item: HTMLElement) => {
                item.style.display = "initial";
            });
            copyElement.querySelectorAll("mjx-container > svg").forEach((item) => {
                item.setAttribute("width", (parseInt(item.getAttribute("width")) * 8) + "px");
            });
        } else if (type === "zhihu") {
            this.link2online(copyElement);
            copyElement.querySelectorAll('[data-subtype="math"]').forEach((item: HTMLElement) => {
                item.outerHTML = `<img class="Formula-image" data-eeimg="true" src="//www.zhihu.com/equation?tex=" alt="${item.getAttribute("data-content")}\\" style="display: block; margin: 0 auto; max-width: 100%;">`;
            });
            copyElement.querySelectorAll("blockquote").forEach((item) => {
                const elements: HTMLElement[] = [];
                this.processZHBlockquote(item, elements);
                elements.reverse().forEach(newItem => {
                    item.insertAdjacentElement("afterend", newItem);
                });
                item.remove();
            });
            this.processZHTable(copyElement);
        } else if (type === "yuque") {
            fetchPost("/api/lute/copyStdMarkdown", {
                id: protyle.block.rootID,
            }, (response) => {
                writeText(response.data);
                showMessage("已复制，可到语雀进行粘贴");
            });
            return;
        }
        // 防止背景色被粘贴到公众号中
        copyElement.style.backgroundColor = "#fff";
        // 代码背景
        copyElement.querySelectorAll("code").forEach((item) => {
            item.style.backgroundImage = "none";
        });
        this.element.append(copyElement);
        const cloneRange = getSelection().getRangeAt(0).cloneRange();
        const range = copyElement.ownerDocument.createRange();
        range.selectNodeContents(copyElement);
        focusByRange(range);
        document.execCommand("copy");
        this.element.lastElementChild.remove();
        focusByRange(cloneRange);
        if (type) {
            showMessage(`已复制，可到${type === "zhihu" ? "知乎" : "微信公众号平台"}进行粘贴`);
        }
    }

    private processZHBlockquote(element: HTMLElement, elements: HTMLElement[]) {
        Array.from(element.children).forEach((item: HTMLElement) => {
            if (item.tagName === "BLOCKQUOTE") {
                this.processZHBlockquote(item, elements);
            } else if (item.tagName !== "P" || item.querySelector("img")) {
                elements.push(item);
            } else {
                const lastElement = elements[elements.length - 1];
                if (!lastElement || (lastElement && lastElement.tagName !== "BLOCKQUOTE")) {
                    elements.push(document.createElement("blockquote"));
                }
                elements[elements.length - 1].append(item);
            }
        });
    }

    private processZHTable(element: HTMLElement) {
        element.querySelectorAll("table").forEach(item => {
            const headElement = item.querySelector("thead");
            if (!headElement) {
                return;
            }
            const tbodyElement = item.querySelector("tbody");
            if (tbodyElement) {
                tbodyElement.insertAdjacentElement("afterbegin", headElement.firstElementChild);
            } else {
                item.innerHTML = `<tbody>${headElement.innerHTML}</tbody>`;
            }
            headElement.remove();
        });
    }
}
