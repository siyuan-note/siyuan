package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getPinnedDocs = contractHandler(apicontract.GetPinnedDocs, func(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[[]apicontract.PinnedDoc] {
	docs, err := model.GetPinnedDocs()
	if err != nil {
		return apicontract.Failure[[]apicontract.PinnedDoc](-1, err.Error())
	}
	ret := []apicontract.PinnedDoc{}
	for _, doc := range docs {
		ret = append(ret, apicontract.PinnedDoc{ID: doc.ID, Notebook: doc.Notebook, Name: doc.Name, Path: doc.Path,
			Icon: doc.Icon, SubFileCount: doc.SubFileCount, Unavailable: doc.Unavailable, ChildrenSortMode: doc.ChildrenSortMode})
	}
	return apicontract.Success(ret)
})

var updatePinnedDocs = contractHandler(apicontract.UpdatePinnedDocs, func(c *gin.Context, request apicontract.UpdatePinnedDocsRequest) apicontract.Response[apicontract.Null] {
	if err := model.UpdatePinnedDocs(request.IDs, request.Action, request.TargetID, request.After); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})
