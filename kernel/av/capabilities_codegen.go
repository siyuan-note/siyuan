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
	source.WriteString("import type {AVKeyType, AVKeyCapability, AVFilterProfile, AVFilterCapability, AVCalcOperator} from \"../../../types/av\";\n\n")
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
	var profileNames []string
	for profile := range filterCapabilities {
		profileNames = append(profileNames, string(profile))
	}
	sort.Strings(profileNames)
	source.WriteString("\nexport const AV_FILTER_CAPABILITIES: Readonly<Record<AVFilterProfile, AVFilterCapability>> = {\n")
	for _, profile := range profileNames {
		data, _ := json.Marshal(filterCapabilities[FilterProfile(profile)])
		fmt.Fprintf(&source, "    %q: %s,\n", profile, data)
	}
	source.WriteString("};\n")
	var calcNames, numberCalcNames []string
	for operator, number := range calcFilterNumber {
		calcNames = append(calcNames, string(operator))
		if number {
			numberCalcNames = append(numberCalcNames, string(operator))
		}
	}
	sort.Strings(calcNames)
	sort.Strings(numberCalcNames)
	calcJSON, _ := json.Marshal(numberCalcNames)
	fmt.Fprintf(&source, "\nexport const AV_CALC_FILTER_NUMBER_OPERATORS: readonly AVCalcOperator[] = %s;\n", calcJSON)
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
	var groupLiterals, profileLiterals, calcLiterals []string
	for _, group := range keyGroups {
		groupLiterals = append(groupLiterals, fmt.Sprintf("%q", group.name))
	}
	for _, profile := range profileNames {
		profileLiterals = append(profileLiterals, fmt.Sprintf("%q", profile))
	}
	for _, operator := range calcNames {
		calcLiterals = append(calcLiterals, fmt.Sprintf("%q", operator))
	}
	fmt.Fprintf(&types, "export type AVKeyGroup = %s;\n", strings.Join(groupLiterals, " | "))
	fmt.Fprintf(&types, "export type AVFilterProfile = %s;\n", strings.Join(profileLiterals, " | "))
	fmt.Fprintf(&types, "export type AVCalcOperator = %s;\n\n", strings.Join(calcLiterals, " | "))
	types.WriteString("/** 接受集合与界面呈现集合独立，呈现集合保留选项顺序 */\nexport interface AVFilterCapability {\n")
	types.WriteString("    readonly accepted: readonly AVFilterOperator[];\n    readonly offered: readonly AVFilterOperator[];\n")
	types.WriteString("    readonly offeredRollup?: readonly AVFilterOperator[];\n}\n\n")
	types.WriteString("/** 字段基础能力仅用于类型分派，不属于 AV 持久化格式 */\nexport interface AVKeyCapability {\n")
	types.WriteString("    /** 派生用途由内核声明，none 表示明确不属于任何用途分组 */\n    readonly groups?: readonly AVKeyGroup[];\n")
	types.WriteString("    /** 用于选择接受与呈现的算子集合，保留旧调用方构造基础能力对象的兼容性 */\n    readonly filterProfile?: AVFilterProfile;\n")
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
