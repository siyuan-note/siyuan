import {App} from "../index";
import {EventBus} from "./EventBus";
import {fetchPost} from "../util/fetch";
import {isMobile, isWindow} from "../util/functions";
/// #if !MOBILE
import {Custom} from "../layout/dock/Custom";
/// #endif
import {Tab} from "../layout/Tab";
import {getDockByType, setPanelFocus} from "../layout/util";
import {hasClosestByAttribute} from "../protyle/util/hasClosest";
import {BlockPanel} from "../block/Panel";
import {Setting} from "./Setting";

export class Plugin {
    private app: App;
    public i18n: IObject;
    public eventBus: EventBus;
    public data: any = {};
    public name: string;
    // TODO
    public customBlockRenders: {
        [key: string]: {
            icon: string,
            action: "edit" | "more"[],
            genCursor: boolean,
            render: (options: { app: App, element: Element }) => void
        }
    } = {};
    public topBarIcons: Element[] = [];
    public setting: Setting;
    public statusBarIcons: Element[] = [];
    public commands: ICommand[] = [];
    public models: {
        /// #if !MOBILE
        [key: string]: (options: { tab: Tab, data: any }) => Custom
        /// #endif
    } = {};
    public docks: {
        /// #if !MOBILE
        [key: string]: {
            config: IPluginDockTab,
            model: (options: { tab: Tab }) => Custom
        }
        /// #endif
    } = {};

    constructor(options: {
        app: App,
        name: string,
        i18n: IObject
    }) {
        this.app = options.app;
        this.i18n = options.i18n;
        this.name = options.name;
        this.eventBus = new EventBus(options.name);
    }

    public onload() {
        // 加载
    }

    public onunload() {
        // 禁用/卸载
    }

    public onLayoutReady() {
        // 布局加载完成
    }

    public addCommand(command: ICommand) {
        this.commands.push(command);
    }

    public addIcons(svg: string) {
        document.body.insertAdjacentHTML("afterbegin", `<svg data-name="${this.name}" style="position: absolute; width: 0; height: 0; overflow: hidden;" xmlns="http://www.w3.org/2000/svg">
<defs>${svg}</defs></svg>`);
    }

    public addTopBar(options: {
        icon: string,
        title: string,
        position?: "right" | "left",
        callback: (evt: MouseEvent) => void
    }) {
        if (!options.icon.startsWith("icon") && !options.icon.startsWith("<svg")) {
            console.error(`plugin ${this.name} addTopBar error: icon must be svg id or svg tag`);
            return;
        }
        const iconElement = document.createElement("div");
        iconElement.setAttribute("data-menu", "true");
        iconElement.addEventListener("click", options.callback);
        iconElement.id = `plugin_${this.name}_${this.topBarIcons.length}`;
        if (isMobile()) {
            iconElement.className = "b3-menu__item";
            iconElement.innerHTML = (options.icon.startsWith("icon") ? `<svg class="b3-menu__icon"><use xlink:href="#${options.icon}"></use></svg>` : options.icon) +
                `<span class="b3-menu__label">${options.title}</span>`;
        } else if (!isWindow()) {
            iconElement.className = "toolbar__item b3-tooltips b3-tooltips__sw";
            iconElement.setAttribute("aria-label", options.title);
            iconElement.innerHTML = options.icon.startsWith("icon") ? `<svg><use xlink:href="#${options.icon}"></use></svg>` : options.icon;
            iconElement.addEventListener("click", options.callback);
            iconElement.setAttribute("data-position", options.position || "right");
        }
        this.topBarIcons.push(iconElement);
        return iconElement;
    }

    public addStatusBar(options: {
        element: HTMLElement,
        position?: "right" | "left",
    }) {
        /// #if !MOBILE
        options.element.setAttribute("data-position", options.position || "right");
        this.statusBarIcons.push(options.element);
        return options.element;
        /// #endif
    }

    public openSetting() {
        if (!this.setting) {
            return;
        }
        this.setting.open(this.name);
    }

    public loadData(storageName: string) {
        if (typeof this.data[storageName] === "undefined") {
            this.data[storageName] = "";
        }
        return new Promise((resolve) => {
            fetchPost("/api/file/getFile", {path: `/data/storage/petal/${this.name}/${storageName}`}, (response) => {
                if (response.code !== 404) {
                    this.data[storageName] = response;
                }
                resolve(this.data[storageName]);
            });
        });
    }

    public saveData(storageName: string, data: any) {
        return new Promise((resolve) => {
            const pathString = `/data/storage/petal/${this.name}/${storageName}`;
            let file: File;
            if (typeof data === "object") {
                file = new File([new Blob([JSON.stringify(data)], {
                    type: "application/json"
                })], pathString.split("/").pop());
            } else {
                file = new File([new Blob([data])], pathString.split("/").pop());
            }
            const formData = new FormData();
            formData.append("path", pathString);
            formData.append("file", file);
            formData.append("isDir", "false");
            fetchPost("/api/file/putFile", formData, (response) => {
                this.data[storageName] = data;
                resolve(response);
            });
        });
    }

    public removeData(storageName: string) {
        return new Promise((resolve) => {
            if (!this.data) {
                this.data = {};
            }
            fetchPost("/api/file/removeFile", {path: `/data/storage/petal/${this.name}/${storageName}`}, (response) => {
                delete this.data[storageName];
                resolve(response);
            });
        });
    }

    public addTab(options: {
        type: string,
        destroy?: () => void,
        beforeDestroy?: () => void,
        resize?: () => void,
        update?: () => void,
        init: () => void
    }) {
        /// #if !MOBILE
        const type2 = this.name + options.type;
        this.models[type2] = (arg: { data: any, tab: Tab }) => {
            const customObj = new Custom({
                app: this.app,
                tab: arg.tab,
                type: type2,
                data: arg.data,
                init: options.init,
                beforeDestroy: options.beforeDestroy,
                destroy: options.destroy,
                resize: options.resize,
                update: options.update,
            });
            customObj.element.addEventListener("click", () => {
                setPanelFocus(customObj.element.parentElement.parentElement);
            });
            return customObj;
        };
        return this.models[type2];
        /// #endif
    }

    public addDock(options: {
        config: IPluginDockTab,
        data: any,
        type: string,
        destroy?: () => void,
        resize?: () => void,
        update?: () => void,
        init: () => void
    }) {
        /// #if !MOBILE
        const type2 = this.name + options.type;
        if (typeof options.config.index === "undefined") {
            options.config.index = 1000;
        }
        this.docks[type2] = {
            config: options.config,
            model: (arg: { tab: Tab }) => {
                const customObj = new Custom({
                    app: this.app,
                    tab: arg.tab,
                    type: type2,
                    data: options.data,
                    init: options.init,
                    destroy: options.destroy,
                    resize: options.resize,
                    update: options.update,
                });
                customObj.element.addEventListener("click", (event: MouseEvent) => {
                    setPanelFocus(customObj.element);
                    if (hasClosestByAttribute(event.target as HTMLElement, "data-type", "min")) {
                        getDockByType(type2).toggleModel(type2);
                    }
                });
                customObj.element.classList.add("sy__" + type2);
                return customObj;
            }
        };
        return this.docks[type2];
        /// #endif
    }

    public addFloatLayer = (options: {
        ids: string[],
        defIds?: string[],
        x?: number,
        y?: number,
        targetElement?: HTMLElement,
        isBacklink: boolean,
    }) => {
        window.siyuan.blockPanels.push(new BlockPanel({
            app: this.app,
            targetElement: options.targetElement,
            isBacklink: options.isBacklink,
            x: options.x,
            y: options.y,
            nodeIds: options.ids,
            defIds: options.defIds,
        }));
    };
}
