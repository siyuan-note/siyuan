// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// CollectionRemovalPreviewRequest 按整笔编辑的后状态预览移除标签或块引用后失配的自动收集条目。
// operations 保持原事务顺序；tagChanges 补充逐字改名后实际删除的标签，不授予条目删除权限。
// 预览不修改文档或数据库；手动、仍匹配其他启用规则、整块删除及无法确定的条目不进入结果。
// 普通与加密笔记本分别读取已认证快照，不跨越加密边界。
type CollectionRemovalPreviewRequest struct {
	Operations []*TransactionOperation `json:"operations"`
	TagChanges []*TagRemovalChange     `json:"tagChanges,omitempty" api:"optional"`
}

// CollectionRemovalPreview 的 sourceVersions 在仅删除来源或没有受影响条目时仍须随原事务提交。
// 用户取消整个编辑时不提交；确认结果不能替代提交时的来源版本和规则复查。
type CollectionRemovalPreview struct {
	Collections    []*TagRemovalCollection `json:"collections"`
	SourceVersions map[string]string       `json:"sourceVersions"`
}
