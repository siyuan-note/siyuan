import {fetchPost} from "../util/fetch";

export const flashcard = {
    element: undefined as Element,
    genHTML: () => {
        return `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.flashcardDailyNewCardLimit}
        <div class="b3-label__text">${window.siyuan.languages.flashcardDailyNewCardLimitTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center" id="dailyNewCardLimit" step="1" min="1" type="number"${window.siyuan.config.flashcard.dailyNewCardLimit ? " checked" : "" } value="${window.siyuan.config.flashcard.dailyNewCardLimit}"/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.flashcardDailyReviewCardLimit}
        <div class="b3-label__text">${window.siyuan.languages.flashcardDailyReviewCardLimitTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center" id="dailyReviewCardLimit" step="1" min="1" type="number"${window.siyuan.config.flashcard.dailyReviewCardLimit ? " checked" : ""} value="${window.siyuan.config.flashcard.dailyReviewCardLimit}"/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.flashcardList}
        <div class="b3-label__text">${window.siyuan.languages.flashcardListTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="list" type="checkbox"${window.siyuan.config.flashcard.list ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.flashcardSuperBlock}
        <div class="b3-label__text">${window.siyuan.languages.flashcardSuperBlockTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="superBlock" type="checkbox"${window.siyuan.config.flashcard.superBlock ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        ${window.siyuan.languages.flashcardDeck}
        <div class="b3-label__text">${window.siyuan.languages.flashcardDeckTip}</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="deck" type="checkbox"${window.siyuan.config.flashcard.deck ? " checked" : ""}/>
</label>`;
    },
    bindEvent: () => {
        flashcard.element.querySelectorAll("input").forEach((item) => {
            item.addEventListener("change", () => {
                fetchPost("/api/setting/setFlashcard", {
                    dailyNewCardLimit: parseInt((flashcard.element.querySelector("#dailyNewCardLimit") as HTMLInputElement).value),
                    dailyReviewCardLimit: parseInt((flashcard.element.querySelector("#dailyReviewCardLimit") as HTMLInputElement).value),
                    list: (flashcard.element.querySelector("#list") as HTMLInputElement).checked,
                    superBlock: (flashcard.element.querySelector("#superBlock") as HTMLInputElement).checked,
                    deck: (flashcard.element.querySelector("#deck") as HTMLInputElement).checked,
                }, response => {
                    window.siyuan.config.flashcard = response.data;
                });
            });
        });
    },
};
