import {Model} from "../layout/Model";
import {Tab} from "../layout/Tab";
import {Protyle} from "../protyle";
import {genSearch} from "./util";
import {setPanelFocus} from "../layout/util";
import {App} from "../index";

export class Search extends Model {
    public element: HTMLElement;
    public config: ISearchOption;
    public editors: { edit: Protyle, unRefEdit: Protyle };

    constructor(options: { tab: Tab, config: ISearchOption, app: App }) {
        super({
            app: options.app,
            id: options.tab.id,
        });
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement?.classList.add("item--unupdate");
        }
        this.element = options.tab.panelElement as HTMLElement;
        this.config = options.config;
        this.editors = genSearch(options.app, this.config, this.element);
        this.element.addEventListener("click", () => {
            setPanelFocus(this.element.parentElement.parentElement);
        });
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
        inputElement.select();
        inputElement.dispatchEvent(new CustomEvent("input"));
    }
}
