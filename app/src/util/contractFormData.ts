import type {APIFormData} from "../types/api";

// 从类型化字段构造上传表单，保留文件名和可缺省字段。
export class ContractFormData<Request extends Record<string, string | Blob | Array<string | Blob> | undefined>> extends FormData implements APIFormData<Request> {
    public readonly apiRequest: Request;

    constructor(request: Request) {
        super();
        this.apiRequest = request;
        Object.entries(request).forEach(([name, value]) => {
            if (Array.isArray(value)) {
                value.forEach(item => this.append(name, item));
            } else if (value !== undefined) {
                this.append(name, value);
            }
        });
    }
}
