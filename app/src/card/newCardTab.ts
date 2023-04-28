import {Tab} from "../layout/Tab";
import {Custom} from "../layout/dock/Custom";
import {bindCardEvent, genCardHTML} from "./openCard";
import {fetchPost} from "../util/fetch";
import {Protyle} from "../protyle";

export const newCardModel = (options: {
    tab: Tab,
    data: {
        cardType: TCardType,
        id: string,
        title?: string
    }
}) => {
    let editor: Protyle;
    const custom = new Custom({
        type: "card",
        tab: options.tab,
        data: options.data,
        init() {
            fetchPost(this.data.cardType === "all" ? "/api/riff/getRiffDueCards" :
                (this.data.cardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
                rootID: this.data.id,
                deckID: this.data.id,
                notebook: this.data.id,
            }, (response) => {
                this.element.innerHTML = genCardHTML({
                    id: this.data.id,
                    cardType: this.data.cardType,
                    blocks: response.data.cards,
                    isTab: true,
                });

                editor = bindCardEvent({
                    element: this.element,
                    id: this.data.id,
                    title: this.data.title,
                    cardType: this.data.cardType,
                    blocks: response.data.cards,
                });
            });
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
                    blocks: response.data.cards,
                    isTab: true,
                });
            });
        }
    });
    return custom;
};
