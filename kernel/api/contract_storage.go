package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func skipReadonlyStorageMutation(c *gin.Context) *apicontract.Response[apicontract.Null] {
	if util.ReadOnly || model.IsReadOnlyRoleContext(c) {
		response := apicontract.Success(apicontract.Null{})
		return &response
	}
	return nil
}

// 存储接口的值由调用方定义，可包含任意 JSON；键集合及外围参数仍使用独立的结构化契约。
func storageContract(values map[string]any) apicontract.Response[map[string]apicontract.JSONValue] {
	data, err := json.Marshal(values)
	if err != nil {
		return apicontract.Failure[map[string]apicontract.JSONValue](-1, err.Error())
	}
	var result map[string]apicontract.JSONValue
	if err = json.Unmarshal(data, &result); err != nil {
		return apicontract.Failure[map[string]apicontract.JSONValue](-1, err.Error())
	}
	return apicontract.Success(result)
}

func storageModelValues(values map[string]apicontract.JSONValue) (result map[string]any, err error) {
	data, err := json.Marshal(values)
	if err == nil {
		err = json.Unmarshal(data, &result)
	}
	return
}

func recentDocContracts(values []*model.RecentDoc) []*apicontract.RecentDoc {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.RecentDoc, len(values))
	for i, value := range values {
		if value != nil {
			result[i] = &apicontract.RecentDoc{RootID: value.RootID, Icon: value.Icon, Title: value.Title, ViewedAt: value.ViewedAt, ClosedAt: value.ClosedAt, OpenAt: value.OpenAt}
		}
	}
	return result
}

func criterionContracts(values []*model.Criterion) []*apicontract.Criterion {
	if values == nil {
		return nil
	}
	result := make([]*apicontract.Criterion, len(values))
	for i, value := range values {
		if value != nil {
			result[i] = &apicontract.Criterion{Name: value.Name, Sort: value.Sort, Group: value.Group, HasReplace: value.HasReplace, Method: value.Method, HPath: value.HPath, IDPath: value.IDPath, K: value.K, R: value.R,
				Types: (*apicontract.CriterionTypes)(value.Types), SubTypes: apicontract.SearchSubTypes(value.SubTypes), ReplaceTypes: (*apicontract.CriterionReplaceTypes)(value.ReplaceTypes)}
		}
	}
	return result
}

func criterionModel(value apicontract.Criterion) *model.Criterion {
	return &model.Criterion{Name: value.Name, Sort: value.Sort, Group: value.Group, HasReplace: value.HasReplace, Method: value.Method, HPath: value.HPath, IDPath: value.IDPath, K: value.K, R: value.R,
		Types: (*model.CriterionTypes)(value.Types), SubTypes: model.SearchSubTypes(value.SubTypes), ReplaceTypes: (*model.CriterionReplaceTypes)(value.ReplaceTypes)}
}
