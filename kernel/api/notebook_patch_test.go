package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractNotebookConfPatchPersistence(t *testing.T) {
	oldConf, oldDataDir := model.Conf, util.DataDir
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.Sync = conf.NewSync()
	t.Cleanup(func() { model.Conf, util.DataDir = oldConf, oldDataDir })
	const id = "20260101000000-abcdefg"
	path := filepath.Join(util.DataDir, id, ".siyuan", "conf.json")
	initial := conf.NewBoxConf()
	initial.Name = "original"
	data, _ := json.Marshal(initial)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/notebook/setNotebookConf", setNotebookConf)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/notebook/setNotebookConf", strings.NewReader(`{"notebook":"`+id+`","conf":{"dailyNoteSavePath":"daily","name":null,"encrypted":true,"boxCrypt":{"spec":1,"wrappedDEK":"AQID"}}}`)))
	requireAPIContract(t, "POST", "/api/notebook/setNotebookConf", recorder)
	var response struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
		t.Fatalf("patch failed: %s, %v", recorder.Body.String(), err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored conf.BoxConf
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Name != "original" || stored.DailyNoteSavePath != "/daily" || stored.Encrypted || stored.BoxCrypt != nil {
		t.Fatal("patch did not preserve ordinary and encryption configuration")
	}
}

func TestAPIContractNotebookConfPatchCompatibility(t *testing.T) {
	for _, payload := range []string{
		`null`, `{}`, `{"name":null,"sortMode":null,"closed":null}`, `{"name":"","closed":false,"sortMode":0}`,
		`{"Name":"upper","sort":1.0,"sortMode":2e0}`, `{"name":"lower","Name":"upper","unknown":true}`,
		`{"encrypted":false,"boxCrypt":null}`, `{"boxCrypt":{"spec":1,"wrappedDEK":"AQID","metadata":[1,2,3]}}`,
		`{"docCreateSaveBox":"box","docCreateSavePath":"/path","docCreateTemplatePath":"template","refCreateSaveBox":"ref","refCreateSavePath":"/ref","dailyNoteSavePath":"/daily","dailyNoteTemplatePath":"daily","icon":"icon"}`,
		`{"sort":1.5}`, `{"closed":1}`, `{"boxCrypt":{"wrappedDEK":"invalid"}}`, `{"boxCrypt":{"metadata":[256]}}`,
	} {
		t.Run(payload, func(t *testing.T) {
			initial := conf.NewBoxConf()
			initial.Encrypted = true
			initial.BoxCrypt = &conf.BoxEncryption{Spec: 1, WrappedDEK: []byte{9, 8, 7}, WrapNonce: []byte{6, 5, 4}, CreatedAt: 123}
			initialJSON, _ := json.Marshal(initial)
			var legacy conf.BoxConf
			if err := json.Unmarshal(initialJSON, &legacy); err != nil {
				t.Fatal(err)
			}
			var normalized any
			if err := gulu.JSON.UnmarshalJSON([]byte(payload), &normalized); err != nil {
				t.Fatal(err)
			}
			data, err := gulu.JSON.MarshalJSON(normalized)
			if err != nil {
				t.Fatal(err)
			}
			savedCrypt := model.DeepCopyBoxEncryption(legacy.BoxCrypt)
			legacyErr := gulu.JSON.UnmarshalJSON(data, &legacy)
			legacy.Encrypted = true
			legacy.BoxCrypt = savedCrypt
			request, decodeErr := apicontract.SetNotebookConf.Decode(strings.NewReader(`{"notebook":"20260101000000-abcdefg","conf":` + payload + `}`))
			if (legacyErr != nil) != (decodeErr != nil) {
				t.Fatalf("input acceptance changed: old %v, contract %v", legacyErr, decodeErr)
			}
			if decodeErr != nil {
				return
			}
			crypt := initial.BoxCrypt
			applyNotebookConfPatch(initial, request.Conf)
			if initial.BoxCrypt != crypt || !initial.Encrypted {
				t.Fatal("configuration patch modified encryption state")
			}
			before, _ := json.Marshal(&legacy)
			after, _ := json.Marshal(initial)
			if string(before) != string(after) {
				t.Fatalf("patch semantics changed: %s != %s", before, after)
			}
		})
	}
}
