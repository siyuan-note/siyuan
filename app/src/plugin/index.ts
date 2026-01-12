import {App} from "../index";
import {EventBus} from "./EventBus";
import {fetchPost} from "../util/fetch";
import {isMobile, isWindow} from "../util/functions";
/// #if !MOBILE
import {Custom} from "../layout/dock/Custom";
import {getAllEditor, getAllModels} from "../layout/getAll";
import {Tab} from "../layout/Tab";
import {resizeTopBar, setPanelFocus} from "../layout/util";
import {getDockByType} from "../layout/tabUtil";
///#else
import {MobileCustom} from "../mobile/dock/MobileCustom";
/// #endif
import {hasClosestByAttribute} from "../protyle/util/hasClosest";
import {BlockPanel} from "../block/Panel";
import {Setting} from "./Setting";
import {clearOBG} from "../layout/dock/util";
import {Constants} from "../constants";
import {uninstall} from "./uninstall";
import {afterLoadPlugin, loadPlugins} from "./loader";

export class Plugin {
    private app: App;
    public i18n: IObject;
    public eventBus: EventBus;
    public data: any = {};
    public displayName: string;
    public readonly name: string;
    public protyleSlash: {
        filter: string[],
        html: string,
        id: string,
        callback: (protyle: import("../protyle").Protyle, nodeElement: HTMLElement) => void
    }[] = [];
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
        [key: string]: {
            config: IPluginDockTab,
            /// #if !MOBILE
            model: (options: { tab: Tab }) => Custom
            /// #else
            mobileModel: (element: Element) => MobileCustom
            /// #endif
        }
    } = {};
    private protyleOptionsValue: IProtyleOptions;

    constructor(options: {
        app: App,
        name: string,
        displayName: string,
        i18n: IObject
    }) {
        this.app = options.app;
        this.i18n = options.i18n;
        this.displayName = options.displayName;
        this.eventBus = new EventBus(options.name);

        // https://github.com/siyuan-note/siyuan/issues/9943
        Object.defineProperty(this, "name", {
            value: options.name,
            writable: false,
        });

        this.updateProtyleToolbar([]).forEach(toolbarItem => {
            if (typeof toolbarItem === "string" || Constants.INLINE_TYPE.concat("|").includes(toolbarItem.name)) {
                return;
            }
            if (typeof toolbarItem.hotkey !== "string") {
                toolbarItem.hotkey = "";
            }
            if (!window.siyuan.config.keymap.plugin) {
                window.siyuan.config.keymap.plugin = {};
            }
            if (!window.siyuan.config.keymap.plugin[options.name]) {
                window.siyuan.config.keymap.plugin[options.name] = {
                    [toolbarItem.name]: {
                        default: toolbarItem.hotkey,
                        custom: toolbarItem.hotkey,
                    }
                };
            }
            if (!window.siyuan.config.keymap.plugin[options.name][toolbarItem.name]) {
                window.siyuan.config.keymap.plugin[options.name][toolbarItem.name] = {
                    default: toolbarItem.hotkey,
                    custom: toolbarItem.hotkey,
                };
            } else {
                window.siyuan.config.keymap.plugin[options.name][toolbarItem.name].default = toolbarItem.hotkey;
            }
        });
    }

    public onload(): Promise<void> | void {
        // 加载
    }

    public onunload() {
        // 禁用/关闭
    }

    public uninstall() {
        // 卸载
    }

    public onDataChanged() {
        // 存储数据变更
        // 兼容 3.4.1 以前同步数据使用重载插件的问题
        uninstall(this.app, this.name, true);
        loadPlugins(this.app, [this.name], false).then(() => {
            afterLoadPlugin(this);
            getAllEditor().forEach(editor => {
                editor.protyle.toolbar.update(editor.protyle);
            });
        });
    }

    public async updateCards(options: ICardData) {
        return options;
    }

    public onLayoutReady() {
        // 布局加载完成
    }

    public addCommand(command: ICommand) {
        if (typeof command.hotkey !== "string") {
            command.hotkey = "";
        }
        if (!window.siyuan.config.keymap.plugin) {
            window.siyuan.config.keymap.plugin = {};
        }
        if (!window.siyuan.config.keymap.plugin[this.name]) {
            command.customHotkey = command.hotkey;
            window.siyuan.config.keymap.plugin[this.name] = {
                [command.langKey]: {
                    default: command.hotkey,
                    custom: command.hotkey,
                }
            };
        } else if (!window.siyuan.config.keymap.plugin[this.name][command.langKey]) {
            command.customHotkey = command.hotkey;
            window.siyuan.config.keymap.plugin[this.name][command.langKey] = {
                default: command.hotkey,
                custom: command.hotkey,
            };
        } else if (window.siyuan.config.keymap.plugin[this.name][command.langKey]) {
            if (typeof window.siyuan.config.keymap.plugin[this.name][command.langKey].custom === "string") {
                command.customHotkey = window.siyuan.config.keymap.plugin[this.name][command.langKey].custom;
            } else {
                command.customHotkey = command.hotkey;
            }
            window.siyuan.config.keymap.plugin[this.name][command.langKey]["default"] = command.hotkey;
        }
        if (typeof command.customHotkey !== "string") {
            console.error(`${this.name} - commands data is error and has been removed.`);
        } else {
            this.commands.push(command);
        }
    }

    public addIcons(svg: string) {
        const svgElement = document.querySelector(`svg[data-name="${this.name}"] defs`);
        if (svgElement) {
            svgElement.insertAdjacentHTML("afterbegin", svg);
        } else {
            const lastSvgElement = document.querySelector("body > svg:last-of-type");
            if (lastSvgElement) {
                lastSvgElement.insertAdjacentHTML("afterend", `<svg data-name="${this.name}" style="position: absolute; width: 0; height: 0; overflow: hidden;" xmlns="http://www.w3.org/2000/svg">
<defs>${svg}</defs></svg>`);
            } else {
                document.body.insertAdjacentHTML("afterbegin", `<svg data-name="${this.name}" style="position: absolute; width: 0; height: 0; overflow: hidden;" xmlns="http://www.w3.org/2000/svg">
<defs>${svg}</defs></svg>`);
            }
        }
    }

    public addTopBar(options: {
        icon: string,
        title: string,
        position?: "south" | "left",
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
            iconElement.className = "toolbar__item ariaLabel";
            iconElement.setAttribute("aria-label", options.title);
            iconElement.innerHTML = options.icon.startsWith("icon") ? `<svg><use xlink:href="#${options.icon}"></use></svg>` : options.icon;
            iconElement.addEventListener("click", options.callback);
            iconElement.setAttribute("data-location", options.position || "right");
            resizeTopBar();
        }
        if (isMobile() && window.siyuan.storage) {
            if (!window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(iconElement.id)) {
                document.querySelector("#menuAbout")?.after(iconElement);
            }
        } else if (!isWindow() && window.siyuan.storage) {
            if (window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(iconElement.id)) {
                iconElement.classList.add("fn__none");
            }
            document.querySelector("#" + (iconElement.getAttribute("data-location") === "right" ? "barPlugins" : "drag"))?.before(iconElement);
        }
        this.topBarIcons.push(iconElement);
        return iconElement;
    }

    public addStatusBar(options: {
        element: HTMLElement,
        position?: "right" | "left",
    }) {
        /// #if !MOBILE
        options.element.setAttribute("data-location", options.position || "right");
        this.statusBarIcons.push(options.element);
        const statusElement = document.getElementById("status");
        if (statusElement) {
            if (options.element.getAttribute("data-location") === "right") {
                statusElement.insertAdjacentElement("beforeend", options.element);
            } else {
                statusElement.insertAdjacentElement("afterbegin", options.element);
            }
        }
        return options.element;
        /// #endif
    }

    public openSetting() {
        if (!this.setting) {
            return;
        }
        this.setting.open(this.displayName || this.name);
    }

    public loadData(storageName: string): Promise<any> {
        if (typeof this.data[storageName] === "undefined") {
            this.data[storageName] = "";
        }
        return new Promise((resolve) => {
            fetchPost("/api/file/getFile", {
                path: `/data/storage/petal/${this.name}/${storageName.replace(/[\/\\]+/g, "")}`
            }, (response) => {
                this.data[storageName] = response;
                resolve(this.data[storageName]);
            }, null, () => {
                resolve(this.data[storageName]);
            });
        });
    }

    public saveData(storageName: string, data: any): Promise<any | IWebSocketData> {
        if (window.siyuan.config.readonly || window.siyuan.isPublish) {
            return Promise.reject({
                code: 403,
                msg: "Readonly mode or publish mode",
                data: null
            });
        }
        return new Promise((resolve, reject) => {
            const pathString = `/data/storage/petal/${this.name}/${storageName.replace(/[\/\\]+/g, "")}`;
            let file: File;
            try {
                if (typeof data === "object") {
                    file = new File([new Blob([JSON.stringify(data)], {
                        type: "application/json"
                    })], pathString.split("/").pop());
                } else {
                    file = new File([new Blob([data])], pathString.split("/").pop());
                }
            } catch (e) {
                reject({
                    code: 400,
                    msg: e instanceof Error ? e.message : String(e),
                    data: null
                });
                return;
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

    public removeData(storageName: string): Promise<IWebSocketData> {
        if (window.siyuan.config.readonly || window.siyuan.isPublish) {
            return Promise.reject({
                code: 403,
                msg: "Readonly mode or publish mode",
                data: null
            } as IWebSocketData);
        }

        return new Promise((resolve) => {
            if (!this.data) {
                this.data = {};
            }
            fetchPost("/api/file/removeFile", {path: `/data/storage/petal/${this.name}/${storageName.replace(/[\/\\]+/g, "")}`}, (response) => {
                delete this.data[storageName];
                resolve(response);
            });
        });
    }

    public getOpenedTab() {
        const tabs: { [key: string]: Custom[] } = {};
        const modelKeys = Object.keys(this.models);
        modelKeys.forEach(item => {
            tabs[item.replace(this.name, "")] = [];
        });
        /// #if !MOBILE
        getAllModels().custom.find(item => {
            if (modelKeys.includes(item.type)) {
                tabs[item.type.replace(this.name, "")].push(item);
            }
        });
        /// #endif
        return tabs;
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
                clearOBG();
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
        const type2 = this.name + options.type;
        if (typeof options.config.index === "undefined") {
            options.config.index = 1000;
        }
        this.docks[type2] = {
            config: options.config,
            /// #if MOBILE
            mobileModel: (element) => {
                const customObj = new MobileCustom({
                    element,
                    type: type2,
                    data: options.data,
                    init: options.init,
                    update: options.update,
                    destroy: options.destroy,
                });
                return customObj;
            },
            /// #else
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
            /// #endif
        };
        if (!window.siyuan.config.keymap.plugin) {
            window.siyuan.config.keymap.plugin = {};
        }
        if (options.config.hotkey) {
            if (!window.siyuan.config.keymap.plugin[this.name]) {
                window.siyuan.config.keymap.plugin[this.name] = {
                    [type2]: {
                        default: options.config.hotkey,
                        custom: options.config.hotkey,
                    }
                };
            } else if (!window.siyuan.config.keymap.plugin[this.name][type2]) {
                window.siyuan.config.keymap.plugin[this.name][type2] = {
                    default: options.config.hotkey,
                    custom: options.config.hotkey,
                };
            } else if (window.siyuan.config.keymap.plugin[this.name][type2]) {
                if (typeof window.siyuan.config.keymap.plugin[this.name][type2].custom !== "string") {
                    window.siyuan.config.keymap.plugin[this.name][type2].custom = options.config.hotkey;
                }
                window.siyuan.config.keymap.plugin[this.name][type2]["default"] = options.config.hotkey;
            }
        }
        return this.docks[type2];
    }

    public addFloatLayer = (options: {
        refDefs: IRefDefs[],
        x?: number,
        y?: number,
        targetElement?: HTMLElement,
        originalRefBlockIDs?: IObject,
        isBacklink: boolean,
    }) => {
        window.siyuan.blockPanels.push(new BlockPanel({
            app: this.app,
            originalRefBlockIDs: options.originalRefBlockIDs,
            targetElement: options.targetElement,
            isBacklink: options.isBacklink,
            x: options.x,
            y: options.y,
            refDefs: options.refDefs,
        }));
    };

    public updateProtyleToolbar(toolbar: Array<string | IMenuItem>) {
        return toolbar;
    }

    set protyleOptions(options: IProtyleOptions) {
        this.protyleOptionsValue = options;
    }

    get protyleOptions() {
        return this.protyleOptionsValue;
    }
}
