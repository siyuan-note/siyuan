package api

import (
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractAuthorizationHandlers(t *testing.T) {
	handler := func(*gin.Context) {}
	for _, test := range []struct {
		actual []gin.HandlerFunc
		want   []gin.HandlerFunc
	}{
		{contractRouteHandlers(apicontract.Version, handler), []gin.HandlerFunc{handler}},
		{contractRouteHandlers(apicontract.GetBlockDOM, handler), []gin.HandlerFunc{model.CheckAuth, handler}},
		{contractRouteHandlers(apicontract.NetworkForwardProxy, handler), []gin.HandlerFunc{model.CheckAuth, model.CheckAdminRole, handler}},
		{contractRouteHandlers(apicontract.ChangeAttrViewLayout, handler), []gin.HandlerFunc{model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, handler}},
	} {
		if len(test.actual) != len(test.want) {
			t.Fatalf("middleware count changed: got %d want %d", len(test.actual), len(test.want))
		}
		for index, expected := range test.want {
			if reflect.ValueOf(test.actual[index]).Pointer() != reflect.ValueOf(expected).Pointer() {
				t.Fatalf("middleware order changed at %d", index)
			}
		}
	}
}
