import {fetchPost} from "../util/fetch";

export const flashcard = {
    element: undefined as Element,
    genHTML: () => {
        return `<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        dailyNewCardLimit
        <div class="b3-label__text">dailyNewCardLimitdailyNewCardLimit</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center" id="dailyNewCardLimit" step="1" min="1" type="number"${window.siyuan.config.flashcard.dailyNewCardLimit ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        dailyReviewCardLimit
        <div class="b3-label__text">dailyReviewCardLimitdailyReviewCardLimit</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field fn__flex-center" id="dailyReviewCardLimit" step="1" min="1" type="number"${window.siyuan.config.flashcard.dailyReviewCardLimit ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        list
        <div class="b3-label__text">listlist</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="list" type="checkbox"${window.siyuan.config.flashcard.list ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        superBlock
        <div class="b3-label__text">superBlocksuperBlock</div>
    </div>
    <span class="fn__space"></span>
    <input class="b3-switch fn__flex-center" id="superBlock" type="checkbox"${window.siyuan.config.flashcard.superBlock ? " checked" : ""}/>
</label>
<label class="fn__flex b3-label">
    <div class="fn__flex-1">
        deck
        <div class="b3-label__text">deckdeck</div>
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
