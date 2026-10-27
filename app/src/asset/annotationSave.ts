// Each viewer advances its own baseline only after a confirmed save. The server
// merges changes to other annotations; serializing saves preserves local order.
export class AnnotationSaveQueue {
    private pending = Promise.resolve();
    private failed = false;
    private failureMessage = "";

    constructor(private baseData: string,
                private persist: (baseData: string, data: string) => Promise<{code: number; msg: string}>,
                private reportFailure: (message: string) => void) {
    }

    save(data: string): Promise<void> {
        if (this.failed) {
            this.reportFailure(this.failureMessage);
            return Promise.resolve();
        }
        this.pending = this.pending.then(async () => {
            if (this.failed) {
                return;
            }
            const response = await this.persist(this.baseData, data);
            if (response.code !== 0) {
                throw new Error(response.msg);
            }
            this.baseData = data;
        }).catch(error => {
            this.failed = true;
            this.failureMessage = error.message;
            this.reportFailure(error.message);
        });
        return this.pending;
    }
}
