// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import "encoding/json"

// Base64Bytes 保留 JSON 字节切片的 Base64 字符串及数字数组输入。
type Base64Bytes []byte

type NotebookEncryptionPatch struct {
	Spec       *int        `json:"spec" api:"optional"`
	WrappedDEK Base64Bytes `json:"wrappedDEK" api:"optional,nullable"`
	WrapNonce  Base64Bytes `json:"wrapNonce" api:"optional,nullable"`
	Metadata   Base64Bytes `json:"metadata" api:"optional,nullable"`
	CreatedAt  *int64      `json:"createdAt" api:"optional"`
}

type NotebookConfPatch struct {
	DocCreateTarget       *StructuredDocumentTarget `json:"docCreateTarget" api:"optional,nullable"`
	RefCreateTarget       *StructuredDocumentTarget `json:"refCreateTarget" api:"optional,nullable"`
	DailyNoteTarget       *StructuredDocumentTarget `json:"dailyNoteTarget" api:"optional,nullable"`
	targetFields          map[string]bool
	Name                  *string                  `json:"name" api:"optional"`
	Sort                  *int                     `json:"sort" api:"optional"`
	Icon                  *string                  `json:"icon" api:"optional"`
	Closed                *bool                    `json:"closed" api:"optional"`
	RefCreateSaveBox      *string                  `json:"refCreateSaveBox" api:"optional"`
	RefCreateSavePath     *string                  `json:"refCreateSavePath" api:"optional"`
	DocCreateSaveBox      *string                  `json:"docCreateSaveBox" api:"optional"`
	DocCreateSavePath     *string                  `json:"docCreateSavePath" api:"optional"`
	DocCreateTemplatePath *string                  `json:"docCreateTemplatePath" api:"optional"`
	DailyNoteSavePath     *string                  `json:"dailyNoteSavePath" api:"optional"`
	DailyNoteTemplatePath *string                  `json:"dailyNoteTemplatePath" api:"optional"`
	SortMode              *int                     `json:"sortMode" api:"optional"`
	Encrypted             *bool                    `json:"encrypted" api:"optional"`
	BoxCrypt              *NotebookEncryptionPatch `json:"boxCrypt" api:"optional"`
}

type SetNotebookConfRequest struct {
	Notebook string             `json:"notebook"`
	Conf     *NotebookConfPatch `json:"conf" api:"optional,legacyobject"`
}

// UnmarshalJSON 为新增目标保留显式 null 删除请求，其余旧字段仍按原有部分更新规则绑定。
func (patch *NotebookConfPatch) UnmarshalJSON(data []byte) error {
	type plain NotebookConfPatch
	var next plain
	if err := json.Unmarshal(data, &next); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	next.targetFields = map[string]bool{}
	for _, name := range []string{"docCreateTarget", "refCreateTarget", "dailyNoteTarget"} {
		_, next.targetFields[name] = fields[name]
	}
	*patch = NotebookConfPatch(next)
	return nil
}

func (patch *NotebookConfPatch) HasDocumentTarget(name string) bool {
	return patch != nil && patch.targetFields[name]
}
