import {isMobileLandscape} from "../mobile/util/orientation";

export const updateCardHV = () => {
    /// #if MOBILE
    if (!isMobileLandscape()) {
        document.querySelectorAll(".card__action .card__icon").forEach(item => {
            item.classList.remove("fn__none");
        });
    } else {
        document.querySelectorAll(".card__action .card__icon").forEach(item => {
            item.classList.add("fn__none");
        });
    }
    /// #endif
};
