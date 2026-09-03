export class MobileOpenedFileSelection {
    private request = 0;

    public cancel() {
        this.request++;
    }

    public async resolve<T>(load: () => Promise<T>, isCurrent: () => boolean): Promise<T | undefined> {
        const request = ++this.request;
        const result = await load();
        if (request !== this.request || !isCurrent()) {
            return;
        }
        return result;
    }
}
