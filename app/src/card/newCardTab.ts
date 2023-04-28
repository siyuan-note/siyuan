import {Wnd} from "../layout/Wnd";
import {getInstanceById, getWndByLayout} from "../layout/util";
import {Tab} from "../layout/Tab";
import {Custom} from "../layout/dock/Custom";
import {Dialog} from "../dialog";
import {bindCardEvent, genCardHTML} from "./openCard";
import {fetchPost} from "../util/fetch";
import {Protyle} from "../protyle";

export const newCardTab = (options: {
    cardType: TCardType,
    id: string,
    dialog: Dialog,
    title?: string
}) => {
    let wnd: Wnd;
    const element = document.querySelector(".layout__wnd--active");
    if (element) {
        wnd = getInstanceById(element.getAttribute("data-id")) as Wnd;
    }
    if (!wnd) {
        wnd = getWndByLayout(window.siyuan.layout.centerLayout);
    }
    let editor: Protyle
    const tab = new Tab({
        icon: "iconRiffCard",
        title: window.siyuan.languages.spaceRepetition,
        callback(tab) {
            const custom = new Custom({
                type: "card",
                tab,
                data: {
                    title: options.title,
                    cardType: options.cardType,
                    id: options.id
                },
                init(element) {
                    fetchPost(options.cardType === "all" ? "/api/riff/getRiffDueCards" :
                        (options.cardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
                        rootID: options.id,
                        deckID: options.id,
                        notebook: options.id,
                    }, (response) => {
                        element.innerHTML = genCardHTML({
                            id: options.id,
                            cardType: options.cardType,
                            blocks: response.data.cards,
                            isTab: true,
                        });

                        editor = bindCardEvent({
                            element,
                            id: options.id,
                            title: options.title,
                            cardType: options.cardType,
                            blocks: response.data.cards,
                            dialog: options.dialog,
                        })
                    });
                },
                destroy() {
                    editor.destroy();
                },
                resize(){
                    editor.resize();
                }
            });
            tab.addModel(custom);
        }
    });
    wnd.split("lr").addTab(tab);
    options.dialog.destroy();
}
