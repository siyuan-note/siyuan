interface IQueueCard {
    card: {id: string, generationStatus: string};
    sessionCard: {status: string};
    repeatDue?: number;
}

// 只在切换卡片时选择已到期的重学卡，保留普通卡片的原始顺序。
export const selectFlashcardV2Queue = (queue: IQueueCard[], now: number) => {
    let index = -1;
    let nextDue = 0;
    queue.forEach((item, position) => {
        if (item.card.generationStatus !== "active" || item.sessionCard.status !== "reviewed" || !item.repeatDue) {
            return;
        }
        if (item.repeatDue <= now) {
            if (index < 0 || item.repeatDue < queue[index].repeatDue) {
                index = position;
            }
        } else if (!nextDue || item.repeatDue < nextDue) {
            nextDue = item.repeatDue;
        }
    });
    if (index < 0) {
        index = queue.findIndex((item) => item.card.generationStatus === "active" &&
            (item.sessionCard.status === "queued" || item.sessionCard.status === "shown"));
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
