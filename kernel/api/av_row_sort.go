package api

import (
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getAttributeViewRowSort(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	var request model.AttributeViewRowSortRequest
	if err := c.ShouldBindJSON(&request); nil != err {
		ret.Code, ret.Msg = -1, err.Error()
		return
	}
	if util.InvalidIDPattern(request.AvID, ret) || util.InvalidIDPattern(request.ViewID, ret) {
		return
	}
	preview, err := model.PrepareAttributeViewRowSort(&request)
	if nil != err {
		ret.Code, ret.Msg = -1, err.Error()
		return
	}
	ret.Data = preview
}
