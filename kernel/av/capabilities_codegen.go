package av

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// CapabilityTypeScript 生成运行时能力数据与前端、插件共用的类型声明。
// 生成数据仅供类型分派使用，不写入文档、属性视图或加密信封。
func CapabilityTypeScript() (runtime, declarations []byte) {
	var source, types strings.Builder
	header := "// 此文件由内核字段能力声明生成，请运行 pnpm run api:generate 更新。\n\n"
	source.WriteString(header)
	source.WriteString("import type {AVKeyType, AVKeyCapability} from \"../../../types/av\";\n\n")
	keys := KeyTypes()
	keyNames := make([]string, len(keys))
	for i, key := range keys {
		keyNames[i] = string(key)
	}
	keyJSON, _ := json.Marshal(keyNames)
	fmt.Fprintf(&source, "export const AV_KEY_TYPES: readonly AVKeyType[] = %s;\n\n", keyJSON)
	source.WriteString("export const AV_KEY_CAPABILITIES: Readonly<Record<AVKeyType, AVKeyCapability>> = {\n")
	for _, key := range keys {
		data, _ := json.Marshal(keyCapabilities[key])
		fmt.Fprintf(&source, "    %q: %s,\n", key, data)
	}
	source.WriteString("};\n")
	types.WriteString(header)
	var keyLiterals, operatorLiterals []string
	kinds := map[string]bool{}
	for _, name := range keyNames {
		keyLiterals = append(keyLiterals, fmt.Sprintf("%q", name))
		kinds[keyCapabilities[KeyType(name)].ValueKind] = true
	}
	for _, operator := range filterOperators {
		operatorLiterals = append(operatorLiterals, fmt.Sprintf("%q", operator))
	}
	fmt.Fprintf(&types, "export type AVKeyType = %s;\n", strings.Join(keyLiterals, " | "))
	fmt.Fprintf(&types, "export type AVFilterOperator = %s;\n\n", strings.Join(operatorLiterals, " | "))
	types.WriteString("/** 字段基础能力仅用于类型分派，不属于 AV 持久化格式 */\nexport interface AVKeyCapability {\n")
	var kindLiterals []string
	for kind := range kinds {
		kindLiterals = append(kindLiterals, fmt.Sprintf("%q", kind))
	}
	sort.Strings(kindLiterals)
	fmt.Fprintf(&types, "    readonly valueKind: %s;\n", strings.Join(kindLiterals, " | "))
	types.WriteString("    readonly editable: boolean;\n    readonly filterable: boolean;\n    readonly sortable: boolean;\n")
	types.WriteString("    /** 资源字段分组还需要显示模板 */\n    readonly groupable: boolean;\n")
	types.WriteString("    /** 行号为空，关联的汇总取值使用 Contains */\n    readonly defaultOperator: AVFilterOperator | \"\";\n}\n")
	return []byte(source.String()), []byte(types.String())
}
