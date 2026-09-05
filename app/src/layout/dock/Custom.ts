import {Tab} from "../Tab";
import {Model} from "../Model";
import type {App} from "../../index";
import {Protyle} from "../../protyle";

export class Custom extends Model {
    public element: Element;
    public tab: Tab;
    public data: any;
    public type: string;
    public init: (this: Custom, custom: Custom) => void;
    public destroy: (this: Custom) => void;
    public beforeDestroy: (this: Custom) => void;
    public resize: (this: Custom) => void;
    public update: (this: Custom) => void;
    public editors: Protyle[] = [];

    constructor(options: {
        app: App,
        type: string,
        tab: Tab,
        data: any,
        destroy?: (this: Custom) => void,
        beforeDestroy?: (this: Custom) => void,
        resize?: (this: Custom) => void,
        update?: (this: Custom) => void,
        init: (this: Custom, custom: Custom) => void
    }) {
        super({app: options.app});
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement?.classList.add("item--unupdate");
        }

        this.element = options.tab.panelElement;
        this.tab = options.tab;
        this.data = options.data;
        this.type = options.type;
        this.init = options.init;
        if (typeof options.destroy === "function") {
            this.destroy = options.destroy;
        }
        this.beforeDestroy = options.beforeDestroy;
        this.resize = options.resize;
        this.update = options.update;
        this.init(this);
    }
}
