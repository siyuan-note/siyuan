import {Tab} from "../Tab";
import {setPanelFocus} from "../util";
import {Model} from "../Model";

export class Custom extends Model {
    private element: Element;

    constructor(options: {
        tab: Tab,
        data: any,
        type: string,   // 同一类型的唯一标识
        init:(element:Element)=>void
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
        this.update();
    }

    private update() {
        this.element.innerHTML = `eee`
    }
}
