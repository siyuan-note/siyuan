// 失败重试保留同一操作身份，内容改变后才创建新操作。
export class MemoryOperationState {
    private operation = "";
    private draft = "";

    operationFor(draft: string, create: () => string) {
        if (!this.operation || this.draft !== draft) {
            this.operation = create();
            this.draft = draft;
        }
        return this.operation;
    }

    committed() {
        this.operation = "";
        this.draft = "";
    }
}

export const memoryModelOptions = (providers: Array<{
    enabled: boolean;
    displayName?: string;
    models: Array<{id: string; enabled: boolean; name: string; displayName?: string}>;
}>, selected: string) => {
    const result = providers.filter(provider => provider.enabled).flatMap(provider =>
        provider.models.filter(model => model.enabled).map(model => ({
            id: model.id,
            label: [provider.displayName, model.displayName || model.name].filter(Boolean).join(" / "),
            unavailable: false,
        })));
    if (selected && !result.some(model => model.id === selected)) {
        result.unshift({id: selected, label: selected, unavailable: true});
    }
    return result;
};
