import {fetchPost} from "../util/fetch";
import type {APICallbackResponse, APIPOSTRoutes, RiffReviewedCardInput} from "../types/api";

type DueCardsResponse = APICallbackResponse<APIPOSTRoutes["/api/riff/getRiffDueCards"]["response"]>;

export const fetchDueCards = (cardType: string, id: string, reviewedCards: RiffReviewedCardInput[] | undefined,
                             callback: (response: DueCardsResponse) => void) => {
    if (cardType === "all") {
        return fetchPost("/api/riff/getRiffDueCards", {deckID: id, reviewedCards}, callback);
    }
    if (cardType === "doc") {
        return fetchPost("/api/riff/getTreeRiffDueCards", {rootID: id, reviewedCards}, callback);
    }
    return fetchPost("/api/riff/getNotebookRiffDueCards", {notebook: id, reviewedCards}, callback);
};
