import {Tab} from "../Tab";
import {Model} from "../Model";
import {App} from "../../index";

export class Custom extends Model {
    public element: Element;
    public data: any;
    public type: string;
    public init: () => void;
    public destroy: () => void;
    public resize: () => void;
    public update: () => void;

    constructor(options: {
        app: App,
        type: string,
        tab: Tab,
        data: any,
        destroy?: () => void,
        resize?: () => void,
        update?: () => void,
        init: () => void
    }) {
        super({app: options.app, id: options.tab.id});
        this.type = options.type;
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement.classList.add("item--unupdate");
        }
        this.element = options.tab.panelElement;
        this.data = options.data;
        this.init = options.init;
        this.destroy = options.destroy;
        this.resize = options.resize;
        this.update = options.update;
        this.init();
    }
}
