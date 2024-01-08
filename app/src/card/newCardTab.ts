import {Tab} from "../layout/Tab";
import {Custom} from "../layout/dock/Custom";
import {bindCardEvent, genCardHTML} from "./openCard";
import {fetchPost} from "../util/fetch";
import {Protyle} from "../protyle";
import {setPanelFocus} from "../layout/util";
import {App} from "../index";

export const newCardModel = (options: {
    app: App,
    tab: Tab,
    data: {
        cardType: TCardType,
        id: string,
        title?: string
        cardsData?: ICardData,
        index?: number,
    }
}) => {
    let editor: Protyle;
    const customObj = new Custom({
        app: options.app,
        type: "siyuan-card",
        tab: options.tab,
        data: options.data,
        async init() {
            if (options.data.cardsData) {
                this.element.innerHTML = genCardHTML({
                    id: this.data.id,
                    cardType: this.data.cardType,
                    cardsData: options.data.cardsData,
                    isTab: true,
                });

                editor = await bindCardEvent({
                    app: options.app,
                    element: this.element,
                    id: this.data.id,
                    title: this.data.title,
                    cardType: this.data.cardType,
                    cardsData: options.data.cardsData,
                    index: options.data.index,
                });
                this.data.editor = editor;
                // https://github.com/siyuan-note/siyuan/issues/9561#issuecomment-1794473512
                delete options.data.cardsData;
                delete options.data.index;
            } else {
                fetchPost(this.data.cardType === "all" ? "/api/riff/getRiffDueCards" :
                    (this.data.cardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
                    rootID: this.data.id,
                    deckID: this.data.id,
                    notebook: this.data.id,
                }, async (response) => {
                    this.element.innerHTML = genCardHTML({
                        id: this.data.id,
                        cardType: this.data.cardType,
                        cardsData: response.data,
                        isTab: true,
                    });

                    editor = await bindCardEvent({
                        app: options.app,
                        element: this.element,
                        id: this.data.id,
                        title: this.data.title,
                        cardType: this.data.cardType,
                        cardsData: response.data,
                    });
                    customObj.data.editor = editor;
                });
            }
        },
        destroy() {
            if (editor) {
                editor.destroy();
            }
        },
        resize() {
            if (editor) {
                editor.resize();
            }
        },
        update() {
            fetchPost(this.data.cardType === "all" ? "/api/riff/getRiffDueCards" :
                (this.data.cardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
                rootID: this.data.id,
                deckID: this.data.id,
                notebook: this.data.id,
            }, (response) => {
                this.element.innerHTML = genCardHTML({
                    id: this.data.id,
                    cardType: this.data.cardType,
                    cardsData: response.data,
                    isTab: true,
                });
            });
        }
    });
    customObj.element.addEventListener("click", () => {
        setPanelFocus(customObj.element.parentElement.parentElement);
    });
    return customObj;
};
