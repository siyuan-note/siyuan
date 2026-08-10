import {Tab} from "../Tab";
import {getInstanceById, setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {Model} from "../Model";
import {BlockPanel} from "../../block/Panel";
import {fullscreen} from "../../protyle/breadcrumb/action";
import {fetchPost} from "../../util/fetch";
import {openFileById} from "../../editor/util";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openGlobalSearch} from "../../search/util";
import type {App} from "../../index";
import {checkFold} from "../../util/noRelyPCFunction";
import {Editor} from "../../editor";
import {getDocDisplayName, isEncryptedBox} from "../../util/pathName";
import {GraphEngine} from "./graph/GraphEngine";
import {IGraphNodeClick, IGraphSourceLink, IGraphSourceNode} from "./graph/types";

export class Graph extends Model {
    public inputElement: HTMLInputElement;
    private countElement: HTMLElement;
    private graphElement: HTMLDivElement;
    private graphEngine: GraphEngine | undefined;
    private panelElement: HTMLElement;
    private element: HTMLElement;
    private saveTimeout: number;
    private searchTimeout: number;
    private pendingGraphConf: IGraphCommon & {dailyNote: boolean, minRefs?: number};
    public blockId: string; // "local" / "pin" 必填
    public rootId: string; // "local" 必填
    public notebookId: string;
    public graphData: {
        nodes: IGraphSourceNode[],
        links: IGraphSourceLink[],
        box: string
    };
    private renderedGraphData: Graph["graphData"];
    private requestVersion = 0;
    public type: "local" | "pin" | "global";

    constructor(options: {
        app: App
        tab: Tab
        blockId?: string
        rootId?: string
        notebookId?: string
        type: "local" | "pin" | "global"
    }) {
        super({app: options.app});
        this.connect({
            id: options.tab.id,
            type: "graph",
            callback: this.handleCallback.bind(this),
            msgCallback: this.handleMsgCallback.bind(this)
        });
        this.element = options.tab.panelElement;
        this.blockId = options.blockId;
        this.rootId = options.rootId;
        this.notebookId = options.notebookId || "";
        this.type = options.type;

        this.element.classList.add("graph", "file-tree", this.type === "global" ? "sy__globalGraph" : "sy__graph", "dockPanel");
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
    <span>${window.siyuan.languages.callout}</span> 
    <input data-type="callout" type="checkbox" class="b3-switch"${window.siyuan.config.graph.global.type.callout ? " checked" : ""}/>
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
    <span>${window.siyuan.languages.callout}</span> 
    <input data-type="callout" type="checkbox" class="b3-switch"${window.siyuan.config.graph.local.type.callout ? " checked" : ""}/>
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
        this.element.innerHTML = `<div class="block__icons"> 
    <div class="block__logo block__logo--counter fn__flex-1">${this.type === "global" ? window.siyuan.languages.globalGraph : window.siyuan.languages.graphView}<span class="counter fn__none" data-type="node-count"></span></div>
    <input class="b3-text-field search__label fn__size200 fn__none" placeholder="${window.siyuan.languages.searchPlaceholder}" />
    <span data-type="search" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.search}"><svg><use xlink:href='#iconFilter'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <div class="fn__space"></div>
    <div data-type="fullscreen" class="ariaLabel block__icon" data-position="north" aria-label="${window.siyuan.languages.fullscreen}">
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </div>
    <div class="fn__space"></div>
    <div data-type="menu" class="ariaLabel block__icon" data-position="north" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </div> 
    <span class="${this.type === "local" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min"  class="${this.type === "local" ? "fn__none " : ""}block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="graph__panel">
    ${panelHTML}
</div>
<div class="fn__flex-1 graph__svg"></div>`;
        this.countElement = this.element.querySelector('[data-type="node-count"]');
        this.graphElement = this.element.querySelector(".graph__svg");
        this.ensureGraphEngine();
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
                        getDockByType(this.type === "global" ? "globalGraph" : "graph").toggleModel(this.type === "global" ? "globalGraph" : "graph", false, true);
                    } else if (dataType === "menu") {
                        if (target.classList.contains("block__icon--active")) {
                            target.classList.remove("block__icon--active");
                            this.panelElement.style.right = "";
                        } else {
                            target.classList.add("block__icon--active");
                            this.panelElement.style.right = "0";
                        }
                    } else if (dataType === "search") {
                        target.previousElementSibling.classList.remove("fn__none");
                        (target.previousElementSibling as HTMLInputElement).select();
                    } else if (dataType === "refresh") {
                        this.searchGraph(false, undefined, true);
                    } else if (dataType === "fullscreen") {
                        fullscreen(this.element, target);
                        const minElement = this.element.querySelector('.block__icons .block__icon[data-type="min"]') as HTMLElement;
                        if (this.element.className.includes("fullscreen")) {
                            minElement.style.transition = "none";
                            minElement.classList.add("fn__none");
                            minElement.previousElementSibling.classList.add("fn__none");
                        } else {
                            minElement.style.transition = "";
                            minElement.classList.remove("fn__none");
                            minElement.previousElementSibling.classList.remove("fn__none");
                        }
                    }
                    break;
                } else if (target.classList.contains("graph__svg")) {
                    this.element.querySelectorAll(".block__icon.block__icon--active").forEach(item => {
                        item.classList.remove("block__icon--active");
                    });
                    this.panelElement.style.right = "";
                    break;
                }
                target = target.parentElement;
            }
        });
        this.inputElement.addEventListener("compositionend", () => {
            this.scheduleGraphSearch();
        });
        this.inputElement.addEventListener("blur", (event: InputEvent) => {
            const inputElement = event.target as HTMLInputElement;
            inputElement.classList.add("fn__none");
        });
        this.inputElement.addEventListener("input", (event: InputEvent) => {
            if (event.isComposing) {
                return;
            }
            this.scheduleGraphSearch();
        });
        this.element.querySelectorAll(".b3-slider").forEach((item: HTMLInputElement) => {
            item.addEventListener("input", () => {
                item.setAttribute("aria-label", item.value);
                if (item.getAttribute("data-type") === "minRefs") {
                    this.scheduleGraphSearch();
                } else {
                    this.updateGraphOptions();
                }
            });
        });
        this.element.querySelectorAll(".b3-switch").forEach((item: HTMLInputElement) => {
            item.addEventListener("change", () => {
                if (item.getAttribute("data-type") === "arrow") {
                    this.updateGraphOptions();
                } else {
                    this.searchGraph(false);
                }
            });
        });
        this.searchGraph(options.type !== "global");
    }

    private handleCallback() {
        if (this.type === "local") {
            fetchPost("/api/block/checkBlockExist", {id: this.blockId}, existResponse => {
                if (!existResponse.data) {
                    this.parent.parent.removeTab(this.parent.id);
                }
            });
        }
    }

    private handleMsgCallback(data: IWebSocketData) {
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
                            this.parent.updateTitle(getDocDisplayName(data.data.title, data.data.empty));
                        }
                    }
                    if (this.type === "global") {
                        this.searchGraph(false);
                    }
                    break;
                case "closeBox":
                case "removeBox":
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

    private reset(conf: IGraphCommon & ({ dailyNote: boolean } | { minRefs: number, dailyNote: boolean })) {
        if (this.saveTimeout) {
            window.clearTimeout(this.saveTimeout);
            this.saveTimeout = 0;
        }
        this.pendingGraphConf = undefined;
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
        (this.panelElement.querySelector("[data-type='callout']") as HTMLInputElement).checked = conf.type.callout;
        (this.panelElement.querySelector("[data-type='code']") as HTMLInputElement).checked = conf.type.code;
        this.searchGraph(false);
    }

    public searchGraph(focus: boolean, id?: string, refresh = false) {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (element.classList.contains("fn__rotate") && refresh) {
            return;
        }
        if (this.searchTimeout) {
            window.clearTimeout(this.searchTimeout);
            this.searchTimeout = 0;
        }
        if (this.saveTimeout) {
            window.clearTimeout(this.saveTimeout);
            this.saveTimeout = 0;
            this.persistGraphConf();
        }
        const requestVersion = ++this.requestVersion;
        element.classList.add("fn__rotate");
        const conf = this.getGraphConf();
        if (this.type === "global") {
            // 全局
            fetchPost("/api/graph/getGraph", {
                k: this.inputElement.value,
                conf,
            }, response => {
                if (requestVersion !== this.requestVersion) {
                    return;
                }
                this.graphData = response.data;
                window.siyuan.config.graph.global = response.data.conf;
                this.onGraph(false, refresh);
                element.classList.remove("fn__rotate");
            });
        } else {
            fetchPost("/api/graph/getLocalGraph", {
                type: this.type, // 用于如下场景：当打开文档A的关系图、关系图、文档A后刷新，由于防止请求重复处理，文档A关系图无法渲染。
                k: this.inputElement.value,
                id: id || this.blockId,
                notebook: isEncryptedBox(this.notebookId) ? this.notebookId : undefined,
                conf,
            }, response => {
                if (requestVersion !== this.requestVersion) {
                    return;
                }
                element.classList.remove("fn__rotate");
                if (response.code !== 0) {
                    this.graphData = undefined;
                    this.onGraph(false);
                    return;
                }
                if (id) {
                    this.blockId = id;
                }
                if (!refresh && this.type === "pin" && this.blockId) {
                    const isActive = Array.from(document.querySelectorAll(".fn__flex > .layout-tab-bar > .item--focus")).find(activeElement => {
                        const tab = getInstanceById(activeElement.getAttribute("data-id"));
                        if (tab instanceof Tab && tab.model instanceof Editor) {
                            if (tab.model.editor.protyle.block.rootID === this.blockId ||
                                tab.model.editor.protyle.block.parentID === this.blockId ||
                                tab.model.editor.protyle.block.id === this.blockId) {
                                return true;
                            }
                        }
                    });
                    if (!isActive) {
                        return;
                    }
                }
                this.graphData = response.data;
                window.siyuan.config.graph.local = response.data.conf;
                this.onGraph(focus, refresh);
            });
        }
    }

    private hlNode(id: string) {
        const graphEngine = this.graphEngine;
        if (this.graphElement.clientHeight === 0 || !graphEngine?.hasNode(id)) {
            return;
        }
        graphEngine.focusNode(id);
    }

    public destroy() {
        this.requestVersion++;
        if (this.searchTimeout) {
            window.clearTimeout(this.searchTimeout);
        }
        if (this.saveTimeout) {
            window.clearTimeout(this.saveTimeout);
            this.saveTimeout = 0;
        }
        this.persistGraphConf();
        this.graphEngine?.destroy();
        this.graphEngine = undefined;
        this.renderedGraphData = undefined;
    }

    private scheduleGraphSearch() {
        if (this.searchTimeout) {
            window.clearTimeout(this.searchTimeout);
        }
        this.searchTimeout = window.setTimeout(() => {
            this.searchTimeout = 0;
            this.searchGraph(false);
        }, 160);
    }

    private getGraphConf() {
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
            callout: (this.panelElement.querySelector("[data-type='callout']") as HTMLInputElement).checked,
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
        const conf: IGraphCommon & {dailyNote: boolean, minRefs?: number} = {
            type,
            d3,
            dailyNote: (this.panelElement.querySelector("[data-type='dailyNote']") as HTMLInputElement).checked,
        };
        if (this.type === "global") {
            conf.minRefs = parseFloat((this.panelElement.querySelector("[data-type='minRefs']") as HTMLInputElement).value);
        }
        return conf;
    }

    private updateGraphOptions() {
        const conf = this.getGraphConf();
        if (this.type === "global") {
            window.siyuan.config.graph.global = conf as IGraphCommon & {dailyNote: boolean, minRefs: number};
        } else {
            window.siyuan.config.graph.local = conf;
        }
        this.onGraph(false);
        if (this.saveTimeout) {
            window.clearTimeout(this.saveTimeout);
        }
        this.pendingGraphConf = conf;
        this.saveTimeout = window.setTimeout(() => {
            this.saveTimeout = 0;
            this.persistGraphConf();
        }, 300);
    }

    private persistGraphConf() {
        if (!this.pendingGraphConf) {
            return;
        }
        fetchPost("/api/graph/setGraphConf", {
            type: this.type === "global" ? "global" : "local",
            conf: this.pendingGraphConf,
        });
        this.pendingGraphConf = undefined;
    }

    public onGraph(hl: boolean, resetLayout = false) {
        this.updateNodeCount();
        const graphEngine = this.ensureGraphEngine();
        if (!this.graphData || !this.graphData.nodes || this.graphData.nodes.length === 0) {
            this.renderedGraphData = undefined;
            graphEngine.clear();
            return;
        }
        const rootStyle = getComputedStyle(document.body);
        const config = window.siyuan.config.graph[this.type === "global" ? "global" : "local"];
        const options = {
            ...config.d3,
        };
        const palette = {
            background: rootStyle.getPropertyValue("--b3-theme-on-background").trim(),
            blockquote: rootStyle.getPropertyValue("--b3-graph-bq-point").trim(),
            callout: rootStyle.getPropertyValue("--b3-graph-callout-point").trim(),
            code: rootStyle.getPropertyValue("--b3-graph-code-point").trim(),
            document: rootStyle.getPropertyValue("--b3-graph-doc-point").trim(),
            heading: rootStyle.getPropertyValue("--b3-graph-heading-point").trim(),
            highlightLine: rootStyle.getPropertyValue("--b3-graph-hl-line").trim(),
            highlightPoint: rootStyle.getPropertyValue("--b3-graph-hl-point").trim(),
            line: rootStyle.getPropertyValue("--b3-graph-line").trim(),
            list: rootStyle.getPropertyValue("--b3-graph-list-point").trim(),
            listItem: rootStyle.getPropertyValue("--b3-graph-listitem-point").trim(),
            math: rootStyle.getPropertyValue("--b3-graph-math-point").trim(),
            paragraph: rootStyle.getPropertyValue("--b3-graph-p-point").trim(),
            referenceLine: rootStyle.getPropertyValue("--b3-graph-ref-line").trim(),
            superBlock: rootStyle.getPropertyValue("--b3-graph-super-point").trim(),
            table: rootStyle.getPropertyValue("--b3-graph-table-point").trim(),
            tag: rootStyle.getPropertyValue("--b3-graph-tag-point").trim(),
        };
        if (this.renderedGraphData !== this.graphData) {
            this.renderedGraphData = this.graphData;
            graphEngine.setData(this.graphData.nodes, this.graphData.links, options, palette,
                hl ? this.blockId : "", resetLayout);
        } else {
            graphEngine.updateOptions(options, palette);
            graphEngine.resize();
            if (hl) {
                this.hlNode(this.blockId);
            }
        }
    }

    private ensureGraphEngine() {
        if (!this.graphEngine) {
            this.graphEngine = new GraphEngine(this.graphElement, {
                onNodeClick: (details) => this.openGraphNode(details),
            });
            this.renderedGraphData = undefined;
        }
        return this.graphEngine;
    }

    private updateNodeCount() {
        if (!this.graphData?.nodes) {
            this.countElement.textContent = "";
            this.countElement.classList.add("fn__none");
            return;
        }
        this.countElement.textContent = this.graphData.nodes.length.toString();
        this.countElement.classList.remove("fn__none");
    }

    private openGraphNode(details: IGraphNodeClick) {
        const node = details.node;
        if (-1 < node.type.indexOf("tag")) {
            openGlobalSearch(this.app, `#${node.id}#`, !window.siyuan.ctrlIsPressed, {method: 0});
            return;
        }
        if (window.siyuan.shiftIsPressed) {
            checkFold(node.id, (zoomIn, action: TProtyleAction[]) => {
                openFileById({
                    app: this.app,
                    id: node.id,
                    position: "bottom",
                    action,
                    zoomIn
                });
            });
        } else if (window.siyuan.altIsPressed) {
            checkFold(node.id, (zoomIn, action: TProtyleAction[]) => {
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
                x: details.x,
                y: details.y,
                refDefs: [{refID: node.id}]
            }));
        } else {
            checkFold(node.id, (zoomIn, action: TProtyleAction[]) => {
                openFileById({
                    app: this.app,
                    id: node.id,
                    action,
                    zoomIn
                });
            });
        }
    }
}
