package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingExportNormalization(t *testing.T) {
	previousConf, previousDir, previousReadOnly := model.Conf, util.ConfDir, util.ReadOnly
	util.ConfDir, util.ReadOnly = t.TempDir(), false
	t.Cleanup(func() {
		model.Conf, util.ConfDir, util.ReadOnly = previousConf, previousDir, previousReadOnly
	})
	for _, route := range []struct {
		name    string
		handler gin.HandlerFunc
	}{
		{"setExport", setExport},
		{"patch", patchSetting},
	} {
		for _, entry := range []struct {
			body string
			want int
		}{
			{`{"blockRefMode":0}`, 4}, {`{"blockRefMode":1}`, 4}, {`{"blockRefMode":5}`, 4},
			{`{"blockRefMode":2}`, 2}, {`{"blockRefMode":3}`, 3}, {`{"blockRefMode":4}`, 4},
			{`{"blockRefMode":-1}`, -1}, {`{"blockRefMode":6}`, 6},
			{`{"blockRefMode":null}`, 4}, {`{"addTitle":false}`, 4},
		} {
			t.Run(route.name+"/"+entry.body, func(t *testing.T) {
				model.Conf = model.NewAppConf()
				model.Conf.Export = conf.NewExport()
				model.Conf.Export.BlockRefMode = 3
				model.Conf.Export.BlockRefTextLeft = "["
				body, want := entry.body, entry.want
				if route.name == "patch" {
					body = `{"export":` + body + `}`
					if entry.body == `{"addTitle":false}` {
						want = 3
					}
				}
				code, message, data := settingContractRequest(t, route.name, route.handler, body)
				if code != 0 || model.Conf.Export.BlockRefMode != want {
					t.Fatalf("save failed: code=%d message=%s config=%+v", code, message, model.Conf.Export)
				}
				if route.name == "setExport" {
					var response conf.Export
					if err := json.Unmarshal(data, &response); err != nil {
						t.Fatal(err)
					}
					if !reflect.DeepEqual(&response, model.Conf.Export) || response.BlockRefTextLeft != "" {
						t.Fatal("replacement response differs from the applied export settings")
					}
				} else if model.Conf.Export.BlockRefTextLeft != "[" {
					t.Fatal("patch lost an omitted export setting")
				}
				persisted, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
				if err != nil {
					t.Fatal(err)
				}
				var reloaded model.AppConf
				if err = json.Unmarshal(persisted, &reloaded); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(reloaded.Export, model.Conf.Export) ||
					!reflect.DeepEqual(conf.NormalizeExport(reloaded.Export), model.Conf.Export) {
					t.Fatal("persisted export settings differ from the applied or startup settings")
				}
			})
		}
	}
}
