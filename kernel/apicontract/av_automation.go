package apicontract

// AVAutomationConfig 通过 setAttrViewAutomations 事务操作整体保存，所有镜像和视图共享。
// spec 为 1；缺省配置不会触发自动化。普通条目新增、字段编辑及对应 API 会触发启用的规则，
// 导入、同步、历史恢复和撤销重放不会再次触发，自动化之间不串联。
// 自动操作与源修改一同提交、失败回滚及撤销；单笔事务最多产生 1000 个自动操作。
// 字段失效或目标数据库被删除时，后续条目写入会停用规则并保留配置，源修改仍可提交。
// 停用提示在提交后发送，包含规则名及失效引用；修复后需手动启用，撤销源修改不会重新启用规则。
// 跨库操作仅限同一加密边界，锁定、认证失败、损坏或实际写入失败仍使触发事务回滚。
type AVAutomationConfig struct {
	Spec  int                 `json:"spec" api:"const=1"`
	Rules []*AVAutomationRule `json:"rules"`
}

type AVAutomationRule struct {
	ID          string                   `json:"id"`
	Name        string                   `json:"name"`
	Enabled     bool                     `json:"enabled"`
	Trigger     string                   `json:"trigger" api:"enum=added|changed|block"`
	KeyID       string                   `json:"keyID,omitempty" api:"optional"`
	Conditions  []*AVViewFilter          `json:"conditions,omitempty" api:"optional"`
	Actions     []*AVAutomationAction    `json:"actions"`
	BlockSource *AVAutomationBlockSource `json:"blockSource,omitempty" api:"optional"`
}

// AVAutomationBlockSource 监听范围取笔记本与文档的并集，文档包含子文档；范围至少选择一项。
// 类型和标签分别取或、与关系，所有自定义属性条件取与关系。标签精确匹配，不递归匹配父容器。
// 列表项首段的标签默认归属列表项；显式选择段落类型时可匹配该段落。
// 仅从不匹配变为匹配时收集，原条目不会重置；失配时移出本功能创建的条目，保留源块。
// 其他启用的收集规则仍匹配时保留条目；停用或删除创建规则会保留既有条目。
// 再次匹配创建新条目并初始化字段，不恢复移出条目的字段；撤销重做仍恢复原事务快照。
// 配置变更、启用规则、导入、同步和历史恢复不补收存量内容，也不串联触发其他自动化。
type AVAutomationBlockSource struct {
	NotebookIDs []string                      `json:"notebookIDs,omitempty" api:"optional"`
	DocumentIDs []string                      `json:"documentIDs,omitempty" api:"optional"`
	Types       []string                      `json:"types,omitempty" api:"optional"`
	Tags        []string                      `json:"tags,omitempty" api:"optional"`
	Attributes  []*AVAutomationBlockAttribute `json:"attributes,omitempty" api:"optional"`
}

type AVAutomationBlockAttribute struct {
	Name     string `json:"name"`
	Operator string `json:"operator" api:"enum=equals|contains|exists|notExists"`
	Value    string `json:"value,omitempty" api:"optional"`
}

// AVAutomationAction 的 current 指触发条目所在数据库，related 通过源关联字段选择条目，
// filtered 在 avID 指定的数据库中按 filters 选择条目；空 filters 匹配全部条目。
// add 创建游离条目，edit 修改选中的条目；主键操作只修改文本并保留已有绑定。
// collect 仅用于 block 触发器，target 必须为 current，fields 可为空，仅支持固定值和触发时间，不含主键。
type AVAutomationAction struct {
	Type          string                        `json:"type" api:"enum=add|edit|collect"`
	Target        string                        `json:"target" api:"enum=current|related|filtered"`
	AvID          string                        `json:"avID,omitempty" api:"optional"`
	RelationKeyID string                        `json:"relationKeyID,omitempty" api:"optional"`
	Filters       []*AVViewFilter               `json:"filters,omitempty" api:"optional"`
	Fields        map[string]*AVAutomationValue `json:"fields"`
}

// AVAutomationValue 以固定值、源字段、触发时间或触发条目填充目标字段。
// currentTime 仅适用于日期，triggerItem 仅适用于关联到源数据库的字段。
// 重做使用首次执行的记录 ID 和日期值，不重新求值。
type AVAutomationValue struct {
	Mode  string   `json:"mode" api:"enum=static|source|currentTime|triggerItem"`
	KeyID string   `json:"keyID,omitempty" api:"optional"`
	Value *AVValue `json:"value,omitempty" api:"optional"`
}

// 预览已保存且启用的收集规则，不修改数据。只读取目标数据库所在加密边界内的源文档。
// page 从 1 开始，每页至多 100 个匹配块；字段较多时缩小页大小，使整页可在自动操作上限内收集。
type AVBlockCollectionPreviewRequest struct {
	AvID   string `json:"avID"`
	RuleID string `json:"ruleID"`
	Page   int    `json:"page" api:"optional"`
}

type AVBlockCollectionPreview struct {
	Blocks  []*AVBlockCollectionMatch `json:"blocks"`
	HasMore bool                      `json:"hasMore"`
}

type AVBlockCollectionMatch struct {
	ID        string `json:"id"`
	RootID    string `json:"rootID"`
	Content   string `json:"content"`
	HPath     string `json:"hPath"`
	Collected bool   `json:"collected"`
}

// collectAttrViewBlocks 只收集预览后明确指定的块，执行时重新验证已保存规则及匹配条件。
// blockIDs 至多 100 个；已绑定条目不变。该操作只安排收集，撤销重做执行首次生成的具体操作。
type AVCollectBlocks struct {
	RuleID   string   `json:"ruleID"`
	BlockIDs []string `json:"blockIDs"`
}
