import type {CreateDocByParentRequestInput, DocumentCreatePlan, DocumentPath} from "../types/api";

export type DocumentPlanResponse = {
    code: number;
    msg: string;
    data?: {id: string; document: DocumentPath} | {commitState: "none" | "committed" | "unknown"; id?: string} |
        {closeTimeout: number} | null;
};

/** 一个计划只保留一组 ID；后续处理失败或响应不明时不自动重放副作用。 */
export class DocumentCreationAttempt {
    public next = 0;
    public completed: string[] = [];
    public uncertainID: string;
    public failure: Error;
    public requiresReview = false;
    public running = false;

    constructor(public plan: DocumentCreatePlan) {}

    /** 用户确认后核对固定身份；已存在文档只跳过创建，不重放模板或排序。 */
    review(document?: DocumentPath) {
        if (this.running || !this.requiresReview) {
            return;
        }
        const step = this.plan.steps[this.next];
        if (!step) {
            throw new Error("Document creation plan is no longer available");
        }
        if (document) {
            const sameParent = document.parentID === step.parentID ||
                document.parentID === null && step.parentID === step.notebook;
            const sameTitle = step.title.text === "" ? document.title.empty :
                !document.title.empty && document.title.text === step.title.text;
            if (document.id !== step.id || document.notebook !== step.notebook || !sameParent || !sameTitle) {
                throw new Error("Document changed after creation; review the document before creating another");
            }
            if (!this.completed.includes(document.id)) {
                this.completed.push(document.id);
            }
            this.next++;
            const next = this.plan.steps[this.next];
            if (next?.parentID === document.id) {
                next.expectedParentRevision = document.revision;
            }
        } else if (this.completed.includes(step.id)) {
            throw new Error("The committed document is no longer available");
        }
        this.uncertainID = undefined;
        this.failure = undefined;
        this.requiresReview = false;
    }

    async execute(submit: (request: CreateDocByParentRequestInput) => Promise<DocumentPlanResponse>,
                  isValid = () => true): Promise<string | undefined> {
        if (this.running) {
            return;
        }
        if (this.requiresReview) {
            throw this.failure;
        }
        if (this.plan.existingID) {
            return isValid() ? this.plan.existingID : undefined;
        }
        this.running = true;
        try {
            while (this.next < this.plan.steps.length) {
                if (!isValid()) {
                    return;
                }
                const step = this.plan.steps[this.next];
                let response: DocumentPlanResponse;
                try {
                    response = await submit(step);
                } catch (error) {
                    this.uncertainID = step.id;
                    this.requiresReview = true;
                    throw error;
                }
                if (response.code !== 0 || !response.data || !("document" in response.data)) {
                    if (response.data && "commitState" in response.data) {
                        if (response.data.commitState === "committed" && response.data.id) {
                            this.completed.push(response.data.id);
                            this.requiresReview = true;
                        } else if (response.data.commitState === "unknown") {
                            this.uncertainID = step.id;
                            this.requiresReview = true;
                        }
                    }
                    throw new Error(response.msg);
                }
                this.completed.push(response.data.id);
                this.next++;
                const next = this.plan.steps[this.next];
                if (next?.parentID === response.data.id) {
                    next.expectedParentRevision = response.data.document.revision;
                }
            }
            return this.completed[this.completed.length - 1];
        } catch (error) {
            this.failure = error instanceof Error ? error : new Error(String(error));
            throw this.failure;
        } finally {
            this.running = false;
        }
    }
}
