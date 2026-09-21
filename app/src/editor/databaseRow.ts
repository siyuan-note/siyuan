import {Custom} from "../layout/dock/Custom";
import {Tab} from "../layout/Tab";
import type {App} from "../index";
import {renderAVAttribute} from "../protyle/render/av/blockAttr";
import {Protyle} from "../protyle";
import {getEditorHorizontalPadding} from "../protyle/ui/padding";
import {searchMarkRender} from "../protyle/render/searchMarkRender";
import {registerDatabaseRowRefresh} from "../protyle/render/av/databaseRowRefresh";
import {focusNewDatabasePrimary} from "../protyle/render/av/primaryFocus";

export const newDatabaseRowModel = (options: {
    app: App,
    tab: Tab,
    data: {
        avID: string,
        blockID: string,
        notebookId: string,
        itemID: string,
        valueID: string,
        title: string,
        matchedValueID?: string,
        matchedKeyID?: string,
        keywords?: string[],
        focusPrimary?: boolean,
    },
}) => {
    let customModel: Custom;
    let contextProtyle: IProtyle;
    let ghostProtyle: Protyle;
    let resizeObserver: ResizeObserver;
    let unregisterRefresh: () => void;
    let destroyed = false;
    let renderVersion = 0;
    const updateTitle = (custom: Custom, bodyElement: HTMLElement) => {
        const primaryElement = bodyElement.querySelector<HTMLElement>('[data-primary="true"] [data-cell-value]');
        if (!primaryElement?.dataset.cellValue) {
            return;
        }
        const value = JSON.parse(decodeURIComponent(primaryElement.dataset.cellValue)) as IAVCellValue;
        const title = value.block?.content || window.siyuan.languages.untitled;
        custom.data.title = title;
        custom.element.querySelector(".protyle-db-row__title span").textContent = title;
        custom.tab.updateTitle(title);
    };
    const updateLayout = (custom: Custom) => {
        const width = custom.element.clientWidth;
        const padding = getEditorHorizontalPadding(width, window.siyuan.config.editor.fullWidth);
        const titleElement = custom.element.querySelector<HTMLElement>(".protyle-db-row__title");
        const bodyElement = custom.element.querySelector<HTMLElement>(".protyle-db-row__body");
        if (titleElement) {
            titleElement.style.margin = `16px ${padding.right}px 0 ${padding.left}px`;
            titleElement.style.padding = "8px 0";
        }
        if (bodyElement) {
            bodyElement.style.margin = `8px ${padding.right}px 8px ${padding.left}px`;
        }
    };
    const render = (custom: Custom) => {
        const previousBodyElement = custom.element.querySelector<HTMLElement>(".protyle-db-row__body");
        if (!previousBodyElement || !contextProtyle) {
            return;
        }
        const data = custom.data as typeof options.data;
        const currentRenderVersion = ++renderVersion;
        const bodyElement = document.createElement("div");
        bodyElement.className = "custom-attr protyle-db-row__body";
        renderAVAttribute(bodyElement, data.itemID, contextProtyle, (element) => {
            if (destroyed || currentRenderVersion !== renderVersion || !previousBodyElement.isConnected) {
                return;
            }
            // 保留当前内容，待属性和反链加载完成后一次替换，避免刷新期间出现空白。
            previousBodyElement.replaceWith(element);
            updateLayout(custom);
            updateTitle(custom, element);
            focusNewDatabasePrimary(custom.element, contextProtyle, data);
            if (!data.keywords?.length) {
                return;
            }
            const rootElement = custom.element.querySelector<HTMLElement>(".protyle-content");
            if (!rootElement) {
                return;
            }
            const matchedElement = data.matchedValueID ?
                rootElement.querySelector(`[data-av-id="${data.avID}"] [data-id="${data.matchedValueID}"]`) :
                rootElement.querySelector(
                    `[data-av-id="${data.avID}"] [data-col-id="${data.matchedKeyID}"][data-row-id="${data.itemID}"]`);
            searchMarkRender(contextProtyle, data.keywords, undefined, () => {
                matchedElement?.scrollIntoView({block: "center"});
            }, {
                rootElement,
                currentElement: matchedElement,
            });
        },
            {avID: data.avID, itemID: data.itemID, valueID: data.valueID, databaseBlockID: data.blockID});
    };
    const model = new Custom({
        app: options.app,
        tab: options.tab,
        type: "siyuan-database-row",
        data: options.data,
        init(custom) {
            customModel = custom;
            custom.element.innerHTML = `<div class="protyle-db-row fn__flex-1 fn__flex-column">
    <div class="protyle-content">
        <div class="protyle-top">
            <div class="protyle-db-row__title"><svg><use xlink:href="#iconDatabase"></use></svg><span></span></div>
            <div class="custom-attr protyle-db-row__body"></div>
        </div>
    </div>
</div>`;
            custom.element.querySelector(".protyle-db-row__title span").textContent = options.data.title || window.siyuan.languages.untitled;
            custom.element.addEventListener("database-row-title-update", (event) => {
                const title = (event as CustomEvent<string>).detail;
                custom.data.title = title;
                custom.tab.updateTitle(title);
            });
            updateLayout(custom);
            resizeObserver = new ResizeObserver(() => updateLayout(custom));
            resizeObserver.observe(custom.element);
            ghostProtyle = new Protyle(options.app, document.createElement("div"), {
                blockId: options.data.blockID,
                notebookId: options.data.notebookId,
                after(editor) {
                    if (destroyed) {
                        return;
                    }
                    contextProtyle = editor.protyle;
                    unregisterRefresh = registerDatabaseRowRefresh(contextProtyle.id, {
                        getAVID: () => (customModel.data as typeof options.data).avID,
                        refresh: () => render(customModel),
                    });
                    custom.element.append(contextProtyle.highlight.styleElement);
                    render(custom);
                },
            });
        },
        destroy() {
            destroyed = true;
            resizeObserver?.disconnect();
            unregisterRefresh?.();
            ghostProtyle?.destroy();
        },
        update() {
            render(customModel);
        },
        resize() {
            updateLayout(customModel);
        },
    });
    return model;
};
