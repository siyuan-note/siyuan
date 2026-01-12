import {isOnlyMeta, openByMobile, writeText} from "../util/compatibility";
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
import {openAsset, openBy} from "../../editor/util";
import {getAllModels} from "../../layout/getAll";
/// #endif
import {fetchPost} from "../../util/fetch";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {speechRender} from "../render/speechRender";
import {avRender} from "../render/av/render";
import {getPadding} from "../ui/initUI";
import {hasClosestByAttribute} from "../util/hasClosest";
import {addScriptSync} from "../util/addScript";

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
                        } else if (Constants.SIYUAN_ASSETS_EXTS.includes(pathPosix().extname((linkAddress).split("?")[0]))) {
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
                    previewDocImage((event.target as HTMLElement).getAttribute("src"), protyle.block.rootID);
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
                    if (type !== "mp-wechat" && type !== "zhihu" && type !== "yuque") {
                        actionElement.querySelectorAll("button").forEach((item) => {
                            item.classList.remove("protyle-preview__action--current");
                        });
                        target.classList.add("protyle-preview__action--current");
                    }
                }
                target = target.parentElement;
            }
            const nodeElement = hasClosestByAttribute(event.target as HTMLElement, "id", undefined);
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
            }
        });

        this.previewElement = previewElement;
    }

    public render(protyle: IProtyle) {
        if (this.element.style.display === "none") {
            return;
        }
        if (this.element.querySelector('.protyle-preview__action [data-type="desktop"]')?.classList.contains("protyle-preview__action--current")) {
            const padding = getPadding(protyle);
            this.previewElement.style.padding = `${padding.top}px ${padding.left}px ${padding.bottom}px ${padding.right}px`;
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
                id: protyle.block.id || protyle.options.blockId || protyle.block.parentID,
            }, response => {
                const oldScrollTop = protyle.preview.previewElement.scrollTop;
                protyle.preview.previewElement.innerHTML = response.data.html;
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
            // 列表嵌套 https://github.com/siyuan-note/siyuan/issues/11276
            copyElement.querySelectorAll("ul, ol").forEach(listItem => {
                Array.from(listItem.children).forEach(liItem => {
                    const nestedList = liItem.querySelector("ul, ol");
                    if (nestedList) {
                        liItem.parentNode.insertBefore(nestedList, liItem.nextSibling);
                    }
                });
            });
            // 处理任务列表（微信公众号不能显示input[type="checkbox"]）
            copyElement.querySelectorAll("li.protyle-task").forEach((taskItem: HTMLElement) => {
                const checkbox = taskItem.querySelector('input[type="checkbox"]') as HTMLInputElement;
                if (checkbox) {
                    checkbox.style.opacity = "0";
                    if (checkbox.checked) {
                        taskItem.style.setProperty("list-style-type", "'✅'", "important");
                    } else {
                        taskItem.style.setProperty("list-style-type", "'▢'", "important");
                    }
                }
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
        } else if (type === "zhihu") {
            this.link2online(copyElement);
            copyElement.querySelectorAll('[data-subtype="math"]').forEach((item: HTMLElement) => {
                // https://github.com/siyuan-note/siyuan/issues/10015
                item.outerHTML = `<img class="Formula-image" data-eeimg="true" src="//www.zhihu.com/equation?tex=" alt="${item.getAttribute("data-content")}" style="${item.tagName === "DIV" ? "display: block; max-width: 100%;" : ""}margin: 0 auto;">`;
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
        this.element.append(copyElement);
        // 最后一个块是公式块时无法复制下来
        copyElement.insertAdjacentHTML("beforeend", "<p>&zwj;</p>");
        let cloneRange;
        if (getSelection().rangeCount > 0) {
            cloneRange = getSelection().getRangeAt(0).cloneRange();
        }
        const range = copyElement.ownerDocument.createRange();
        range.selectNodeContents(copyElement);
        focusByRange(range);
        document.execCommand("copy");
        this.element.lastElementChild.remove();
        focusByRange(cloneRange);
        if (type) {
            showMessage(`${type === "zhihu" ? window.siyuan.languages.pasteToZhihu : window.siyuan.languages.pasteToWechatMP}`);
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
