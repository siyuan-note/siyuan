export type OrderedStateStep = {id: string, text: string};
export type OrderedStateLoaded = {
    steps: OrderedStateStep[], revisionID: string, contentFingerprint: string,
};
export type OrderedStateRequest = {
    sourceID: string, expectedRevisionID: string, orderedStepIDs: string[], contentFingerprint: string,
    operationID: string, updatedAt: number,
};

// 排序草稿只持有快照与稳定身份，不执行网络请求或正文修改。
export class FlashcardV2OrderedState {
    private generation = 0;
    private phase: "idle" | "load" | "save" = "idle";
    private ended = false;
    private currentSteps: OrderedStateStep[] = [];
    private originalIDs: string[] = [];
    private revision = "";
    private fingerprint = "";
    private plan: {signature: string, request: OrderedStateRequest};

    constructor(private readonly sourceID: string,
                private readonly makeOperation: () => {operationID: string, updatedAt: number}) {}

    public get steps(): OrderedStateStep[] { return this.currentSteps.map(step => ({...step})); }
    public get revisionID() { return this.revision; }
    public get contentFingerprint() { return this.fingerprint; }
    public get closed() { return this.ended; }
    public get busy() { return this.phase !== "idle"; }
    public get dirty() {
        return this.currentSteps.length > 0 &&
            this.currentSteps.some((step, index) => step.id !== this.originalIDs[index]);
    }

    public beginLoad(): number | undefined {
        if (this.ended || this.phase === "save") { return; }
        this.phase = "load";
        return ++this.generation;
    }

    public completeLoad(token: number, loaded: OrderedStateLoaded): boolean {
        if (!this.matches(token, "load")) { return false; }
        if (!loaded.revisionID || !loaded.contentFingerprint || !loaded.steps.length || loaded.steps.length > 1000 ||
            loaded.steps.some(step => !step.id || !step.text.trim()) ||
            new Set(loaded.steps.map(step => step.id)).size !== loaded.steps.length) {
            this.phase = "idle";
            return false;
        }
        this.currentSteps = loaded.steps.map(step => ({...step}));
        this.originalIDs = loaded.steps.map(step => step.id);
        this.revision = loaded.revisionID;
        this.fingerprint = loaded.contentFingerprint;
        this.plan = undefined;
        this.phase = "idle";
        return true;
    }

    public failLoad(token: number): boolean {
        if (!this.matches(token, "load")) { return false; }
        this.phase = "idle";
        return true;
    }

    public move(id: string, delta: -1 | 1): boolean {
        if (this.ended || this.busy || (delta !== -1 && delta !== 1)) { return false; }
        const index = this.currentSteps.findIndex(step => step.id === id);
        const next = index + delta;
        if (index < 0 || next < 0 || next >= this.currentSteps.length) { return false; }
        [this.currentSteps[index], this.currentSteps[next]] = [this.currentSteps[next], this.currentSteps[index]];
        // 草稿修改即开启新计划，不能误重放已经改变过的未知结果请求。
        this.plan = undefined;
        return true;
    }

    public beginSave(): {token: number, request: OrderedStateRequest} | undefined {
        if (this.ended || this.busy || !this.dirty || !this.revision || !this.fingerprint || !this.sourceID) { return; }
        const input = {sourceID: this.sourceID, expectedRevisionID: this.revision,
            orderedStepIDs: this.currentSteps.map(step => step.id), contentFingerprint: this.fingerprint};
        const signature = JSON.stringify(input);
        if (this.plan?.signature !== signature) {
            this.plan = {signature, request: {...input, ...this.makeOperation()}};
        }
        this.phase = "save";
        return {token: ++this.generation, request: {...this.plan.request, orderedStepIDs: [...this.plan.request.orderedStepIDs]}};
    }

    public completeSave(token: number, success: boolean): boolean {
        if (!this.matches(token, "save")) { return false; }
        this.phase = "idle";
        if (success) {
            this.originalIDs = this.currentSteps.map(step => step.id);
            this.plan = undefined;
        }
        return true;
    }

    public close() {
        this.ended = true;
        this.generation++;
        this.phase = "idle";
    }

    private matches(token: number, phase: "load" | "save") {
        return !this.ended && this.generation === token && this.phase === phase;
    }
}
