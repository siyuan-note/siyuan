import {Custom} from "../layout/dock/Custom";
import {Tab} from "../layout/Tab";
import {App} from "../index";
import {renderAVAttribute} from "../protyle/render/av/blockAttr";
import {Protyle} from "../protyle";

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
    let destroyed = false;
    const render = (custom: Custom) => {
        const previousBodyElement = custom.element.querySelector<HTMLElement>(".protyle-db-row__body");
        if (!previousBodyElement || !contextProtyle) {
            return;
        }
        const bodyElement = document.createElement("div");
        bodyElement.className = "custom-attr protyle-db-row__body";
        previousBodyElement.replaceWith(bodyElement);
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
            ghostProtyle?.destroy();
        },
        update() {
            render(customModel);
        },
    });
    return model;
};
