import type {IFlashcardV2EditLater} from "./flashcardV2EditLater";

interface IQueueCard {
    card: {id: string, generationStatus: string, editLater?: IFlashcardV2EditLater};
    sessionCard: {status: string};
    repeatDue?: number;
}

const isQueueCardReady = (item: IQueueCard, now: number) => item.card.generationStatus === "active" &&
    !item.card.editLater && (item.sessionCard.status === "queued" || item.sessionCard.status === "shown" ||
        item.sessionCard.status === "reviewed" && !!item.repeatDue && item.repeatDue <= now);

// 保留队列索引供撤销使用，稍后再学只记录本轮的出场顺序。
export const deferFlashcardV2QueueCard = (queue: IQueueCard[], index: number, now: number, deferred: string[]) => {
    if (!queue[index] || !isQueueCardReady(queue[index], now) ||
        !queue.some((item, position) => position !== index && isQueueCardReady(item, now))) {
        return false;
    }
    const cardID = queue[index].card.id;
    const previous = deferred.indexOf(cardID);
    if (previous >= 0) {
        deferred.splice(previous, 1);
    }
    deferred.push(cardID);
    return true;
};

// 只在切换卡片时选择已到期的重学卡，保留普通卡片的原始顺序。
export const selectFlashcardV2Queue = (queue: IQueueCard[], now: number, deferred: readonly string[] = []) => {
    const deferredIDs = new Set(deferred);
    let index = -1;
    let nextDue = 0;
    queue.forEach((item, position) => {
        if (item.card.generationStatus !== "active" || item.card.editLater ||
            item.sessionCard.status !== "reviewed" || !item.repeatDue) {
            return;
        }
        if (item.repeatDue <= now) {
            if (deferredIDs.has(item.card.id)) {
                return;
            }
            if (index < 0 || item.repeatDue < queue[index].repeatDue) {
                index = position;
            }
        } else if (!nextDue || item.repeatDue < nextDue) {
            nextDue = item.repeatDue;
        }
    });
    if (index < 0) {
        index = queue.findIndex((item) => item.card.generationStatus === "active" && !item.card.editLater &&
            !deferredIDs.has(item.card.id) &&
            (item.sessionCard.status === "queued" || item.sessionCard.status === "shown"));
    }
    if (index < 0) {
        for (const cardID of deferred) {
            index = queue.findIndex((item) => item.card.id === cardID && isQueueCardReady(item, now));
            if (index >= 0) {
                break;
            }
        }
    }
    return {index, nextDue};
};

// 刷新仅更新本次会话的成员，不把范围外的卡片加入队列。
export const refreshFlashcardV2Queue = <T extends IQueueCard>(queue: T[], refreshed: T[]) => {
    const byID = new Map(refreshed.map((item) => [item.card.id, item]));
    queue.forEach((item, index) => {
        const current = byID.get(item.card.id);
        if (current) {
            queue[index] = current;
        } else {
            item.sessionCard.status = "skipped";
            item.repeatDue = undefined;
        }
    });
};

export const flashcardV2QueueProgress = (queue: IQueueCard[]) =>
    `${queue.filter((item) => item.sessionCard.status === "reviewed" || item.sessionCard.status === "skipped").length} / ${queue.length}`;
