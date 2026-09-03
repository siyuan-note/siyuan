const flashcardLocateBlockAttribute = "data-flashcard-locate-block-id";

type TFlashcardLocateElement = Pick<Element, "getAttribute" | "setAttribute" | "removeAttribute">;

export const setFlashcardLocateBlockID = (element: TFlashcardLocateElement, blockID?: string) => {
    if (blockID) {
        element.setAttribute(flashcardLocateBlockAttribute, blockID);
    } else {
        element.removeAttribute(flashcardLocateBlockAttribute);
    }
};

export const getFlashcardLocateBlockID = (element: TFlashcardLocateElement) =>
    element.getAttribute(flashcardLocateBlockAttribute) || "";

export const isCurrentFlashcardLocateTarget = (requestedElement: TFlashcardLocateElement,
    requestedBlockID: string, currentElement?: TFlashcardLocateElement) =>
    requestedElement === currentElement && getFlashcardLocateBlockID(requestedElement) === requestedBlockID;
