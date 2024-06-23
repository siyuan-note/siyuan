import {Tab} from "../Tab";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {Model} from "../Model";
import {Constants} from "../../constants";
import {addScript} from "../../protyle/util/addScript";
import {BlockPanel} from "../../block/Panel";
import {fullscreen} from "../../protyle/breadcrumb/action";
import {fetchPost} from "../../util/fetch";
import {isCurrentEditor, openFileById} from "../../editor/util";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openGlobalSearch} from "../../search/util";
import {App} from "../../index";
import {checkFold} from "../../util/noRelyPCFunction";

declare const vis: any;

export class Graph extends Model {
    public inputElement: HTMLInputElement;
    private graphElement: HTMLDivElement;
    private panelElement: HTMLElement;
    private element: HTMLElement;
    private network: any;
    public blockId: string; // "local" / "pin" 必填
    public rootId: string; // "local" 必填
    private timeout: number;
    public graphData: {
        nodes: { box: string, id: string, path: string, type: string, color: IObject }[],
        links: Record<string, unknown>[],
        box: string
    };
    public type: "local" | "pin" | "global";

    constructor(options: {
        app: App
        tab: Tab
        blockId?: string
        rootId?: string
        type: "local" | "pin" | "global"
    }) {
        super({
            app: options.app,
            id: options.tab.id,
            callback() {
                if (this.type === "local") {
                    fetchPost("/api/block/checkBlockExist", {id: this.blockId}, existResponse => {
                        if (!existResponse.data) {
                            this.parent.parent.removeTab(this.parent.id);
                        }
                    });
                }
            },
            msgCallback(data) {
                if (data) {
                    switch (data.cmd) {
                        case "mount":
                            if (this.type === "global" && data.code !== 1) {
                                this.searchGraph(false);
                            }
                            break;
                        case "rename":
                            if (this.graphData && data.data.box === this.graphData.box && this.rootId === data.data.id) {
                                this.searchGraph(false);
                                if (this.type === "local") {
                                    this.parent.updateTitle(data.data.title);
                                }
                            }
                            if (this.type === "global") {
                                this.searchGraph(false);
                            }
                            break;
                        case "unmount":
                            if (this.type === "local" && this.graphData && this.graphData.box === data.data.box) {
                                this.parent.parent.removeTab(this.parent.id);
                            }
                            break;
                        case "removeDoc":
                            if (this.type === "local" && data.data.ids.includes(this.rootId)) {
                                this.parent.parent.removeTab(this.parent.id);
                            }
                            break;
                    }
                }
            }
        });
        this.element = options.tab.panelElement;
        this.blockId = options.blockId;
        this.rootId = options.rootId;
        this.type = options.type;

        this.element.classList.add("graph", "file-tree", this.type === "global" ? "sy__globalGraph" : "sy__graph");
        let panelHTML;
        if (this.type === "global") {
            panelHTML = `
<label>
    <span>${window.siyuan.languages.headings}</span> 
    <input data-type="heading" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.heading ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.list1}</span> 
    <input data-type="list" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.list ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.listItem}</span> 
    <input data-type="listItem" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.listItem ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.quote}</span> 
    <input data-type="blockquote" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.blockquote ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.superBlock}</span> 
    <input data-type="super" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.super ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.table}</span> 
    <input data-type="table" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.table ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.math}</span> 
    <input data-type="math" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.math ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.code}</span> 
    <input data-type="code" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.code ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.paragraph}</span> 
    <input data-type="paragraph" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.paragraph ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.dailyNote}</span>  
    <input data-type="dailyNote" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.dailyNote ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.tag}</span>  
    <input data-type="tag" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.tag ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.arrow}</span> 
    <input data-type="arrow" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.d3.arrow ? " checked" : ""}/>
</label>
<label> 
    <span>${window.siyuan.languages.graphConfig2}</span>  
    <input data-type="minRefs" class="b3-slider b3-tooltips__n b3-tooltips" max="16" min="0" step="1" type="range" value="${window.siyuan.config.graph.global.minRefs}" aria-label="${window.siyuan.config.graph.global.minRefs}" />
</label>
<label>
    <span>${window.siyuan.languages.nodeSize}</span> 
    <input data-type="nodeSize" class="b3-slider b3-tooltips__n b3-tooltips" aria-label="${window.siyuan.config.graph.global.d3.nodeSize}" max="32" min="4" step="2" type="range" value="${window.siyuan.config.graph.global.d3.nodeSize}" />
</label>
<label>
    <span>${window.siyuan.languages.lineWidth}</span> 
    <input data-type="linkWidth" class="b3-tooltips b3-tooltips__n b3-slider" max="32" min="4" step="2" type="range" value="${window.siyuan.config.graph.global.d3.linkWidth}" aria-label="${window.siyuan.config.graph.global.d3.linkWidth}"/>
</label>
<label>
    <span>${window.siyuan.languages.lineOpacity}</span> 
    <input data-type="lineOpacity" class="b3-tooltips b3-tooltips__n b3-slider" max="1" min="0.1" step="0.01" type="range" value="${window.siyuan.config.graph.global.d3.lineOpacity}" aria-label="${window.siyuan.config.graph.global.d3.lineOpacity}"/>
</label>
<label>
    <span>${window.siyuan.languages.centerStrength}</span> 
    <input data-type="centerStrength" class="b3-tooltips b3-tooltips__n b3-slider" max="0.1" min="0.005" step="0.01" type="range" value="${window.siyuan.config.graph.global.d3.centerStrength}" aria-label="${window.siyuan.config.graph.global.d3.centerStrength}"/>
</label>
<label>
    <span>${window.siyuan.languages.collideRadius}</span> 
    <input data-type="collideRadius" class="b3-tooltips b3-tooltips__n b3-slider" max="5000" min="400" step="200" type="range" value="${window.siyuan.config.graph.global.d3.collideRadius}" aria-label="${window.siyuan.config.graph.global.d3.collideRadius}"/>
</label>
<label>
    <span>${window.siyuan.languages.collideStrength}</span> 
    <input data-type="collideStrength" class="b3-tooltips b3-tooltips__n b3-slider" max="1" min="0.01" step="0.01" type="range" value="${window.siyuan.config.graph.global.d3.collideStrength}" aria-label="${window.siyuan.config.graph.global.d3.collideStrength}"/>
</label>
<label>
    <span>${window.siyuan.languages.linkDistance}</span> 
    <input data-type="linkDistance" class="b3-tooltips b3-tooltips__n b3-slider" max="2000" min="100" step="100" type="range" value="${window.siyuan.config.graph.global.d3.linkDistance}" aria-label="${window.siyuan.config.graph.global.d3.linkDistance}"/>
</label>
<div class="fn__hr"></div>
<button class="b3-button b3-button--small fn__block">${window.siyuan.languages.reset}</button>`;
        } else {
            panelHTML = `
<label>
    <span>${window.siyuan.languages.headings}</span> 
    <input data-type="heading" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.heading ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.list1}</span> 
    <input data-type="list" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.list ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.listItem}</span> 
    <input data-type="listItem" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.listItem ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.quote}</span> 
    <input data-type="blockquote" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.blockquote ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.superBlock}</span> 
    <input data-type="super" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.super ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.table}</span> 
    <input data-type="table" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.table ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.math}</span> 
    <input data-type="math" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.math ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.code}</span> 
    <input data-type="code" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.code ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.paragraph}</span> 
    <input data-type="paragraph" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.paragraph ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.dailyNote}</span>  
    <input data-type="dailyNote" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.dailyNote ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.tag}</span>  
    <input data-type="tag" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.tag ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.arrow}</span> 
    <input data-type="arrow" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.d3.arrow ? " checked" : ""}/>
</label>
<label>
    <span>${window.siyuan.languages.nodeSize}</span> 
    <input data-type="nodeSize" class="b3-slider b3-tooltips__n b3-tooltips" aria-label="${window.siyuan.config.graph.local.d3.nodeSize}" max="32" min="4" step="2" type="range" value="${window.siyuan.config.graph.local.d3.nodeSize}" />
</label>
<label>
    <span>${window.siyuan.languages.lineWidth}</span> 
    <input data-type="linkWidth" class="b3-tooltips b3-tooltips__n b3-slider" max="32" min="4" step="2" type="range" value="${window.siyuan.config.graph.local.d3.linkWidth}" aria-label="${window.siyuan.config.graph.local.d3.linkWidth}"/>
</label>
<label>
    <span>${window.siyuan.languages.lineOpacity}</span> 
    <input data-type="lineOpacity" class="b3-tooltips b3-tooltips__n b3-slider" max="1" min="0.1" step="0.01" type="range" value="${window.siyuan.config.graph.local.d3.lineOpacity}" aria-label="${window.siyuan.config.graph.local.d3.lineOpacity}"/>
</label>
<label>
    <span>${window.siyuan.languages.centerStrength}</span> 
    <input data-type="centerStrength" class="b3-tooltips b3-tooltips__n b3-slider" max="0.1" min="0.005" step="0.01" type="range" value="${window.siyuan.config.graph.local.d3.centerStrength}" aria-label="${window.siyuan.config.graph.local.d3.centerStrength}"/>
</label>
<label>
    <span>${window.siyuan.languages.collideRadius}</span> 
    <input data-type="collideRadius" class="b3-tooltips b3-tooltips__n b3-slider" max="5000" min="400" step="200" type="range" value="${window.siyuan.config.graph.local.d3.collideRadius}" aria-label="${window.siyuan.config.graph.local.d3.collideRadius}"/>
</label>
<label>
    <span>${window.siyuan.languages.collideStrength}</span> 
    <input data-type="collideStrength" class="b3-tooltips b3-tooltips__n b3-slider" max="1" min="0.01" step="0.01" type="range" value="${window.siyuan.config.graph.local.d3.collideStrength}" aria-label="${window.siyuan.config.graph.local.d3.collideStrength}"/>
</label>
<label>
    <span>${window.siyuan.languages.linkDistance}</span> 
    <input data-type="linkDistance" class="b3-tooltips b3-tooltips__n b3-slider" max="2000" min="100" step="100" type="range" value="${window.siyuan.config.graph.local.d3.linkDistance}" aria-label="${window.siyuan.config.graph.local.d3.linkDistance}"/>
</label>
<div class="fn__hr"></div>
<button class="b3-button b3-button--small fn__block">${window.siyuan.languages.reset}</button>`;
        }
        this.element.innerHTML = `
<div class="block__icons"> 
    <div class="block__logo">
        <svg class="block__logoicon"><use xlink:href="#icon${this.type === "global" ? "GlobalGraph" : "Graph"}"></use></svg>${this.type === "global" ? window.siyuan.languages.globalGraph : window.siyuan.languages.graphView}
    </div>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <input class="b3-text-field search__label fn__size200 fn__none" placeholder="${window.siyuan.languages.search}" />
    <span data-type="search" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.search}"><svg><use xlink:href='#iconFilter'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <div class="fn__space"></div>
    <div data-type="fullscreen" class="b3-tooltips b3-tooltips__sw block__icon" aria-label="${window.siyuan.languages.fullscreen}">
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </div>
    <div class="fn__space"></div>
    <div data-type="menu" class="b3-tooltips b3-tooltips__sw block__icon" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </div> 
    <span class="${this.type === "local" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min"  class="${this.type === "local" ? "fn__none " : ""}block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="graph__panel">
    ${panelHTML}
</div>
<div class="fn__flex-1 graph__svg"><div class="graph__loading"><div></div></div><div style="height: 100%"></div></div>`;
        this.graphElement = this.element.querySelector(".graph__svg");
        this.inputElement = this.element.querySelector("input");
        this.panelElement = this.element.querySelector(".graph__panel") as HTMLElement;
        this.element.addEventListener("click", (event) => {
            if (this.type === "local") {
                setPanelFocus(this.element.parentElement.parentElement);
            } else {
                setPanelFocus(this.element);
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("b3-button")) {
                    if (this.type === "global") {
                        fetchPost("/api/graph/resetGraph", {}, (data) => {
                            this.reset(data.data.conf);
                        });
                    } else {
                        fetchPost("/api/graph/resetLocalGraph", {}, (data) => {
                            this.reset(data.data.conf);
                        });
                    }
                    break;
                } else if (target.classList.contains("block__icon")) {
                    const dataType = target.getAttribute("data-type");
                    if (dataType === "min") {
                        getDockByType(this.type === "global" ? "globalGraph" : "graph").toggleModel(this.type === "global" ? "globalGraph" : "graph");
                    } else if (dataType === "menu") {
                        if (target.classList.contains("ft__primary")) {
                            target.classList.remove("ft__primary");
                            this.panelElement.style.right = "";
                        } else {
                            target.classList.add("ft__primary");
                            this.panelElement.style.right = "0";
                        }
                    } else if (dataType === "search") {
                        target.previousElementSibling.classList.remove("fn__none");
                        (target.previousElementSibling as HTMLInputElement).select();
                    } else if (dataType === "refresh") {
                        this.searchGraph(false, undefined, true);
                    } else if (dataType === "fullscreen") {
                        fullscreen(this.element, target);
                        const minElement = this.element.querySelector('.block__icons .block__icon[data-type="min"]')
                        if (this.element.className.includes("fullscreen")) {
                            minElement.classList.add("fn__none")
                        } else {
                            minElement.classList.remove("fn__none")
                        }
                    }
                    break;
                } else if (target.classList.contains("graph__svg")) {
                    this.element.querySelectorAll(".block__icon.ft__primary").forEach(item => {
                        item.classList.remove("ft__primary");
                    });
                    this.panelElement.style.right = "";
                    break;
                }
                target = target.parentElement;
            }
        });
        this.inputElement.addEventListener("compositionend", () => {
            this.searchGraph(false);
            this.inputElement.classList.add("search__input--block");
        });
        this.inputElement.addEventListener("blur", (event: InputEvent) => {
            const inputElement = event.target as HTMLInputElement;
            inputElement.classList.add("fn__none");
        });
        this.inputElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            if (this.inputElement.value === "") {
                this.inputElement.classList.remove("search__input--block");
            } else {
                this.inputElement.classList.add("search__input--block");
            }
            this.searchGraph(false);
        });
        this.element.querySelectorAll(".b3-slider").forEach((item: HTMLInputElement) => {
            item.addEventListener("input", () => {
                item.setAttribute("aria-label", item.value);
                this.searchGraph(false);
            });
        });
        this.element.querySelectorAll(".b3-switch").forEach((item) => {
            item.addEventListener("change", () => {
                this.searchGraph(false);
            });
        });
        this.searchGraph(options.type !== "global");
    }

    private reset(conf: IGraphCommon & ({ dailyNote: boolean } | { minRefs: number, dailyNote: boolean })) {
        if (this.type === "global") {
            window.siyuan.config.graph.global = conf as IGraphCommon & { minRefs: number, dailyNote: boolean };
            this.panelElement.querySelector("[data-type='minRefs']").setAttribute("aria-label", window.siyuan.config.graph.global.minRefs.toString());
            (this.panelElement.querySelector("[data-type='minRefs']") as HTMLInputElement).value = window.siyuan.config.graph.global.minRefs.toString();

        } else {
            window.siyuan.config.graph.local = conf as IGraphCommon & { dailyNote: boolean };
        }
        this.inputElement.value = "";
        this.panelElement.querySelector("[data-type='nodeSize']").setAttribute("aria-label", conf.d3.nodeSize.toString());
        this.panelElement.querySelector("[data-type='centerStrength']").setAttribute("aria-label", conf.d3.centerStrength.toString());
        this.panelElement.querySelector("[data-type='collideRadius']").setAttribute("aria-label", conf.d3.collideRadius.toString());
        this.panelElement.querySelector("[data-type='collideStrength']").setAttribute("aria-label", conf.d3.collideStrength.toString());
        this.panelElement.querySelector("[data-type='lineOpacity']").setAttribute("aria-label", conf.d3.lineOpacity.toString());
        this.panelElement.querySelector("[data-type='linkDistance']").setAttribute("aria-label", conf.d3.linkDistance.toString());
        this.panelElement.querySelector("[data-type='linkWidth']").setAttribute("aria-label", conf.d3.linkWidth.toString());
        (this.panelElement.querySelector("[data-type='nodeSize']") as HTMLInputElement).value = conf.d3.nodeSize.toString();
        (this.panelElement.querySelector("[data-type='centerStrength']") as HTMLInputElement).value = conf.d3.centerStrength.toString();
        (this.panelElement.querySelector("[data-type='collideRadius']") as HTMLInputElement).value = conf.d3.collideRadius.toString();
        (this.panelElement.querySelector("[data-type='collideStrength']") as HTMLInputElement).value = conf.d3.collideStrength.toString();
        (this.panelElement.querySelector("[data-type='lineOpacity']") as HTMLInputElement).value = conf.d3.lineOpacity.toString();
        (this.panelElement.querySelector("[data-type='linkDistance']") as HTMLInputElement).value = conf.d3.linkDistance.toString();
        (this.panelElement.querySelector("[data-type='linkWidth']") as HTMLInputElement).value = conf.d3.linkWidth.toString();
        (this.panelElement.querySelector("[data-type='list']") as HTMLInputElement).checked = conf.type.list;
        (this.panelElement.querySelector("[data-type='listItem']") as HTMLInputElement).checked = conf.type.listItem;
        (this.panelElement.querySelector("[data-type='math']") as HTMLInputElement).checked = conf.type.math;
        (this.panelElement.querySelector("[data-type='paragraph']") as HTMLInputElement).checked = conf.type.paragraph;
        (this.panelElement.querySelector("[data-type='super']") as HTMLInputElement).checked = conf.type.super;
        (this.panelElement.querySelector("[data-type='table']") as HTMLInputElement).checked = conf.type.table;
        (this.panelElement.querySelector("[data-type='tag']") as HTMLInputElement).checked = conf.type.tag;
        (this.panelElement.querySelector("[data-type='dailyNote']") as HTMLInputElement).checked = conf.dailyNote;
        (this.panelElement.querySelector("[data-type='heading']") as HTMLInputElement).checked = conf.type.heading;
        (this.panelElement.querySelector("[data-type='arrow']") as HTMLInputElement).checked = conf.d3.arrow;
        (this.panelElement.querySelector("[data-type='blockquote']") as HTMLInputElement).checked = conf.type.blockquote;
        (this.panelElement.querySelector("[data-type='code']") as HTMLInputElement).checked = conf.type.code;
        this.searchGraph(false);
    }

    public searchGraph(focus: boolean, id?: string, refresh = false) {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (element.classList.contains("fn__rotate") && !id) {
            return;
        }
        element.classList.add("fn__rotate");
        const type = {
            list: (this.panelElement.querySelector("[data-type='list']") as HTMLInputElement).checked,
            listItem: (this.panelElement.querySelector("[data-type='listItem']") as HTMLInputElement).checked,
            math: (this.panelElement.querySelector("[data-type='math']") as HTMLInputElement).checked,
            paragraph: (this.panelElement.querySelector("[data-type='paragraph']") as HTMLInputElement).checked,
            super: (this.panelElement.querySelector("[data-type='super']") as HTMLInputElement).checked,
            table: (this.panelElement.querySelector("[data-type='table']") as HTMLInputElement).checked,
            tag: (this.panelElement.querySelector("[data-type='tag']") as HTMLInputElement).checked,
            heading: (this.panelElement.querySelector("[data-type='heading']") as HTMLInputElement).checked,
            blockquote: (this.panelElement.querySelector("[data-type='blockquote']") as HTMLInputElement).checked,
            code: (this.panelElement.querySelector("[data-type='code']") as HTMLInputElement).checked,
        };
        const d3 = {
            arrow: (this.panelElement.querySelector("[data-type='arrow']") as HTMLInputElement).checked,
            nodeSize: parseFloat((this.panelElement.querySelector("[data-type='nodeSize']") as HTMLInputElement).value),
            centerStrength: parseFloat((this.panelElement.querySelector("[data-type='centerStrength']") as HTMLInputElement).value),
            collideRadius: parseFloat((this.panelElement.querySelector("[data-type='collideRadius']") as HTMLInputElement).value),
            collideStrength: parseFloat((this.panelElement.querySelector("[data-type='collideStrength']") as HTMLInputElement).value),
            lineOpacity: parseFloat((this.panelElement.querySelector("[data-type='lineOpacity']") as HTMLInputElement).value),
            linkDistance: parseFloat((this.panelElement.querySelector("[data-type='linkDistance']") as HTMLInputElement).value),
            linkWidth: parseFloat((this.panelElement.querySelector("[data-type='linkWidth']") as HTMLInputElement).value),
        };
        if (this.type === "global") {
            // 全局
            fetchPost("/api/graph/getGraph", {
                k: this.inputElement.value,
                conf: {
                    type,
                    d3,
                    dailyNote: (this.panelElement.querySelector("[data-type='dailyNote']") as HTMLInputElement).checked,
                    minRefs: parseFloat((this.panelElement.querySelector("[data-type='minRefs']") as HTMLInputElement).value)
                }
            }, response => {
                this.graphData = response.data;
                window.siyuan.config.graph.global = response.data.conf;
                this.onGraph(false);
                element.classList.remove("fn__rotate");
            });
        } else {
            fetchPost("/api/graph/getLocalGraph", {
                type: this.type, // 用于如下场景：当打开文档A的关系图、关系图、文档A后刷新，由于防止请求重复处理，文档A关系图无法渲染。
                k: this.inputElement.value,
                id: id || this.blockId,
                conf: {
                    type,
                    d3,
                    dailyNote: (this.panelElement.querySelector("[data-type='dailyNote']") as HTMLInputElement).checked,
                },
            }, response => {
                element.classList.remove("fn__rotate");
                if (id) {
                    this.blockId = id;
                }
                if (!refresh && this.type === "pin" && this.blockId && !isCurrentEditor(this.blockId)) {
                    return;
                }
                this.graphData = response.data;
                window.siyuan.config.graph.local = response.data.conf;
                this.onGraph(focus);
            });
        }
    }

    public hlNode(id: string) {
        if (this.graphElement.clientHeight === 0 || !this.network || this.network.findNode(id).length === 0) {
            return;
        }
        this.network.focus(id, {
            animation: {
                duration: 1000,
                easingFunction: "easeInOutQuad",
            },
        });
        this.network.selectNodes([id]);
    }

    public onGraph(hl: boolean) {
        if (this.graphElement.clientHeight === 0) {
            // 界面没有渲染时不能进行渲染
            return;
        }
        if (!this.graphData || !this.graphData.nodes || this.graphData.nodes.length === 0) {
            if (this.network) {
                this.network.destroy();
            }
            this.graphElement.firstElementChild.classList.add("fn__none");
            return;
        }
        // 使用颜色
        const rootStyle = getComputedStyle(document.body);
        this.graphData.nodes.forEach(item => {
            switch (item.type) {
                case "NodeDocument":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-doc-point").trim()};
                    break;
                case "NodeParagraph":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-p-point").trim()};
                    break;
                case "NodeHeading":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-heading-point").trim()};
                    break;
                case "NodeMathBlock":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-math-point").trim()};
                    break;
                case "NodeCodeBlock":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-code-point").trim()};
                    break;
                case "NodeTable":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-table-point").trim()};
                    break;
                case "NodeList":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-list-point").trim()};
                    break;
                case "NodeListItem":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-listitem-point").trim()};
                    break;
                case "NodeBlockquote":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-bq-point").trim()};
                    break;
                case "NodeSuperBlock":
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-super-point").trim()};
                    break;
                default:
                    item.color = {background: rootStyle.getPropertyValue("--b3-graph-p-point").trim()};
                    break;
            }
        });
        this.graphData.links.forEach(item => {
            if (item.ref) {
                item.color = {color: rootStyle.getPropertyValue("--b3-graph-ref-line").trim()};
            } else {
                item.color = {color: rootStyle.getPropertyValue("--b3-graph-line").trim()};
            }
        });
        clearTimeout(this.timeout);
        addScript(`${Constants.PROTYLE_CDN}/js/vis/vis-network.min.js?v=9.1.2`, "protyleVisScript").then(() => {
            this.timeout = window.setTimeout(() => {
                if (!this.graphData || !this.graphData.nodes || this.graphData.nodes.length === 0) {
                    if (this.network) {
                        this.network.destroy();
                    }
                    this.graphElement.firstElementChild.classList.add("fn__none");
                    return;
                }
                this.graphElement.firstElementChild.classList.remove("fn__none");
                this.graphElement.firstElementChild.firstElementChild.setAttribute("style", "width:3%");
                const config = window.siyuan.config.graph[this.type === "global" ? "global" : "local"];
                const data = {
                    nodes: this.graphData.nodes,
                    edges: this.graphData.links,
                };
                const options = {
                    autoResize: true,
                    interaction: {
                        hover: true,
                    },
                    nodes: {
                        borderWidth: 0,
                        borderWidthSelected: 5,
                        shape: "dot",
                        font: {
                            face: rootStyle.getPropertyValue("--b3-font-family-graph").trim(),
                            size: 32,
                            color: rootStyle.getPropertyValue("--b3-theme-on-background").trim(),
                        },
                        color: {
                            hover: {
                                border: rootStyle.getPropertyValue("--b3-graph-hl-point").trim(),
                                background: rootStyle.getPropertyValue("--b3-graph-hl-point").trim()
                            },
                            highlight: {
                                border: rootStyle.getPropertyValue("--b3-graph-hl-point").trim(),
                                background: rootStyle.getPropertyValue("--b3-graph-hl-point").trim()
                            },
                        }
                    },
                    edges: {
                        width: config.d3.linkWidth,
                        arrowStrikethrough: false,
                        smooth: false,
                        color: {
                            opacity: config.d3.lineOpacity,
                            hover: rootStyle.getPropertyValue("--b3-graph-hl-line").trim(),
                            highlight: rootStyle.getPropertyValue("--b3-graph-hl-line").trim(),
                        }
                    },
                    layout: {
                        improvedLayout: false
                    },
                    physics: {
                        enabled: true,
                        forceAtlas2Based: {
                            theta: 0.5,
                            gravitationalConstant: -config.d3.collideRadius,
                            centralGravity: config.d3.centerStrength,
                            springConstant: config.d3.collideStrength,
                            springLength: config.d3.linkDistance,
                            damping: 0.4,
                            avoidOverlap: 0.5
                        },
                        maxVelocity: 50,
                        minVelocity: 0.1,
                        solver: "forceAtlas2Based",
                        stabilization: {
                            enabled: true,
                            iterations: 256,
                            updateInterval: 25,
                            onlyDynamicEdges: false,
                            fit: true
                        },
                        timestep: 0.5,
                        adaptiveTimestep: true,
                        wind: {x: 0, y: 0}
                    },
                };
                const network = new vis.Network(this.graphElement.lastElementChild, data, options);
                this.network = network;
                network.on("stabilizationIterationsDone", () => {
                    network.physics.stopSimulation();
                    this.graphElement.firstElementChild.classList.add("fn__none");
                    if (hl) {
                        this.hlNode(this.blockId);
                    }
                });
                network.on("dragEnd", () => {
                    setTimeout(() => {
                        network.physics.stopSimulation();
                    }, 5000);
                });
                network.on("stabilizationProgress", (data: any) => {
                    this.graphElement.firstElementChild.firstElementChild.setAttribute("style", `width:${Math.max(5, data.iterations) / data.total * 100}%`);
                });
                network.on("click", (params: any) => {
                    if (params.nodes.length !== 1) {
                        return;
                    }
                    const node = this.graphData.nodes.find((item) => item.id === params.nodes[0]);
                    if (!node) {
                        return;
                    }
                    if (node.type === "textmark tag") {
                        openGlobalSearch(this.app, `#${node.id}#`, !window.siyuan.ctrlIsPressed);
                        return;
                    }
                    if (window.siyuan.shiftIsPressed) {
                        checkFold(node.id, (zoomIn, action: string[]) => {
                            openFileById({
                                app: this.app,
                                id: node.id,
                                position: "bottom",
                                action,
                                zoomIn
                            });
                        });
                    } else if (window.siyuan.altIsPressed) {
                        checkFold(node.id, (zoomIn, action: string[]) => {
                            openFileById({
                                app: this.app,
                                id: node.id,
                                position: "right",
                                action,
                                zoomIn
                            });
                        });
                    } else if (window.siyuan.ctrlIsPressed) {
                        window.siyuan.blockPanels.push(new BlockPanel({
                            app: this.app,
                            isBacklink: false,
                            x: params.event.center.x,
                            y: params.event.center.y,
                            nodeIds: [node.id],
                        }));
                    } else {
                        checkFold(node.id, (zoomIn, action: string[]) => {
                            openFileById({
                                app: this.app,
                                id: node.id,
                                action,
                                zoomIn
                            });
                        });
                    }
                });
            }, 1000);
        });
    }
}
