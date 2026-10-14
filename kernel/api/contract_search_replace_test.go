package api

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSearchReplaceMethods(t *testing.T) {
	previousConf, previousLangs, previousReadOnly := model.Conf, util.Langs, util.ReadOnly
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {132: "unsupported replacement"}}
	util.ReadOnly = false
	t.Cleanup(func() { model.Conf, util.Langs, util.ReadOnly = previousConf, previousLangs, previousReadOnly })
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	const path = "/api/search/findReplace"
	engine.POST(path, model.CheckAdminRole, model.CheckReadonly, findReplace)
	for _, method := range []string{"null", "0", "1", "2", "3", "4", "4.9"} {
		for _, ids := range []string{`[]`, `["20261008120000-abcdefg"]`} {
			t.Run(method+"/"+ids, func(t *testing.T) {
				body := fmt.Sprintf(`{"k":"same","r":"same","ids":%s,"method":%s}`, ids, method)
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
				requireAPIContract(t, "POST", path, recorder)
				var response struct {
					Code int             `json:"code"`
					Msg  string          `json:"msg"`
					Data json.RawMessage `json:"data"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if method == "2" || method == "4" || method == "4.9" {
					if response.Code != 1 || response.Msg != model.Conf.Language(132) || string(response.Data) != `{"closeTimeout":5000}` {
						t.Fatalf("unsupported method must return the existing error envelope: %s", recorder.Body.String())
					}
				} else if response.Code != 0 || string(response.Data) != "null" {
					t.Fatalf("supported unchanged replacement must remain a no-op: %s", recorder.Body.String())
				}
			})
		}
	}
}
