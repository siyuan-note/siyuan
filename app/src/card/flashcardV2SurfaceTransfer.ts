import type {IFlashcardSessionMount} from "./flashcardV2Session";

const transfers = new Map<string, (mount: IFlashcardSessionMount) => boolean>();

export const registerFlashcardSurfaceTransfer = (id: string, attach: (mount: IFlashcardSessionMount) => boolean) => {
    transfers.set(id, attach);
    return () => transfers.delete(id);
};

export const takeFlashcardSurfaceTransfer = (id: string) => {
    const attach = transfers.get(id);
    transfers.delete(id);
    return attach;
};
