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

func TestAPIContractRefreshBacklinkInvalidID(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/ref/refreshBacklink", refreshBacklink)
	for _, body := range []string{`{`, `{}`, `{"id":null}`, `{"id":true}`, `{"id":" "}`, `{"id":" invalid "}`} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ref/refreshBacklink", strings.NewReader(body)))
		requireAPIContract(t, "POST", "/api/ref/refreshBacklink", recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || string(response.Data) != "null" {
			t.Fatalf("invalid backlink response changed: %s, %v", recorder.Body.String(), err)
		}
	}
}

func TestAPIContractBackmentionPublishedEncryptedNotebook(t *testing.T) {
	for _, path := range []string{"/api/ref/getBackmentionDoc", "/api/ref/getBacklinkDoc"} {
		t.Run(path, func(t *testing.T) { testBacklinkContextPublishedEncryptedNotebook(t, path) })
	}
}

func testBacklinkContextPublishedEncryptedNotebook(t *testing.T, path string) {
	t.Helper()
	previousConf, previousData := model.Conf, util.DataDir
	model.Conf, util.DataDir = model.NewAppConf(), t.TempDir()
	model.Conf.Editor = conf.NewEditor()
	t.Cleanup(func() { model.Conf, util.DataDir = previousConf, previousData })
	boxID := "20260726000003-encrypt"
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader) })
	engine.POST("/api/ref/getBackmentionDoc", getBackmentionDoc)
	engine.POST("/api/ref/getBacklinkDoc", getBacklinkDoc)
	revision := ""
	type sortCase struct {
		sort      string
		unchanged bool
	}
	cases := []sortCase{{"", false}, {"", true}}
	if path == "/api/ref/getBacklinkDoc" {
		cases = append(cases, sortCase{`,"blockSort":1`, false}, sortCase{`,"blockSort":1`, true}, sortCase{`,"blockSort":2`, false})
	}
	for _, test := range cases {
		unchanged := test.unchanged
		body := `{"defID":"def","refTreeID":"ref","keyword":"","notebook":"` + boxID + `","knownRevision":"` + revision + `"` + test.sort + `}`
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int                   `json:"code"`
			Data backlinkContextResult `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || response.Data.Unchanged != unchanged || response.Data.Revision == "" {
			t.Fatalf("backmention revision response changed: %s, %v", recorder.Body.String(), err)
		}
		items, other := response.Data.Backmentions, response.Data.Backlinks
		if path == "/api/ref/getBacklinkDoc" {
			items, other = other, items
		}
		if len(items) != 0 || other != nil || (items == nil) != unchanged || (response.Data.Keywords == nil) != unchanged {
			t.Fatalf("published encrypted backmention payload changed: %s", recorder.Body.String())
		}
		revision = response.Data.Revision
	}
}

func TestAPIContractBacklinkContextConversion(t *testing.T) {
	items := []*backlinkContextResponse{nil, {
		ID: "id", DOM: "dom", Revision: "revision", Type: "NodeAttributeView", ReferenceBlockID: "ref", Expand: true,
		BlockPaths:           []*model.BlockPath{nil, {ID: "parent", Children: []*model.BlockPath{{ID: "child", HasChildren: true}}}},
		AttributeViewTargets: []*model.BacklinkAttributeViewTarget{nil, {BlockID: "av", Matches: []*model.BacklinkAttributeViewMatch{nil, {ItemID: "item", KeyID: "key", ValueID: "value", Title: "title", KeyName: "name", DefIDs: []string{"def"}}}}},
	}}
	for _, input := range [][]*backlinkContextResponse{nil, {}, items} {
		expected, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(backlinkContextContracts(input))
		if err != nil || string(expected) != string(actual) {
			t.Fatalf("backlink context serialization changed: %s != %s, %v", expected, actual, err)
		}
	}
}
