const reviewChanges = new EventTarget();

export const notifyFlashcardV2ReviewChange = (type: string) => {
    if (type === "flashcard-review-rating-completed" || type === "flashcard-review-undone" ||
        type === "flashcard-review-session-ended") {
        reviewChanges.dispatchEvent(new Event("change"));
    }
};

export const onFlashcardV2ReviewChange = (listener: () => void, signal: AbortSignal) => {
    reviewChanges.addEventListener("change", listener, {signal});
};
