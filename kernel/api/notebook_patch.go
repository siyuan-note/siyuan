// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func applyNotebookDocumentTargetPatch(notebook string, value *conf.BoxConf, patch *apicontract.NotebookConfPatch) error {
	if patch == nil {
		return nil
	}
	for _, item := range []struct {
		name    string
		current **conf.DocumentTarget
		next    *apicontract.StructuredDocumentTarget
		oldPath string
		newPath *string
		oldBox  string
		newBox  *string
	}{
		{"docCreateTarget", &value.DocCreateTarget, patch.DocCreateTarget, value.DocCreateSavePath, patch.DocCreateSavePath, value.DocCreateSaveBox, patch.DocCreateSaveBox},
		{"refCreateTarget", &value.RefCreateTarget, patch.RefCreateTarget, value.RefCreateSavePath, patch.RefCreateSavePath, value.RefCreateSaveBox, patch.RefCreateSaveBox},
		{"dailyNoteTarget", &value.DailyNoteTarget, patch.DailyNoteTarget, value.DailyNoteSavePath, patch.DailyNoteSavePath, "", nil},
	} {
		if patch.HasDocumentTarget(item.name) {
			if model.IsEncryptedBox(notebook) && !model.IsBoxUnlocked(notebook) {
				return errors.New("unlock the notebook before changing document targets")
			}
			next := documentTargetModel(item.next)
			if err := model.ValidateNotebookDocumentTarget(notebook, next); err != nil {
				return err
			}
			*item.current = next
		}
		if *item.current != nil && (item.newPath != nil && *item.newPath != item.oldPath || item.newBox != nil && *item.newBox != item.oldBox) {
			return errors.New("structured document target conflicts with the legacy save path")
		}
	}
	return nil
}

// applyNotebookConfPatch 仅更新提供的普通配置字段，加密参数由密钥生命周期接口管理。
func applyNotebookConfPatch(value *conf.BoxConf, patch *apicontract.NotebookConfPatch) {
	if patch == nil {
		return
	}
	if patch.Name != nil {
		value.Name = *patch.Name
	}
	if patch.Sort != nil {
		value.Sort = *patch.Sort
	}
	if patch.Icon != nil {
		value.Icon = *patch.Icon
	}
	if patch.Closed != nil {
		value.Closed = *patch.Closed
	}
	if patch.RefCreateSaveBox != nil {
		value.RefCreateSaveBox = *patch.RefCreateSaveBox
	}
	if patch.RefCreateSavePath != nil {
		value.RefCreateSavePath = *patch.RefCreateSavePath
	}
	if patch.DocCreateSaveBox != nil {
		value.DocCreateSaveBox = *patch.DocCreateSaveBox
	}
	if patch.DocCreateSavePath != nil {
		value.DocCreateSavePath = *patch.DocCreateSavePath
	}
	if patch.DocCreateTemplatePath != nil {
		value.DocCreateTemplatePath = *patch.DocCreateTemplatePath
	}
	if patch.DailyNoteSavePath != nil {
		value.DailyNoteSavePath = *patch.DailyNoteSavePath
	}
	if patch.DailyNoteTemplatePath != nil {
		value.DailyNoteTemplatePath = *patch.DailyNoteTemplatePath
	}
	if patch.SortMode != nil {
		value.SortMode = *patch.SortMode
	}
}
