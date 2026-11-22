import {Model} from "../layout/Model";
import {Tab} from "../layout/Tab";
import {Protyle} from "../protyle";
import {genSearch, updateConfig} from "./util";
import {setPanelFocus} from "../layout/util";
import type {App} from "../index";
import {clearOBG} from "../layout/dock/util";
import {cancelSearchRequest} from "./request";
import {isPhablet} from "../protyle/util/compatibility";

export class Search extends Model {
    public element: HTMLElement;
    public config: Config.IUILayoutTabSearchConfig;
    public editors: { edit: Protyle, unRefEdit: Protyle };
    public readonly tagPanel: boolean;

    constructor(options: { tab: Tab, config: Config.IUILayoutTabSearchConfig, app: App, tagPanel?: boolean }) {
        super({
            app: options.app,
        });
        if (!options.tagPanel && window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement?.classList.add("item--unupdate");
        }
        this.element = options.tab.panelElement as HTMLElement;
        this.config = options.config;
        this.tagPanel = options.tagPanel === true;
        this.editors = genSearch(options.app, this.config, this.element, {tagPanel: this.tagPanel});
        this.element.addEventListener("click", () => {
            clearOBG();
            setPanelFocus(this.element.parentElement.parentElement);
        });
    }

    public updateTagSearch(config: Config.IUILayoutTabSearchConfig) {
        updateConfig(this.element, {...config, sensitive: this.config.sensitive || config.sensitive},
            this.config, this.editors.edit, {resetResults: true});
    }

    public updateSearch(text: string, replace: boolean) {
        const inputElement = this.element.querySelector(".b3-text-field") as HTMLInputElement;
        if (text === "") {
            inputElement.select();
            return;
        }
        const oldText = inputElement.value;
        if (oldText === text) {
            return;
        }
        if (!replace) {
            if (oldText.indexOf(text) > -1) {
                text = oldText.replace(text + " ", "").replace(" " + text, "");
            } else if (oldText !== "") {
                text = oldText + " " + text;
            }
        }
        inputElement.value = text;
        if (!isPhablet()) {
            inputElement.select();
        }
        inputElement.dispatchEvent(new CustomEvent("input"));
    }

    public destroy() {
        cancelSearchRequest(this.element);
        this.editors.edit.destroy();
        this.editors.unRefEdit.destroy();
    }
}
