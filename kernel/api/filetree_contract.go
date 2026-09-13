package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// 移动回调属于原样透传的 JSON；缺失或 null 时保持事件中不携带回调。
func fileTreeCallback(value *apicontract.JSONValue) any {
	if value == nil {
		return nil
	}
	return *value
}

func fileTreeCreateContext(options apicontract.FileTreeCreateOptions) map[string]any {
	return map[string]any{
		"sortTargetID": options.SortTargetID, "sortPosition": options.SortPosition,
		"docCreateTemplatePath": options.DocCreateTemplatePath, "listDocTree": options.ListDocTree,
	}
}

func fileTreeDocFileContracts(values []*DocFile) []*apicontract.FileTreeDocFile {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.FileTreeDocFile, len(values))
	for i, value := range values {
		if value != nil {
			result[i] = &apicontract.FileTreeDocFile{ID: value.ID, Children: fileTreeDocFileContracts(value.Children)}
		}
	}
	return result
}

func fileTreeReorderContract(value *model.ReorderResult) *apicontract.FileTreeReorderData {
	if value == nil {
		return nil
	}
	result := &apicontract.FileTreeReorderData{Changed: value.Changed}
	if value.Notebook != "" {
		result.Notebook = &value.Notebook
	}
	if value.ParentPath != "" {
		result.ParentPath = &value.ParentPath
	}
	return result
}

func fileTreeRespectSortContract(value *model.DocTreeReorderResult) *apicontract.FileTreeReorderData {
	if value == nil {
		return nil
	}
	return &apicontract.FileTreeReorderData{Changed: value.Changed, Conflict: &value.Conflict, Notebook: &value.Notebook, ParentPath: &value.ParentPath}
}

func fileTreeSearchContracts(values []map[string]string) []*apicontract.FileTreeSearchDoc {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.FileTreeSearchDoc, len(values))
	for i, value := range values {
		if value == nil {
			continue
		}
		optional := func(key string) *string {
			if text, ok := value[key]; ok {
				return &text
			}
			return nil
		}
		result[i] = &apicontract.FileTreeSearchDoc{
			Path: value["path"], HPath: value["hPath"], Box: value["box"], BoxIcon: value["boxIcon"],
			Name: optional("name"), Alias: optional("alias"), NewFlashcardCount: optional("newFlashcardCount"),
			DueFlashcardCount: optional("dueFlashcardCount"), FlashcardCount: optional("flashcardCount"),
		}
	}
	return result
}

func fileTreeFileContracts(values []*model.File) []*apicontract.FileTreeFile {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.FileTreeFile, len(values))
	for i, value := range values {
		result[i] = (*apicontract.FileTreeFile)(value)
	}
	return result
}

func fileTreePublishContracts(values model.PublishAccess) []*apicontract.FileTreePublishItem {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.FileTreePublishItem, len(values))
	for i, value := range values {
		result[i] = (*apicontract.FileTreePublishItem)(value)
	}
	return result
}
