import {genUUID} from "../util/genID";
import type {IFlashcardV2TagAssignmentGroup} from "./flashcardV2State";

// 同一提交计划保留操作身份和已确认进度；用户修改选择后开始新的计划。
export class FlashcardV2TagSave {
    private signature = "";
    private next = 0;
    private operations: Array<{operationID: string, changedAt: number}> = [];
    private pending = false;
    private closed = false;

    close() {
        this.closed = true;
    }

    async run(groups: IFlashcardV2TagAssignmentGroup[],
        save: (group: IFlashcardV2TagAssignmentGroup, operation: {operationID: string, changedAt: number}) => Promise<boolean>) {
        if (this.pending || this.closed) {
            return false;
        }
        this.pending = true;
        const signature = JSON.stringify(groups);
        if (signature !== this.signature) {
            this.signature = signature;
            this.next = 0;
            this.operations = groups.map(() => ({operationID: genUUID(), changedAt: Date.now()}));
        }
        try {
            while (this.next < groups.length) {
                if (this.closed || !await save(groups[this.next], this.operations[this.next])) {
                    return false;
                }
                this.next++;
            }
            return !this.closed;
        } finally {
            this.pending = false;
        }
    }
}
