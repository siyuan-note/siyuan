import {Wnd} from "../layout/Wnd";
import {getInstanceById, getWndByLayout} from "../layout/util";
import {Tab} from "../layout/Tab";
import {Custom} from "../layout/dock/Custom";
import {Dialog} from "../dialog";
import {genCardHTML} from "./openCard";
import {fetchPost} from "../util/fetch";

export const newCardTab = (options: {
    type: TCardType,
    id: string,
    dialog: Dialog
}) => {
    let wnd: Wnd;
    const element = document.querySelector(".layout__wnd--active");
    if (element) {
        wnd = getInstanceById(element.getAttribute("data-id")) as Wnd;
    }
    if (!wnd) {
        wnd = getWndByLayout(window.siyuan.layout.centerLayout);
    }
    const tab = new Tab({
        icon: "iconRiffCard",
        title: window.siyuan.languages.spaceRepetition,
        callback(tab) {
            const custom = new Custom({
                type: "card",
                tab,
                data: {
                    type: options.type,
                    id: options.id
                },
                init(element) {
                    fetchPost(options.type === "all" ? "/api/riff/getRiffDueCards" :
                        (options.type === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
                        rootID: options.id,
                        deckID: options.id,
                        notebook: options.id,
                    }, (response) => {
                        element.innerHTML = genCardHTML({
                            id: options.id,
                            cardType: options.type,
                            blocks: response.data,
                            isTab: true,
                        });
                    });
                }
            });
            tab.addModel(custom);
        }
    });
    wnd.split("lr").addTab(tab);
    options.dialog.destroy();
}
