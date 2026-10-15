package av

import "encoding/json"

// KeyGroup 区分字段在各处理阶段的用途，不能把不同的生成值阶段统一当作只读字段。
type KeyGroup uint32

const (
	KeyGroupNone KeyGroup = 1 << iota
	KeyGroupRichText
	KeyGroupLink
	KeyGroupScalarContent
	KeyGroupAttributePlaceholder
	KeyGroupRollupCell
	KeyGroupNewItemTemplate
	KeyGroupNoFilterDefault
	KeyGroupRenderDependentFilter
	KeyGroupSkipRowCopy
	KeyGroupRenderAutoFill
	KeyGroupRollupAlwaysRender
	KeyGroupRollupForeignRender
)

var keyGroups = []struct {
	flag KeyGroup
	name string
}{
	{KeyGroupNone, "none"},
	{KeyGroupRichText, "richText"},
	{KeyGroupLink, "link"},
	{KeyGroupScalarContent, "scalarContent"},
	{KeyGroupAttributePlaceholder, "attributePlaceholder"},
	{KeyGroupRollupCell, "rollupCell"},
	{KeyGroupNewItemTemplate, "newItemTemplate"},
	{KeyGroupNoFilterDefault, "noFilterDefault"},
	{KeyGroupRenderDependentFilter, "renderDependentFilter"},
	{KeyGroupSkipRowCopy, "skipRowCopy"},
	{KeyGroupRenderAutoFill, "renderAutoFill"},
	{KeyGroupRollupAlwaysRender, "rollupAlwaysRender"},
	{KeyGroupRollupForeignRender, "rollupForeignRender"},
}

func (g KeyGroup) MarshalJSON() ([]byte, error) {
	names := []string{}
	for _, group := range keyGroups {
		if g&group.flag != 0 {
			names = append(names, group.name)
		}
	}
	return json.Marshal(names)
}

// HasKeyGroup 只读取字段能力声明，未知类型不归入任何用途分组。
func HasKeyGroup(typ KeyType, group KeyGroup) bool {
	return GetKeyCapability(typ).Groups&group != 0
}

func IsKnownKeyType(typ KeyType) bool {
	_, found := keyCapabilities[typ]
	return found
}

// NeedsRollupTargetRender 保留同库与跨库汇总在模板、时间和关联字段上的不同渲染要求。
func NeedsRollupTargetRender(typ KeyType, sameAV bool) bool {
	return HasKeyGroup(typ, KeyGroupRollupAlwaysRender) || !sameAV && HasKeyGroup(typ, KeyGroupRollupForeignRender)
}

func DateKeyTypes() []KeyType {
	var result []KeyType
	for _, typ := range KeyTypes() {
		if IsDateKeyType(typ) {
			result = append(result, typ)
		}
	}
	return result
}
