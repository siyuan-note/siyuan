package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractGlobalBacklink(t *testing.T) {
	previousConf, previousData := model.Conf, util.DataDir
	model.Conf, util.DataDir = model.NewAppConf(), t.TempDir()
	model.Conf.Editor = conf.NewEditor()
	t.Cleanup(func() { model.Conf, util.DataDir = previousConf, previousData })
	const boxID = "20260726000003-encrypt"
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		path    string
		handler gin.HandlerFunc
		extra   string
	}{
		{"/api/ref/getGlobalBacklinks", getGlobalBacklinks, ``},
		{"/api/ref/getGlobalBacklinkContexts", getGlobalBacklinkContexts, `,"snapshot":"missing","ids":[]`},
	} {
		t.Run(entry.path, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader) })
			engine.POST(entry.path, entry.handler)
			for _, body := range []string{`{}`, `{"id":"invalid","sort":1,"containChildren":false` + entry.extra + `}`, `{"id":"20260917165208-18eulw4","sort":1,"containChildren":false,"notebook":"` + boxID + `"` + entry.extra + `}`} {
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, httptest.NewRequest("POST", entry.path, strings.NewReader(body)))
				requireAPIContract(t, "POST", entry.path, recorder)
				var response struct {
					Code int             `json:"code"`
					Data json.RawMessage `json:"data"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code == 0 || string(response.Data) != "null" {
					t.Fatalf("invalid/published encrypted request exposed data: %s %v", recorder.Body.String(), err)
				}
			}
			engine = gin.New()
			engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
			engine.POST(entry.path, entry.handler)
			body := `{"id":"20260917165208-18eulw4","sort":1,"containChildren":false,"snapshot":"expired","ids":[]}`
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", entry.path, strings.NewReader(body)))
			requireAPIContract(t, "POST", entry.path, recorder)
			var response struct {
				Code int `json:"code"`
				Data struct {
					Expired bool              `json:"expired"`
					Items   []json.RawMessage `json:"items"`
				} `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || !response.Data.Expired || response.Data.Items == nil {
				t.Fatalf("expired success response: %s %v", recorder.Body.String(), err)
			}
		})
	}
}
