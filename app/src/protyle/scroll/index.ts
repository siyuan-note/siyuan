import {Constants} from "../../constants";
import {onGet} from "../util/onGet";
import {fetchPost} from "../../util/fetch";

export class Scroll {
    public element: HTMLElement;
    private inputElement: HTMLInputElement;
    public blockSize: number;
    public lastScrollTop: number;
    public keepLazyLoad: boolean;

    constructor(protyle: IProtyle) {
        const divElement = document.createElement("div");
        divElement.innerHTML = "<input class='b3-slider' type='range' max='1' min='1' step='1' value='1' />";
        divElement.className = "fn__none protyle-scroll b3-tooltips b3-tooltips__s";
        divElement.setAttribute("aria-label", "Blocks 1/1");
        this.element = divElement;
        this.keepLazyLoad =  false;
        if (!protyle.options.render.scroll) {
            this.element.classList.add("fn__none");
        }
        this.lastScrollTop = 0;
        this.inputElement = divElement.firstElementChild as HTMLInputElement;
        this.inputElement.addEventListener("input", () => {
            this.element.setAttribute("aria-label", `Blocks ${this.inputElement.value}/${this.blockSize}`);
        });
        /// #if BROWSER
        this.inputElement.addEventListener("change", () => {
            this.setIndex(protyle);
        });
        this.inputElement.addEventListener("touchend", () => {
            this.setIndex(protyle);
        });
        /// #endif
        this.inputElement.addEventListener("click", () => {
            this.setIndex(protyle);
        });
    }

    private setIndex(protyle: IProtyle) {
        if (protyle.wysiwyg.element.getAttribute("data-top") || !protyle.model) {
            return;
        }
        protyle.wysiwyg.element.setAttribute("data-top", protyle.wysiwyg.element.scrollTop.toString());
        fetchPost("/api/filetree/getDoc", {
            index: parseInt(this.inputElement.value),
            id: protyle.block.parentID,
            mode: 0,
            size: Constants.SIZE_GET,
        }, getResponse => {
            onGet(getResponse, protyle, [Constants.CB_GET_FOCUSFIRST, Constants.CB_GET_UNCHANGEID]);
        });
    }

    public update(blockSize: number, protyle: IProtyle) {
        if (typeof blockSize === "number") {
            this.blockSize = blockSize;
            this.inputElement.setAttribute("max", this.blockSize.toString());
            this.element.setAttribute("aria-label", `Blocks ${this.inputElement.value}/${this.blockSize}`);
        }
        if (protyle.block.showAll) {
            this.element.classList.add("fn__none");
        } else {
            if (blockSize > Constants.SIZE_GET) {
                this.element.classList.remove("fn__none");
            } else {
                this.element.classList.add("fn__none");
            }
        }
    }
}
