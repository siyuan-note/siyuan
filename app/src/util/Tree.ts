import {getIconByType} from "../editor/getIcon";
import {hasClosestByMatchTag, hasClosestByTag} from "../protyle/util/hasClosest";
import {isMobile} from "./functions";
import {mathRender} from "../protyle/render/mathRender";
import {unicode2Emoji} from "../emoji";
import {Constants} from "../constants";
import {escapeAriaLabel} from "./escape";

export class Tree {
    public element: HTMLElement;
    private data: IBlockTree[];
    private blockExtHTML: string;
    private topExtHTML: string;

    public click: (element: Element, event?: MouseEvent) => void;
    private ctrlClick: (element: HTMLElement) => void;
    private toggleClick: (element: Element) => void;
    private shiftClick: (element: HTMLElement) => void;
    private altClick: (element: HTMLElement) => void;
    private rightClick: (element: HTMLElement, event: MouseEvent) => void;

    constructor(options: {
        element: HTMLElement,
        data: IBlockTree[],
        blockExtHTML?: string,
        topExtHTML?: string,
        click?(element: HTMLElement, event: MouseEvent): void
        ctrlClick?(element: HTMLElement): void
        altClick?(element: HTMLElement): void
        shiftClick?(element: HTMLElement): void
        toggleClick?(element: HTMLElement): void
        rightClick?(element: HTMLElement, event: MouseEvent): void
    }) {
        this.click = options.click;
        this.ctrlClick = options.ctrlClick;
        this.altClick = options.altClick;
        this.shiftClick = options.shiftClick;
        this.rightClick = options.rightClick;
        this.toggleClick = options.toggleClick;
        this.element = options.element;
        this.blockExtHTML = options.blockExtHTML;
        this.topExtHTML = options.topExtHTML;
        this.updateData(options.data);
        this.bindEvent();
    }

    public updateData(data: IBlockTree[]) {
        this.data = data;
        if (!this.data || this.data.length === 0) {
            this.element.innerHTML = `<ul class="b3-list b3-list--background"><li class="b3-list--empty">${window.siyuan.languages.emptyContent}</li></ul>`;
        } else {
            this.element.innerHTML = this.genHTML(this.data);
            mathRender(this.element);
        }
    }

    private genHTML(data: IBlockTree[]) {
        let html = `<ul${data[0].depth === 0 ? " class='b3-list b3-list--background'" : ""}>`;
        data.forEach((item) => {
            let titleTip = "";
            let iconHTML = '<svg class="b3-list-item__graphic"><use xlink:href="#iconFolder"></use></svg>';
            if (item.type === "bookmark") {
                iconHTML = '<svg class="b3-list-item__graphic"><use xlink:href="#iconBookmark"></use></svg>';
            } else if (item.type === "tag") {
                iconHTML = '<svg class="b3-list-item__graphic"><use xlink:href="#iconTags"></use></svg>';
            } else if (item.type === "backlink") {
                titleTip = ` aria-label="${escapeAriaLabel(item.hPath)}"`;
                iconHTML = `<svg class="b3-list-item__graphic popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.nodeType, item.subType)}"></use></svg>`;
            } else if (item.type === "outline") {
                titleTip = ` aria-label="${escapeAriaLabel(Lute.BlockDOM2Content(item.name))}"`;
                iconHTML = `<svg class="b3-list-item__graphic popover__block" data-id="${item.id}" style="height: 22px;width: 10px;"><use xlink:href="#${getIconByType(item.nodeType, item.subType)}"></use></svg>`;
            }
            let countHTML = "";
            if (item.count) {
                countHTML = `<span class="counter">${item.count}</span>`;
            }
            const hasChild = (item.children && item.children.length > 0) || (item.blocks && item.blocks.length > 0);
            let style = "";
            if (isMobile()) {
                if (item.depth > 0) {
                    style = `padding-left: ${(item.depth - 1) * 20 + 24}px`;
                }
            } else {
                style = `padding-left: ${(item.depth - 1) * 18 + 22}px;margin-right: 2px`;
            }
            const showArrow = hasChild || (item.type === "backlink" && !isMobile());
            // data-id 需要添加 item.id，否则大纲更新时 name 不一致导致 https://github.com/siyuan-note/siyuan/issues/11843
            html += `<li class="b3-list-item${isMobile() ? "" : " b3-list-item--hide-action"}" 
${item.id ? 'data-node-id="' + item.id + '"' : ""} 
${item.box ? 'data-notebook-id="' + item.box + '"' : ""} 
style="--file-toggle-width:${(item.depth - 1) * 18 + 38}px" 
data-treetype="${item.type}" 
data-type="${item.nodeType}" 
data-subtype="${item.subType}" 
${item.label ? "data-label='" + item.label + "'" : ""}>
    <span style="${style}" class="b3-list-item__toggle${showArrow ? " b3-list-item__toggle--hl" : ""}${showArrow ? "" : " fn__hidden"}">
        <svg data-id="${item.id || encodeURIComponent(item.name + item.depth)}" class="b3-list-item__arrow${hasChild ? " b3-list-item__arrow--open" : ""}"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${iconHTML}
    <span class="b3-list-item__text ariaLabel" data-position="parentE"${titleTip}>${item.name}</span>
    ${this.topExtHTML || ""}
    ${countHTML}
</li>`;
            if (item.children && item.children.length > 0) {
                html += this.genHTML(item.children) + "</ul>";
            }
            if (item.blocks && item.blocks.length > 0) {
                html += this.genBlockHTML(item.blocks, true, item.type) + "</ul>";
            }
        });
        return html;
    }

    private genBlockHTML(data: IBlock[], show = false, type: string) {
        let html = `<ul class="${!show ? "fn__none" : ""}">`;
        data.forEach((item: IBlock & {
            subType: string;
            count: string;
            ial?: {
                icon: string
            }
        }) => {
            let countHTML = "";
            if (item.count) {
                countHTML = `<span class="counter">${item.count}</span>`;
            }
            let iconHTML;
            if (type === "outline") {
                iconHTML = `<svg data-defids='["${item.defID}"]' class="b3-list-item__graphic popover__block" data-id="${item.id}" style="height: 22px;width: 10px;"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>`;
            } else {
                if (item.type === "NodeDocument") {
                    iconHTML = `<span data-defids='["${item.defID}"]' class="b3-list-item__graphic popover__block" data-id="${item.id}">${unicode2Emoji(item.ial.icon || Constants.SIYUAN_IMAGE_FILE)}</span>`;
                } else {
                    iconHTML = `<svg data-defids='["${item.defID}"]' class="b3-list-item__graphic popover__block" data-id="${item.id}"><use xlink:href="#${getIconByType(item.type, item.subType)}"></use></svg>`;
                }
            }
            let style = "";
            if (isMobile()) {
                if (item.depth > 0) {
                    style = `padding-left: ${(item.depth - 1) * 20 + 24}px`;
                }
            } else {
                style = `padding-left: ${(item.depth - 1) * 18 + 22}px;margin-right: 2px`;
            }
            html += `<li class="b3-list-item${isMobile() ? "" : " b3-list-item--hide-action"}"  
style="--file-toggle-width:${(item.depth - 1) * 18 + 38}px" 
data-node-id="${item.id}" 
data-ref-text="${encodeURIComponent(item.refText)}" 
data-def-id="${item.defID}" 
data-type="${item.type}" 
data-subtype="${item.subType}" 
data-treetype="${type}" 
data-def-path="${item.defPath}">
    <span style="${style}" class="b3-list-item__toggle${item.children ? " b3-list-item__toggle--hl" : ""}${item.children ? "" : " fn__hidden"}">
        <svg data-id="${item.id}" class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${iconHTML}
    <span class="b3-list-item__text ariaLabel" data-position="parentE" ${type === "outline" ? ' aria-label="' + escapeAriaLabel(Lute.BlockDOM2Content(item.content)) + '"' : ""}>${item.content}</span>
    ${countHTML}
    ${this.blockExtHTML || ""}
</li>`;
            if (item.children && item.children.length > 0) {
                html += this.genBlockHTML(item.children, false, type) + "</ul>";
            }
        });
        return html;
    }

    public toggleBlocks(liElement: Element) {
        if (this.toggleClick) {
            this.toggleClick(liElement);
            return;
        }
        if (!liElement.nextElementSibling) {
            return;
        }
        const svgElement = liElement.firstElementChild.firstElementChild;
        if (svgElement.classList.contains("b3-list-item__arrow--open")) {
            svgElement.classList.remove("b3-list-item__arrow--open");
            liElement.nextElementSibling.classList.add("fn__none");
            if (liElement.nextElementSibling.nextElementSibling && liElement.nextElementSibling.nextElementSibling.tagName === "UL") {
                liElement.nextElementSibling.nextElementSibling.classList.add("fn__none");
            }
        } else {
            svgElement.classList.add("b3-list-item__arrow--open");
            liElement.nextElementSibling.classList.remove("fn__none");
            if (liElement.nextElementSibling.nextElementSibling && liElement.nextElementSibling.nextElementSibling.tagName === "UL") {
                liElement.nextElementSibling.nextElementSibling.classList.remove("fn__none");
            }
        }
    }

    private setCurrent(target: HTMLElement) {
        if (target.classList.contains("b3-list--empty")) {
            return;
        }
        this.element.querySelectorAll("li").forEach((liItem) => {
            liItem.classList.remove("b3-list-item--focus");
        });
        target.classList.add("b3-list-item--focus");
    }

    private bindEvent() {
        this.element.addEventListener("contextmenu", (event) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.tagName === "LI" && this.rightClick) {
                    this.rightClick(target, event);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("b3-list-item__toggle") && !target.classList.contains("fn__hidden")) {
                    this.toggleBlocks(target.parentElement);
                    this.setCurrent(target.parentElement);
                    event.preventDefault();
                    break;
                }
                if (target.classList.contains("b3-list-item__action") && this.click) {
                    // 移动端书签父节点删除按钮
                    const liElement = hasClosestByMatchTag(target, "LI");
                    if (liElement) {
                        this.click(liElement, event);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.tagName === "LI") {
                    this.setCurrent(target);
                    if (target.getAttribute("data-node-id") || target.getAttribute("data-treetype") === "tag") {
                        if (this.ctrlClick && window.siyuan.ctrlIsPressed) {
                            this.ctrlClick(target);
                        } else if (this.altClick && window.siyuan.altIsPressed) {
                            this.altClick(target);
                        } else if (this.shiftClick && window.siyuan.shiftIsPressed) {
                            this.shiftClick(target);
                        } else if (this.click) {
                            this.click(target, event);
                        }
                        event.stopPropagation();
                    } else {
                        this.toggleBlocks(target);
                    }
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.element.addEventListener("dragstart", (event: DragEvent & { target: HTMLElement }) => {
            const liElement = hasClosestByTag(event.target, "LI");
            if (liElement) {
                event.dataTransfer.setData("text/html", liElement.outerHTML);
                // 设置了的话 drop 就无法监听 alt event.dataTransfer.dropEffect = "move";
                liElement.style.opacity = "0.1";
                window.siyuan.dragElement = liElement;
            }
        });
        this.element.addEventListener("dragend", (event: DragEvent & { target: HTMLElement }) => {
            const liElement = hasClosestByTag(event.target, "LI");
            if (liElement) {
                liElement.style.opacity = "1";
            }
            window.siyuan.dragElement = undefined;
        });
    }

    public expandAll() {
        this.element.querySelectorAll("ul").forEach(item => {
            if (!item.classList.contains("b3-list")) {
                item.classList.remove("fn__none");
            }
        });
        this.element.querySelectorAll(".b3-list-item__arrow").forEach(item => {
            item.classList.add("b3-list-item__arrow--open");
        });
    }

    public collapseAll() {
        this.element.querySelectorAll("ul").forEach(item => {
            if (!item.classList.contains("b3-list")) {
                item.classList.add("fn__none");
            }
        });
        this.element.querySelectorAll(".b3-list-item__arrow").forEach(item => {
            item.classList.remove("b3-list-item__arrow--open");
        });
    }

    public getExpandIds() {
        const ids: string[] = [];
        this.element.querySelectorAll(".b3-list-item__arrow--open").forEach(item => {
            ids.push(item.getAttribute("data-id"));
        });
        return ids;
    }

    public setExpandIds(ids: string[]) {
        this.element.querySelectorAll(".b3-list-item__arrow").forEach(item => {
            if (ids.includes(item.getAttribute("data-id"))) {
                item.classList.add("b3-list-item__arrow--open");
                if (item.parentElement.parentElement.nextElementSibling) {
                    item.parentElement.parentElement.nextElementSibling.classList.remove("fn__none");
                }
            } else {
                item.classList.remove("b3-list-item__arrow--open");
                if (item.parentElement.parentElement.nextElementSibling && item.parentElement.parentElement.nextElementSibling.tagName === "UL") {
                    item.parentElement.parentElement.nextElementSibling.classList.add("fn__none");
                }
            }
        });
    }
}
