// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// TagRemovalChange 仅预览从指定块中删除的精确标签；不写入正文。
type TagRemovalChange struct {
	ID   string   `json:"id"`
	Tags []string `json:"tags"`
}

// TagRemovalPreviewRequest 的 label 与 changes 二选一。
// label 查找全工作区同名标签；changes 用于编辑器中即将提交的删除。
// 只返回此前匹配、删除后不再符合任何启用规则的自动收集条目；手动条目和未知状态保留。
type TagRemovalPreviewRequest struct {
	Label   string              `json:"label,omitempty" api:"optional"`
	Changes []*TagRemovalChange `json:"changes,omitempty" api:"optional"`
}

type TagRemovalCollection struct {
	AvID    string              `json:"avID"`
	Name    string              `json:"name"`
	Cleanup AVCollectionCleanup `json:"cleanup"`
}

// RemoveTagWithCollectionsRequest 显式删除标签，并只移出用户选择的数据库中的确认条目。
// 移出前复查规则版本、自动收集来源和当前匹配；源内容及字段修改一同提交、回滚和撤销。
// 未选择的数据库保留条目；重新打标签不会恢复已移出条目的字段，可用撤销恢复。
type RemoveTagWithCollectionsRequest struct {
	Label       string                  `json:"label"`
	Collections []*TagRemovalCollection `json:"collections"`
}
