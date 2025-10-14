import {Tab} from "../layout/Tab";
import {Custom} from "../layout/dock/Custom";
import {bindCardEvent, genCardHTML, initCardComponent} from "./openCard";
import {fetchPost} from "../util/fetch";
import {Protyle} from "../protyle";
import {setPanelFocus} from "../layout/util";
import {App} from "../index";
import {clearOBG} from "../layout/dock/util";

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
    
    const fetchCardsData = async (): Promise<ICardData> => {
        return new Promise((resolve) => {
            fetchPost(options.data.cardType === "all" ? "/api/riff/getRiffDueCards" :
                (options.data.cardType === "doc" ? "/api/riff/getTreeRiffDueCards" : "/api/riff/getNotebookRiffDueCards"), {
                rootID: options.data.id,
                deckID: options.data.id,
                notebook: options.data.id,
            }, async (response) => {
                let cardsData: ICardData = response.data;
                for (let i = 0; i < options.app.plugins.length; i++) {
                    cardsData = await options.app.plugins[i].updateCards(response.data);
                }
                resolve(cardsData);
            });
        });
    };

    const renderCardsAndBindEvents = async (element: HTMLElement, data: any, cardsData: ICardData, index?: number, isUpdate?: boolean) => {
        customObj.editors.forEach(editor => {
            editor.destroy();
        });
        customObj.editors.length = 0;

        element.innerHTML = genCardHTML({
            id: data.id,
            cardType: data.cardType,
            cardsData,
            isTab: true,
        });

        const cardOptions = {
            app: options.app,
            element: element,
            id: data.id,
            title: data.title,
            cardType: data.cardType,
            cardsData,
            index,
        };

        if (isUpdate) {
            const initResult = await initCardComponent(cardOptions);
            editor = initResult.editor;
        } else {
            editor = await bindCardEvent(cardOptions);
        }

        customObj.editors.push(editor);
    };

    const customObj = new Custom({
        app: options.app,
        type: "siyuan-card",
        tab: options.tab,
        data: options.data,
        async init() {
            if (options.data.cardsData) {
                // 使用现有的 cardsData
                for (let i = 0; i < options.app.plugins.length; i++) {
                    options.data.cardsData = await options.app.plugins[i].updateCards(options.data.cardsData);
                }
                await renderCardsAndBindEvents(this.element, this.data, options.data.cardsData, options.data.index);
                // https://github.com/siyuan-note/siyuan/issues/9561#issuecomment-1794473512
                delete options.data.cardsData;
                delete options.data.index;
            } else {
                // 获取新的 cardsData
                const cardsData = await fetchCardsData();
                await renderCardsAndBindEvents(this.element, this.data, cardsData);
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
        async update() {
            const cardsData = await fetchCardsData();
            await renderCardsAndBindEvents(this.element, this.data, cardsData ,undefined, true);
        }
    });
    customObj.element.addEventListener("click", () => {
        clearOBG();
        setPanelFocus(customObj.element.parentElement.parentElement);
    });
    return customObj;
};
