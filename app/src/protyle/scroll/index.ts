import {Constants} from "../../constants";
import {onGet} from "../util/onGet";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyTip} from "../util/compatibility";
import {hasClosestByClassName} from "../util/hasClosest";
import {goEnd, goHome} from "../wysiwyg/commonHotkey";
import {isMobile} from "../../util/functions";

export class Scroll {
    public element: HTMLElement;
    private parentElement: HTMLElement;
    private inputElement: HTMLInputElement;
    public lastScrollTop: number;
    public keepLazyLoad: boolean;   // 保持加载内容

    constructor(protyle: IProtyle) {
        this.parentElement = document.createElement("div");
        this.parentElement.classList.add("protyle-scroll");
        if (!isMobile()) {
            this.parentElement.style.right = "10px";
        }
        this.parentElement.innerHTML = `<div class="b3-tooltips b3-tooltips__w protyle-scroll__up" aria-label="${updateHotkeyTip("⌘Home")}">
    <svg><use xlink:href="#iconUp"></use></svg>
</div>
<div class="fn__none protyle-scroll__bar b3-tooltips b3-tooltips__s" aria-label="Blocks 1/1">
    <input class="b3-slider" type="range" max="1" min="1" step="1" value="1" />
</div>
<div class="b3-tooltips b3-tooltips__w protyle-scroll__down" aria-label="${updateHotkeyTip("⌘End")}">
    <svg><use xlink:href="#iconDown"></use></svg>
</div>`;

        this.element = this.parentElement.querySelector(".protyle-scroll__bar");
        this.keepLazyLoad = false;
        if (!protyle.options.render.scroll) {
            this.parentElement.classList.add("fn__none");
        }
        this.lastScrollTop = 0;
        this.inputElement = this.element.firstElementChild as HTMLInputElement;
        this.inputElement.addEventListener("input", () => {
            this.element.setAttribute("aria-label", `Blocks ${this.inputElement.value}/${protyle.block.blockCount}`);
        });
        /// #if BROWSER
        this.inputElement.addEventListener("change", () => {
            this.setIndex(protyle);
        });
        this.inputElement.addEventListener("touchend", () => {
            this.setIndex(protyle);
        });
        /// #endif
        this.parentElement.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            if (hasClosestByClassName(target, "protyle-scroll__up")) {
                goHome(protyle);
            } else if (hasClosestByClassName(target, "protyle-scroll__down")) {
                goEnd(protyle);
            } else if (target.classList.contains("b3-slider")) {
                this.setIndex(protyle);
            }
        });
    }

    private setIndex(protyle: IProtyle) {
        if (protyle.wysiwyg.element.getAttribute("data-top")) {
            return;
        }
        protyle.wysiwyg.element.setAttribute("data-top", protyle.wysiwyg.element.scrollTop.toString());
        fetchPost("/api/filetree/getDoc", {
            index: parseInt(this.inputElement.value),
            id: protyle.block.parentID,
            mode: 0,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet({
                data: getResponse,
                protyle,
                action: [Constants.CB_GET_FOCUSFIRST, Constants.CB_GET_UNCHANGEID],
            });
        });
    }

    public updateIndex(protyle: IProtyle, id: string) {
        fetchPost("/api/block/getBlockIndex", {id}, (response) => {
            if (!response.data) {
                return;
            }
            const inputElement = protyle.scroll.element.querySelector(".b3-slider") as HTMLInputElement;
            inputElement.value = response.data;
            protyle.scroll.element.setAttribute("aria-label", `Blocks ${response.data}/${protyle.block.blockCount}`);
        });
    }

    public update(protyle: IProtyle) {
        if (typeof protyle.block.blockCount === "number") {
            this.inputElement.setAttribute("max", protyle.block.blockCount.toString());
            this.element.setAttribute("aria-label", `Blocks ${this.inputElement.value}/${protyle.block.blockCount}`);
        }
        if (protyle.block.showAll) {
            this.element.classList.add("fn__none");
        } else {
            if (protyle.block.scroll && !protyle.contentElement.classList.contains("fn__none")) {
                this.element.classList.remove("fn__none");
            } else {
                this.element.classList.add("fn__none");
            }
        }
    }
}
