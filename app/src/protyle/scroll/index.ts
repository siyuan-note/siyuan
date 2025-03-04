import {Constants} from "../../constants";
import {onGet} from "../util/onGet";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyTip} from "../util/compatibility";
import {hasClosestByClassName} from "../util/hasClosest";
import {goEnd, goHome} from "../wysiwyg/commonHotkey";
import {showTooltip} from "../../dialog/tooltip";

export class Scroll {
    public element: HTMLElement;
    private parentElement: HTMLElement;
    private inputElement: HTMLInputElement;
    public lastScrollTop: number;
    public keepLazyLoad: boolean;   // 保持加载内容

    constructor(protyle: IProtyle) {
        this.parentElement = document.createElement("div");
        this.parentElement.classList.add("protyle-scroll");
        this.parentElement.innerHTML = `<div class="protyle-scroll__up ariaLabel" data-position="north" aria-label="${updateHotkeyTip("⌘Home")}">
    <svg><use xlink:href="#iconUp"></use></svg>
</div>
<div class="fn__none protyle-scroll__bar ariaLabel" data-position="2west" aria-label="Blocks 1/1">
    <input class="b3-slider" type="range" max="1" min="1" step="1" value="1" />
</div>
<div class="protyle-scroll__down ariaLabel" aria-label="${updateHotkeyTip("⌘End")}">
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
            showTooltip(this.element.getAttribute("aria-label"), this.element);
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
        this.parentElement.addEventListener("mousewheel", (event: WheelEvent) => {
            if (event.deltaY !== 0 && protyle.scroll.lastScrollTop !== -1) {
                protyle.contentElement.scrollTop += event.deltaY;
            }
        }, {passive: true});
    }

    private setIndex(protyle: IProtyle) {
        if (protyle.wysiwyg.element.getAttribute("data-top")) {
            return;
        }
        protyle.wysiwyg.element.setAttribute("data-top", protyle.wysiwyg.element.scrollTop.toString());
        protyle.contentElement.style.overflow = "hidden";
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
                afterCB: () => {
                    setTimeout(() => {
                        protyle.contentElement.style.overflow = "";
                    }, Constants.TIMEOUT_INPUT);    // 需和 onGet 中的 preventScroll 保持一致
                    showTooltip(this.element.getAttribute("aria-label"), this.element);
                }
            });
        });
    }

    public updateIndex(protyle: IProtyle, id: string, cb?: (index: number) => void) {
        fetchPost("/api/block/getBlockIndex", {id}, (response) => {
            if (!response.data) {
                return;
            }
            const inputElement = protyle.scroll.element.querySelector(".b3-slider") as HTMLInputElement;
            inputElement.value = response.data;
            protyle.scroll.element.setAttribute("aria-label", `Blocks ${response.data}/${protyle.block.blockCount}`);
            if (cb) {
                cb(response.data);
            }
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
