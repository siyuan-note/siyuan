package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

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
