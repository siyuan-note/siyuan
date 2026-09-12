package apicontract

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func quote(value string) string { data, _ := json.Marshal(value); return string(data) }

func (b *Bundle) typeScript(schema *Schema) string {
	if schema.Ref != "" {
		return strings.TrimPrefix(schema.Ref, "#/$defs/")
	}
	if len(schema.Enum) > 0 {
		var values []string
		for _, value := range schema.Enum {
			data, _ := json.Marshal(value)
			values = append(values, string(data))
		}
		return strings.Join(values, " | ")
	}
	if len(schema.AnyOf) > 0 {
		var variants []string
		// 联合成员缺少的字段标记为可选 never，保留精确的属性存在性和判别能力。
		allProperties := map[string]bool{}
		objects := make([]*Schema, len(schema.AnyOf))
		allObjects := true
		for i, option := range schema.AnyOf {
			target := option
			if option.Ref != "" {
				target = b.Definitions[strings.TrimPrefix(option.Ref, "#/$defs/")]
			}
			if target == nil || target.Type != "object" {
				allObjects = false
				break
			}
			objects[i] = target
			for key := range target.Properties {
				allProperties[key] = true
			}
		}
		for i, option := range schema.AnyOf {
			variant := b.typeScript(option)
			if allObjects {
				var absent []string
				for _, key := range sortedKeys(allProperties) {
					if _, exists := objects[i].Properties[key]; !exists {
						absent = append(absent, quote(key)+"?: never;")
					}
				}
				if len(absent) > 0 {
					variant = "(" + variant + " & { " + strings.Join(absent, " ") + " })"
				}
			}
			variants = append(variants, variant)
		}
		return strings.Join(variants, " | ")
	}
	switch schema.Type {
	case "integer", "number":
		return "number"
	case "null", "string", "boolean":
		return schema.Type
	case "array":
		return "Array<" + b.typeScript(schema.Items) + ">"
	case "object":
		if additional, ok := schema.AdditionalProperties.(*Schema); ok {
			return "Record<string, " + b.typeScript(additional) + ">"
		}
		if len(schema.Properties) == 0 {
			return "Record<string, never>"
		}
		required := map[string]bool{}
		for _, key := range schema.Required {
			required[key] = true
		}
		var fields []string
		for _, key := range sortedKeys(schema.Properties) {
			optional := ""
			if !required[key] {
				optional = "?"
			}
			fields = append(fields, quote(key)+optional+": "+b.typeScript(schema.Properties[key])+";")
		}
		return "{ " + strings.Join(fields, " ") + " }"
	default:
		panic("unsupported TypeScript schema: " + schema.Type)
	}
}

func (b *Bundle) TypeScript(legacy []Route) []byte {
	var output strings.Builder
	output.WriteString("// 此文件由内核契约生成，请运行 pnpm run api:generate 更新。\n\n")
	for _, name := range sortedKeys(b.Definitions) {
		fmt.Fprintf(&output, "export type %s = %s;\n\n", name, b.typeScript(b.Definitions[name]))
	}
	for _, method := range []string{"GET", "POST"} {
		legacyPaths := map[string]bool{}
		for _, route := range legacy {
			if route.Method == method || route.Method == "ANY" {
				legacyPaths[route.Path] = true
			}
		}
		fmt.Fprintf(&output, "export type APILegacy%sPath =\n", method)
		for i, path := range sortedKeys(legacyPaths) {
			separator := " |"
			if i == len(legacyPaths)-1 {
				separator = ";"
			}
			fmt.Fprintf(&output, "    %s%s\n", quote(path), separator)
		}
		if len(legacyPaths) == 0 {
			output.WriteString("    never;\n")
		}
		output.WriteString("\n")
		fmt.Fprintf(&output, "export interface API%sRoutes {\n", method)
		for _, endpoint := range b.Endpoints {
			if endpoint.Method != method {
				continue
			}
			fmt.Fprintf(&output, "    %s: {\n        request: %s;\n        response: %s;\n        body: %s;\n    };\n",
				quote(endpoint.Path), b.typeScript(endpoint.Request), b.typeScript(endpoint.Response), quote(string(endpoint.Body)))
		}
		output.WriteString("}\n\n")
	}
	output.WriteString(fetchDeclarations)
	return []byte(output.String())
}

const fetchDeclarations = `// 传输层合成的错误独立于业务错误；普通回调只接收消息处理后保留的非负错误码。
export interface APITransportError {
    code: -401 | -403 | -404;
    msg: string;
    data: null;
}

export interface APIFetchFailure {
    code: number;
    msg: string;
    data: null;
}

export interface APILegacyResponse {
    code: number;
    msg: string;
    data?: any;
    cmd?: string;
    callback?: string;
    sid?: string;
    context?: any;
}

type APIContract = {request: unknown; response: unknown; body: string};
type APIRequestArgs<C extends APIContract> = C["body"] extends "json"
    ? [data: C["request"]]
    : [data?: C["request"] | null];
type NonNegative<C extends number> = C extends C ? ` + "`${C}` extends `-${string}`" + ` ? never : C : never;
export type APICallbackResponse<R> = R extends {code: infer C extends number}
    ? NonNegative<C> extends never ? never : R & {code: NonNegative<C>}
    : never;

type APIPostTail<C extends APIContract> = [
    cb?: (response: APICallbackResponse<C["response"]>) => void,
    headers?: Record<string, string>,
    failCallback?: (response: APIFetchFailure) => void,
    signal?: AbortSignal,
    timeout?: number
];
type LegacyPostArgs<Legacy> = [
    data?: any,
    cb?: (response: Legacy) => void,
    headers?: Record<string, string>,
    failCallback?: (response: Legacy) => void,
    signal?: AbortSignal,
    timeout?: number
];
type APISyncTail = [headers?: Record<string, string>, process?: boolean, signal?: AbortSignal];

// 路径只从首参推导，已知路径不能因请求参数不匹配而选择宽松重载。
export type FetchPost<Legacy = APILegacyResponse> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIPOSTRoutes
        ? [...APIRequestArgs<APIPOSTRoutes[Path]>, ...APIPostTail<APIPOSTRoutes[Path]>]
        : Path extends APILegacyPOSTPath ? LegacyPostArgs<Legacy>
        : string extends Path ? LegacyPostArgs<Legacy> : never
) => Promise<void>;

export type FetchSyncPost<Legacy = APILegacyResponse> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIPOSTRoutes
        ? [...APIRequestArgs<APIPOSTRoutes[Path]>, ...APISyncTail]
        : Path extends APILegacyPOSTPath ? [data?: any, ...tail: APISyncTail]
        : string extends Path ? [data?: any, ...tail: APISyncTail] : never
) => Promise<Path extends keyof APIPOSTRoutes ? APIPOSTRoutes[Path]["response"] | APITransportError : Legacy>;

export type FetchGet<Legacy = APILegacyResponse | string> = <Path extends string>(
    url: Path,
    ...args: Path extends keyof APIGETRoutes
        ? [cb: (response: APIGETRoutes[Path]["response"]) => void]
        : Path extends keyof APIPOSTRoutes ? never
        : [cb: (response: Legacy) => void]
) => void;
`
