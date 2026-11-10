import {fetchPost, fetchSyncPost} from "../util/fetch";
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

export const fetchDueCardsSync = (cardType: string, id: string, reviewedCards: RiffReviewedCardInput[] | undefined) => {
    if (cardType === "all") return fetchSyncPost("/api/riff/getRiffDueCards", {deckID: id, reviewedCards});
    if (cardType === "doc") return fetchSyncPost("/api/riff/getTreeRiffDueCards", {rootID: id, reviewedCards});
    return fetchSyncPost("/api/riff/getNotebookRiffDueCards", {notebook: id, reviewedCards});
};
