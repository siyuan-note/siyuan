export type TDynamicLoadMode = 1 | 2;

export interface IDynamicLoadRequest {
    readonly token: number;
    readonly rootID: string;
    readonly anchorID: string;
    readonly mode: TDynamicLoadMode;
}

export class DynamicLoadState {
    private activeRequest?: IDynamicLoadRequest;
    private token = 0;

    public begin(rootID: string, anchorID: string, mode: TDynamicLoadMode) {
        if (this.activeRequest) {
            return undefined;
        }
        this.activeRequest = {
            token: ++this.token,
            rootID,
            anchorID,
            mode,
        };
        return this.activeRequest;
    }

    public isCurrent(request: IDynamicLoadRequest, rootID?: string, anchorID?: string | null) {
        return this.activeRequest === request && request.rootID === rootID && request.anchorID === anchorID;
    }

    public finish(request: IDynamicLoadRequest) {
        if (this.activeRequest !== request) {
            return false;
        }
        this.activeRequest = undefined;
        return true;
    }

    public invalidate() {
        const request = this.activeRequest;
        this.activeRequest = undefined;
        return request;
    }
}
