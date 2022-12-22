import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {isMobile} from "../util/functions";

export const openCard = () => {
    let decksHTML = '<option value="">All</option>';
    fetchPost("/api/riff/getRiffDecks", {}, (response) => {
        response.data.forEach((deck:{id:string, name:string}) => {
            decksHTML += `<option value="${deck.id}">${deck.name}</option>`;
        })
        fetchPost("/api/riff/getRiffDueCards", {deckID:""}, (cardsResponse) => {
            const dialog = new Dialog({
                title: window.siyuan.languages.riffCard,
                content:`<div class="fn__flex-column">
    <div class="fn__flex">
        <select class="b3-select">${decksHTML}</select>
        <span class="fn__space"></span>
        <div>${cardsResponse.data}</div>
    </div>
    <div class="fn__flex-1" data-type="render"></div>
    <div class="fn__flex">
        <button class="b3-button">Again Rating</button>
        <span class="fn__flex-1"></span>
        <button class="b3-button">Hard</button>
        <span class="fn__flex-1"></span>
        <button class="b3-button">Good</button>
        <span class="fn__flex-1"></span>
        <button class="b3-button">Easy</button>
    </div>
</div>`,
                width: isMobile() ? "80vw" : "50vw",
                height: "70vh",
            })
            dialog.element.setAttribute("data-key", window.siyuan.config.keymap.general.riffCard.custom)
            dialog.element.querySelector("select").addEventListener("change", (event) => {

            })
        })
    })
}

export const matchCardKey = (event: KeyboardEvent) => {

}
