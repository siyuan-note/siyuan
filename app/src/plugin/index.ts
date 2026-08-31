import type {App} from "../index";
import {EventBus} from "./EventBus";
import {fetchPost} from "../util/fetch";
import {isMobile, isWindow} from "../util/functions";
/// #if !MOBILE
import {Custom} from "../layout/dock/Custom";
import {getAllModels} from "../layout/getAll";
import {Tab} from "../layout/Tab";
import {resizeTopBar, setPanelFocus} from "../layout/util";
import {getDockByType, setTabPosition} from "../layout/tabUtil";
import {clearOBG} from "../layout/dock/util";
///#else
import {MobileCustom} from "../mobile/dock/MobileCustom";
/// #endif
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {hasClosestByAttribute} from "../protyle/util/hasClosest";
import {BlockPanel} from "../block/Panel";
import {Setting} from "./Setting";
import {Constants} from "../constants";
import {addPluginDock, removePluginDock} from "./loader";
import {normalizeStoragePath} from "../util/pathName";
import {Kernel} from "./kernel";
import {IAgentCapabilityEffects, registerCapability} from "../layout/dock/agent/frontendCapabilities";
import {isDisallowedTextInputHotkey, normalizePluginHotkey} from "../util/hotKeyPolicy";
import {
    addBreadcrumbButton as addPluginBreadcrumbButton,
    removeBreadcrumbButton as removePluginBreadcrumbButton,
} from "./breadcrumbButton";
import type {TCustomBlockRender} from "./customBlockRender";
import {registerPluginCommand} from "./commandAdapter";

const disposedPlugins = new WeakSet<Plugin>();

const isPluginDisposed = (plugin: Plugin) => disposedPlugins.has(plugin);

export const markPluginDisposed = (plugin: Plugin) => {
    disposedPlugins.add(plugin);
};

const updatePluginKeymap = (pluginName: string, key: string, hotkey: unknown) => {
    if (!window.siyuan.config.keymap.plugin) {
        window.siyuan.config.keymap.plugin = {};
    }
    if (!window.siyuan.config.keymap.plugin[pluginName]) {
        window.siyuan.config.keymap.plugin[pluginName] = {};
    }
    const keymapItem = window.siyuan.config.keymap.plugin[pluginName][key];
    const normalized = normalizePluginHotkey(hotkey, keymapItem?.custom);
    if (!keymapItem) {
        window.siyuan.config.keymap.plugin[pluginName][key] = {
            default: normalized.defaultHotkey,
            custom: normalized.customHotkey,
        };
    } else {
        keymapItem.default = normalized.defaultHotkey;
        keymapItem.custom = normalized.customHotkey;
    }
    normalized.ignoredHotkeys.forEach((ignoredHotkey) => {
        console.warn(`Plugin ${pluginName} ignored disallowed hotkey "${ignoredHotkey}" for "${key}".`);
    });
    return window.siyuan.config.keymap.plugin[pluginName][key];
};

export class Plugin {
    private app: App;
    public i18n: Record<string, string>;
    public eventBus: EventBus;
    public kernel: Kernel;
    public data: any = {};
    public displayName: string;
    public readonly name: string;
    public protyleSlash: {
        filter: string[],
        html: string,
        id: string,
        callback: (protyle: import("../protyle").Protyle, nodeElement: HTMLElement) => void
    }[] = [];
    public customBlockRenders: {
        [key: string]: {
            render: TCustomBlockRender
        }
    } = {};
    public topBarIcons: Element[] = [];
    public setting: Setting;
    public statusBarIcons: Element[] = [];
    public commands: ICommand[] = [];
    public agentCapabilities: Array<{id: string; generation: number}> = [];
    public models: {
        /// #if !MOBILE
        [key: string]: (options: { tab: Tab, data: any }) => Custom
        /// #endif
    } = {};
    public docks: {
        [key: string]: {
            id: string,
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
        i18n: Record<string, string>
    }) {
        this.app = options.app;
        this.i18n = options.i18n;
        this.displayName = options.displayName;
        this.eventBus = new EventBus();
        this.kernel = new Kernel({
            appId: options.app.appId,
            name: options.name,
            eventBus: this.eventBus,
        });

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
            toolbarItem.hotkey = updatePluginKeymap(options.name, toolbarItem.name, toolbarItem.hotkey).default;
        });
    }

    public onload(): Promise<void> | void {
        // 加载
    }

    public onunload(): Promise<void> | void {
        // 禁用
    }

    public uninstall(): Promise<void> | void {
        // 卸载
    }

    public onDataChanged(): Promise<void> | void {
        // 存储数据变更
    }

    public async updateCards(options: ICardData) {
        return options;
    }

    public onLayoutReady(): Promise<void> | void {
        // 布局加载完成
    }

    public addCommand(command: ICommand) {
        if (isPluginDisposed(this)) {
            return;
        }
        if (typeof command.hotkey !== "string") {
            command.hotkey = "";
        }
        const keymapItem = updatePluginKeymap(this.name, command.langKey, command.hotkey);
        command.hotkey = keymapItem.default;
        command.customHotkey = keymapItem.custom;
        if (typeof command.customHotkey !== "string") {
            console.error(`${this.name} - commands data is error and has been removed.`);
        } else {
            this.commands.push(command);
            registerPluginCommand(this.app, this, command);
            /// #if !BROWSER
            if (!isWindow() && command.globalCallback && command.customHotkey &&
                !isDisallowedTextInputHotkey(command.customHotkey)) {
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd: "registerGlobalShortcut",
                    accelerator: command.customHotkey
                });
            }
            /// #endif
        }
    }

    public addIcons(svg: string) {
        if (isPluginDisposed(this)) {
            return;
        }
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
        id?: string,
        icon: string,
        title: string,
        position?: "right" | "left",
        callback: (evt: MouseEvent) => void
    }) {
        if (isPluginDisposed(this)) {
            return;
        }
        options.icon = options.icon.trim();
        if (!options.icon.startsWith("icon") && !options.icon.startsWith("<svg")) {
            console.error(`plugin ${this.name} addTopBar error: icon must be svg id or svg tag`);
            return;
        }
        let iconElement = typeof options.id === "string" ? this.topBarIcons.find(item =>
            item.getAttribute("data-id") === options.id) as HTMLElement : undefined;
        const isNew = !iconElement;
        if (!iconElement) {
            iconElement = document.createElement("div");
            if (typeof options.id === "string") {
                iconElement.id = `plugin_${encodeURIComponent(this.name)}:${encodeURIComponent(options.id)}`;
                iconElement.setAttribute("data-id", options.id);
            } else {
                let index = this.topBarIcons.length;
                do {
                    iconElement.id = `plugin_${this.name}_${index}`;
                    index++;
                } while (this.topBarIcons.some(item => item.getAttribute("id") === iconElement.id));
            }
        }
        const previousLocation = iconElement.getAttribute("data-location");
        iconElement.setAttribute("data-menu", "true");
        iconElement.onclick = options.callback;
        if (isMobile()) {
            iconElement.className = "b3-menu__item";
            const iconHTML = options.icon.startsWith("icon") ?
                `<svg class="b3-menu__icon"><use xlink:href="#${options.icon}"></use></svg>` :
                `<span class="b3-menu__icon b3-menu__icon--custom">${options.icon}</span>`;
            iconElement.innerHTML = iconHTML +
                `<span class="b3-menu__label">${options.title}</span>`;
        } else if (!isWindow()) {
            iconElement.className = "toolbar__item ariaLabel";
            iconElement.setAttribute("aria-label", options.title);
            iconElement.innerHTML = options.icon.startsWith("icon") ? `<svg><use xlink:href="#${options.icon}"></use></svg>` : options.icon;
            iconElement.setAttribute("data-location", options.position || "right");
        }
        if (isMobile() && window.siyuan.storage) {
            if (!window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(iconElement.id) &&
                !document.contains(iconElement)) {
                document.getElementById("menuPluginTopBar")?.after(iconElement);
            }
        } else if (!isWindow() && window.siyuan.storage) {
            if (window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(iconElement.id)) {
                iconElement.classList.add("fn__none");
            }
            if (!document.contains(iconElement) || previousLocation !== iconElement.getAttribute("data-location")) {
                document.querySelector("#" + (iconElement.getAttribute("data-location") === "right" ? "barPlugins" : "drag"))?.before(iconElement);
            }
        }
        if (isNew) {
            this.topBarIcons.push(iconElement);
        }
        /// #if !MOBILE
        if (!isWindow()) {
            resizeTopBar();
            setTabPosition(true);
        }
        /// #endif
        return iconElement;
    }

    public removeTopBar(id: string) {
        if (isPluginDisposed(this)) {
            return;
        }
        const index = this.topBarIcons.findIndex(item => item.getAttribute("data-id") === id);
        if (index === -1) {
            return;
        }
        this.topBarIcons[index].remove();
        this.topBarIcons.splice(index, 1);
        /// #if !MOBILE
        if (!isWindow()) {
            resizeTopBar();
            setTabPosition(true);
        }
        /// #endif
    }

    public addBreadcrumbButton(options: {
        id: string,
        icon: string,
        title: string,
        callback: (event: MouseEvent, protyle: IProtyle) => void,
    }) {
        if (isPluginDisposed(this)) {
            return options.id;
        }
        options.icon = options.icon.trim();
        if (!options.icon.startsWith("icon") && !options.icon.startsWith("<svg")) {
            console.error(`plugin ${this.name} addBreadcrumbButton error: icon must be svg id or svg tag`);
            return options.id;
        }
        addPluginBreadcrumbButton(this.name, options);
        return options.id;
    }

    public removeBreadcrumbButton(id: string) {
        if (isPluginDisposed(this)) {
            return;
        }
        removePluginBreadcrumbButton(this.name, id);
    }

    public addStatusBar(options: {
        element: HTMLElement,
        position?: "right" | "left",
    }) {
        if (isPluginDisposed(this)) {
            return options.element;
        }
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
        if (isPluginDisposed(this) || !this.setting) {
            return;
        }
        this.setting.open(this.displayName || this.name);
    }

    public loadData(storageName: string): Promise<any> {
        if (isPluginDisposed(this)) {
            return Promise.reject({code: 410, msg: "Plugin lifecycle has ended", data: null});
        }
        if (typeof this.data[storageName] === "undefined") {
            this.data[storageName] = "";
        }
        return new Promise((resolve) => {
            fetchPost("/api/file/getFile", {
                path: `/data/storage/petal/${this.name}/${normalizeStoragePath(storageName)}`
            }, (response) => {
                this.data[storageName] = response;
                resolve(this.data[storageName]);
            }, null, () => {
                resolve(this.data[storageName]);
            });
        });
    }

    public saveData(storageName: string, data: any): Promise<any | IWebSocketData> {
        if (isPluginDisposed(this)) {
            return Promise.reject({code: 410, msg: "Plugin lifecycle has ended", data: null});
        }
        if (window.siyuan.config.readonly || window.siyuan.isPublish) {
            return Promise.reject({
                code: 403,
                msg: "Readonly mode or publish mode",
                data: null
            });
        }
        return new Promise((resolve, reject) => {
            const pathString = `/data/storage/petal/${this.name}/${normalizeStoragePath(storageName)}`;
            let file: File;
            try {
                const fileName = pathString.split("/").pop();
                if (typeof data === "object") {
                    file = new File([new Blob([JSON.stringify(data)], {
                        type: "application/json"
                    })], fileName);
                } else {
                    file = new File([new Blob([data])], fileName);
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
        if (isPluginDisposed(this)) {
            return Promise.reject({code: 410, msg: "Plugin lifecycle has ended", data: null} as IWebSocketData);
        }
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
            fetchPost("/api/file/removeFile", {path: `/data/storage/petal/${this.name}/${normalizeStoragePath(storageName)}`}, (response) => {
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
        if (isPluginDisposed(this)) {
            return;
        }
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

    // Register a frontend action that the AI agent can discover and invoke. The action is exposed
    // to the LLM under the full name "plugin__<pluginName>__<name>" with the given description, and
    // is dispatched via the "frontend" tool. On uninstall, all registered actions are removed.
    /**
     * 按名称取密钥值（来自「设置 → 密钥和变量」的密钥库）。找不到时返回空字符串。
     * 密钥在内核侧加密存储，此处读到的是运行时明文；仅在本地管理员身份下可用。
     */
    public getSecret(name: string): string {
        const found = window.siyuan.config.secrets?.items?.find((item) => item.name === name);
        return found ? found.value : "";
    }

    /**
     * 按名称取变量值（来自「设置 → 密钥和变量」的变量库）。找不到时返回空字符串。
     * 变量以明文存储，用于非敏感配置。
     */
    public getVariable(name: string): string {
        const found = window.siyuan.config.variables?.items?.find((item) => item.name === name);
        return found ? found.value : "";
    }

    public addAgentCapability(options: {
        name: string,
        title?: string,
        description: string,
        inputSchema: Record<string, unknown>,
        outputSchema?: Record<string, unknown>,
        effects?: IAgentCapabilityEffects,
        actionEffects?: Record<string, IAgentCapabilityEffects>,
        handler: (args: Record<string, unknown>, app: App) => Promise<{
            result?: string;
            structuredContent?: unknown;
            error?: string;
        }>
    }): string {
        const name = options.name.trim();
        if (!name || !options.description.trim()) {
            throw new Error("Agent capability name and description are required");
        }
        const id = "plugin/frontend/" + encodeURIComponent(this.name) + "/" + encodeURIComponent(name);
        if (isPluginDisposed(this)) {
            return id;
        }
        if (!this.agentCapabilities.some((capability) => capability.id === id)) {
            const generation = registerCapability({
                id,
                title: options.title,
                description: options.description,
                inputSchema: options.inputSchema,
                outputSchema: options.outputSchema,
                effects: options.effects,
                actionEffects: options.actionEffects,
                source: "plugin",
                ownerId: this.name,
                ownerName: this.displayName || this.name,
                handler: options.handler,
            });
            this.agentCapabilities.push({id, generation});
        }
        return id;
    }

    public addDock(options: {
        id?: string,
        config: IPluginDockTab,
        data: any,
        type: string,
        destroy?: () => void,
        resize?: () => void,
        update?: () => void,
        init: () => void
    }) {
        if (isPluginDisposed(this)) {
            return;
        }
        const id = options.id || options.type;
        const type2 = this.name + options.type;
        const existingID = this.docks[type2]?.id;
        if (existingID && existingID !== id) {
            removePluginDock(this, existingID);
        }
        removePluginDock(this, id);
        if (typeof options.config.index === "undefined") {
            options.config.index = 1000;
        }
        this.docks[type2] = {
            id,
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
                customObj.element.classList.add("sy__" + type2, "dockPanel");
                return customObj;
            }
            /// #endif
        };
        options.config.hotkey = updatePluginKeymap(this.name, type2, options.config.hotkey).default;
        addPluginDock(this);
        return this.docks[type2];
    }

    public removeDock(id: string) {
        if (isPluginDisposed(this)) {
            return;
        }
        removePluginDock(this, id);
    }

    public addFloatLayer = (options: {
        refDefs: IRefDefs[],
        x?: number,
        y?: number,
        targetElement?: HTMLElement,
        originalRefBlockIDs?: IObject,
        isBacklink: boolean,
    }) => {
        if (isPluginDisposed(this)) {
            return;
        }
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
