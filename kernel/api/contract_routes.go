package api

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// contractRouteHandlers 按契约装配鉴权、管理员和只读保护，末尾保留现有处理函数。
// 笔记本租约由 ServeAPI 的全局中间件管理，资源访问检查仍由处理函数执行。
func contractRouteHandlers[Request, Data any](endpoint apicontract.Endpoint[Request, Data], handler gin.HandlerFunc) []gin.HandlerFunc {
	definition := endpoint.Definition()
	if !definition.Authorization.Valid() {
		panic(fmt.Sprintf("invalid route authorization: %s", definition.Name))
	}
	var handlers []gin.HandlerFunc
	if definition.Authorization&apicontract.AuthenticatedAccess != 0 {
		handlers = append(handlers, model.CheckAuth)
	}
	if definition.Authorization&apicontract.AdminAccess != 0 {
		handlers = append(handlers, model.CheckAdminRole)
	}
	if definition.Authorization&apicontract.WritableAccess != 0 {
		handlers = append(handlers, model.CheckReadonly)
	}
	return append(handlers, handler)
}
