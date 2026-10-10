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
	ID         string                `json:"id"`
	Name       string                `json:"name"`
	Enabled    bool                  `json:"enabled"`
	Trigger    string                `json:"trigger" api:"enum=added|changed"`
	KeyID      string                `json:"keyID,omitempty" api:"optional"`
	Conditions []*AVViewFilter       `json:"conditions,omitempty" api:"optional"`
	Actions    []*AVAutomationAction `json:"actions"`
}

// AVAutomationAction 的 current 指触发条目所在数据库，related 通过源关联字段选择条目，
// filtered 在 avID 指定的数据库中按 filters 选择条目；空 filters 匹配全部条目。
// add 创建游离条目，edit 修改选中的条目；主键操作只修改文本并保留已有绑定。
type AVAutomationAction struct {
	Type          string                        `json:"type" api:"enum=add|edit"`
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
