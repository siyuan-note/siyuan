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

export class Plugin {
    public i18n: IObject;
    public eventBus: EventBus;
    public data: any;
    public name: string;
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
        this.i18n = options.i18n;
        this.name = options.name;
        this.eventBus = new EventBus(options.name);
    }

    public onload() {
        // 加载
    }

    public addTopBar(options: {
        icon: string,
        title: string,
        position?: "right",
        callback: (evt: MouseEvent) => void
    }) {
        const iconElement = document.createElement("div");
        if (isMobile()) {
            iconElement.className = "b3-menu__item";
            iconElement.setAttribute("aria-label", options.title);
            iconElement.setAttribute("data-menu", "true");
            iconElement.innerHTML = (options.icon.startsWith("icon") ? `<svg class="b3-menu__icon"><use xlink:href="#${options.icon}"></use></svg>` : options.icon) +
                `<span class="b3-menu__label">${options.title}</span>`;
            iconElement.addEventListener("click", options.callback);
            document.querySelector("#menuAbout").after(iconElement);
        } else if (!isWindow()) {
            iconElement.className = "toolbar__item b3-tooltips b3-tooltips__sw";
            iconElement.setAttribute("aria-label", options.title);
            iconElement.setAttribute("data-menu", "true");
            iconElement.innerHTML = options.icon.startsWith("icon") ? `<svg><use xlink:href="#${options.icon}"></use></svg>` : options.icon;
            iconElement.addEventListener("click", options.callback);
            document.querySelector("#" + (options.position === "right" ? "barSearch" : "drag")).before(iconElement);
        }
        return iconElement;
    }

    public openSetting() {
        // 打开设置
    }

    public loadData(storageName: string) {
        if (!this.data) {
            this.data = {};
        }
        if (typeof this.data[storageName] === "undefined") {
            this.data[storageName] = "";
        }
        return new Promise((resolve) => {
            fetchPost("/api/file/getFile", {path: `/data/storage/petal/${this.name}/${storageName}`}, (response) => {
                if (response.code === 404) {
                    this.data[storageName] = "";
                } else {
                    this.data[storageName] = response;
                }
                resolve(this.data[storageName]);
            });
        });
    }

    public saveData(storageName: string, data: any) {
        return new Promise((resolve) => {
            if (!this.data) {
                this.data = {};
            }
            const pathString = `/data/storage/petal/${this.name}/${storageName}`;
            const file = new File([new Blob([data])], pathString.split("/").pop());
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

    public addTab(options: {
        type: string,
        destroy?: () => void,
        resize?: () => void,
        update?: () => void,
        init: () => void
    }) {
        /// #if !MOBILE
        const type2 = this.name + options.type;
        this.models[type2] = (arg: { data: any, tab: Tab }) => {
            const customObj = new Custom({
                tab: arg.tab,
                type: type2,
                data: arg.data,
                init: options.init,
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
        this.docks[type2] = {
            config: options.config,
            model: (arg: { tab: Tab }) => {
                const customObj = new Custom({
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
}
