import {Tab} from "../Tab";
import {setPanelFocus} from "../util";
import {Model} from "../Model";

export class Custom extends Model {
    private element: Element;
    public data: any;
    public type: string;
    public init: () => void;
    public destroy: () => void;
    public resize: () => void;
    public update: () => void;

    constructor(options: {
        type: string,
        tab: Tab,
        data: any,
        destroy?: () => void,
        resize?: () => void,
        update?: () => void,
        init: () => void
    }) {
        super({id: options.tab.id});
        this.type = options.type;
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement.classList.add("item--unupdate");
        }
        this.element = options.tab.panelElement;
        this.data = options.data;
        this.element.addEventListener("click", () => {
            setPanelFocus(this.element.parentElement.parentElement);
        });
        this.init = options.init;
        this.destroy = options.destroy;
        this.resize = options.resize;
        this.update = options.update;
        this.init();
    }
}
