import {Tab} from "../layout/Tab";
import {Custom} from "../layout/dock/Custom";
import {setPanelFocus} from "../layout/util";
import type {App} from "../index";
import {clearOBG} from "../layout/dock/util";
import {ensureFlashcardV2} from "./flashcardV2";
import {openFlashcardV2ReviewSession} from "./flashcardV2Session";
import {normalizeFlashcardTabData, type IFlashcardTabData} from "./flashcardTab";
import {fetchPost} from "../util/fetch";
import {showMessage} from "../dialog/message";

export const newCardModel = (options: {
    app: App,
    tab: Tab,
    data: IFlashcardTabData,
}) => {
    const controller = new AbortController();
    const customObj = new Custom({
        app: options.app,
        type: "siyuan-card",
        tab: options.tab,
        data: {
            cardType: options.data.cardType,
            id: options.data.id,
            title: options.data.title,
            review: options.data.review,
        },
        init() {
            this.element.classList.add("fn__flex-column");
            ensureFlashcardV2(() => {
                const open = (reviewSetID?: string) => {
                    if (controller.signal.aborted) {
                        return;
                    }
                    this.data = normalizeFlashcardTabData(this.data, reviewSetID);
                    openFlashcardV2ReviewSession(options.app, "", this.data.title || window.siyuan.languages.riffCard,
                        this.data.review, {
                            element: this.element as HTMLElement,
                            signal: controller.signal,
                            close: () => this.tab.parent.removeTab(this.tab.id),
                        });
                };
                if (!this.data.review && this.data.cardType === "all" && this.data.id) {
                    const loadDeck = (offset: number) => {
                        if (controller.signal.aborted) {
                            return;
                        }
                        void fetchPost("/api/flashcard/listEntities", {
                            entityType: "reviewSet", options: {offset, limit: 1000},
                        }, (response) => {
                            if (controller.signal.aborted) {
                                return;
                            }
                            const sets = response.data.entities as Array<{entityID: string, payload: {legacyDeckID?: string}}>;
                            const set = sets.find((item) => item.payload.legacyDeckID === this.data.id || item.entityID === this.data.id);
                            if (set) {
                                open(set.entityID);
                            } else if (sets.length === 1000) {
                                loadDeck(offset + sets.length);
                            } else {
                                showMessage(window.siyuan.languages.emptyContent);
                            }
                        });
                    };
                    loadDeck(0);
                } else {
                    open();
                }
            });
        },
        destroy() {
            controller.abort();
        },
        resize() {
        },
        update() {
        },
    });
    customObj.element.addEventListener("click", () => {
        clearOBG();
        setPanelFocus(customObj.element.parentElement.parentElement);
    });
    return customObj;
};
