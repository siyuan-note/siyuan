import {Custom} from "../layout/dock/Custom";
import {Tab} from "../layout/Tab";
import {App} from "../index";
import {renderAVAttribute} from "../protyle/render/av/blockAttr";
import {Protyle} from "../protyle";
import {getEditorHorizontalPadding} from "../protyle/ui/padding";

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
    },
}) => {
    let customModel: Custom;
    let contextProtyle: IProtyle;
    let ghostProtyle: Protyle;
    let resizeObserver: ResizeObserver;
    let destroyed = false;
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
        const bodyElement = document.createElement("div");
        bodyElement.className = "custom-attr protyle-db-row__body";
        previousBodyElement.replaceWith(bodyElement);
        updateLayout(custom);
        renderAVAttribute(bodyElement, options.data.itemID, contextProtyle, undefined,
            {avID: options.data.avID, itemID: options.data.itemID, valueID: options.data.valueID});
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
                    render(custom);
                },
            });
        },
        destroy() {
            destroyed = true;
            resizeObserver?.disconnect();
            ghostProtyle?.destroy();
        },
        update() {
            render(customModel);
        },
    });
    return model;
};
