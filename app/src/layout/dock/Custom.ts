import {Tab} from "../Tab";
import {setPanelFocus} from "../util";
import {Model} from "../Model";

export class Custom extends Model {
    private element: Element;

    constructor(options: {
        tab: Tab,
        data: any,
        destroy?: () => void,
        resize?: () => void,
        type: string,   // 同一类型的唯一标识
        init: (element: Element) => void
    }) {
        super({id: options.tab.id});
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement.classList.add("item--unupdate");
        }
        this.element = options.tab.panelElement;
        options.init(this.element);
        this.element.addEventListener("click", () => {
            setPanelFocus(this.element.parentElement.parentElement);
        });
        this.data = options.data;
        this.destroy = options.destroy;
        this.resize = options.resize;
    }

    public destroy() {
        if (this.destroy) {
            this.destroy();
        }
    }

    public resize() {
        if (this.resize) {
            this.resize();
        }
    }

    private update() {
        // TODO
    }
}
