package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractSettingCloudUserCached(t *testing.T) {
	previous := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previous })
	for _, user := range []*conf.User{nil, {UserId: "owner", UserTokenExpireTime: "0"}} {
		model.Conf.SetUser(user)
		for _, role := range []model.Role{model.RoleAdministrator, model.RoleReader, model.RoleEditor} {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Set(model.RoleContextKey, role)
			context.Request = httptest.NewRequest("POST", "/api/setting/getCloudUser", strings.NewReader(`{"cached":true,"token":"ignored"}`))
			getCloudUser(context)
			requireAPIContract(t, "POST", "/api/setting/getCloudUser", recorder)
			var result struct {
				Code int `json:"code"`
				Data *struct {
					UserID string `json:"userId"`
				} `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Code != 0 {
				t.Fatalf("cached query failed: %s", recorder.Body.String())
			}
			if role == model.RoleAdministrator && user != nil {
				if result.Data == nil || result.Data.UserID != user.UserId {
					t.Fatal("cached account missing")
				}
			} else if result.Data != nil {
				t.Fatal("unexpected account disclosure")
			}
		}
	}
}
