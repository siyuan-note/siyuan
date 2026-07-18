import {Custom} from "../layout/dock/Custom";
import {Tab} from "../layout/Tab";
import {App} from "../index";
import {renderAVAttribute} from "../protyle/render/av/blockAttr";
import {getAllModels} from "../layout/getAll";

export const newDatabaseRowModel = (options: {
    app: App,
    tab: Tab,
    data: {
        avID: string,
        itemID: string,
        valueID: string,
        title: string,
    },
    protyle?: IProtyle,
}) => {
    const render = (custom: Custom, retry = true) => {
        const previousBodyElement = custom.element.querySelector<HTMLElement>(".protyle-db-row__body");
        if (!previousBodyElement) {
            return;
        }
        const bodyElement = document.createElement("div");
        bodyElement.className = "custom-attr protyle-db-row__body";
        previousBodyElement.replaceWith(bodyElement);
        const sourceProtyle = options.protyle?.ws?.ws?.readyState === WebSocket.OPEN ?
            options.protyle : getAllModels().editor[0]?.editor.protyle;
        if (sourceProtyle) {
            renderAVAttribute(bodyElement, options.data.itemID, sourceProtyle, undefined,
                {avID: options.data.avID, itemID: options.data.itemID, valueID: options.data.valueID});
        } else if (retry) {
            setTimeout(() => render(custom, false), 0);
        }
    };
    const model = new Custom({
        app: options.app,
        tab: options.tab,
        type: "siyuan-database-row",
        data: options.data,
        init(custom) {
            custom.element.innerHTML = `<div class="protyle-db-row fn__flex-1 fn__flex-column">
    <div class="protyle-content">
        <div class="protyle-top">
            <div class="protyle-db-row__title"><svg><use xlink:href="#iconDatabase"></use></svg><span></span></div>
            <div class="custom-attr protyle-db-row__body"></div>
        </div>
    </div>
</div>`;
            custom.element.querySelector(".protyle-db-row__title span").textContent = options.data.title || window.siyuan.languages.untitled;
            render(custom);
        },
        update() {
            render(options.tab.model as Custom);
        },
    });
    return model;
};
