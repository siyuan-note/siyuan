package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getMapRuntime = contractHandler(apicontract.MapGetRuntime, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[*apicontract.MapRuntime] {
	return apicontract.Success(&apicontract.MapRuntime{Provider: "openfreemap"})
}, mapRuntimeAdmission)

// 内置底图保留独立准入检查，不向发布页或绕过鉴权的进程开放地图宿主。
func mapRuntimeAdmission(c *gin.Context) *apicontract.Response[*apicontract.MapRuntime] {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	if !model.IsAdminRoleContext(c) {
		response := apicontract.Failure[*apicontract.MapRuntime](-1, "administrator access required")
		return &response
	}
	if util.SiYuanAccessAuthCodeBypass {
		response := apicontract.Failure[*apicontract.MapRuntime](-1, "mapAuthenticationBypass")
		return &response
	}
	return nil
}
