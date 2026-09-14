package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractGraphConfigurationConversion(t *testing.T) {
	global, local := conf.NewGlobalGraph(), conf.NewLocalGraph()
	global.MinRefs, global.DailyNote, global.TypeFilter.Callout = 7, true, true
	local.D3.LineOpacity, local.TypeFilter.Tag = 0.75, true
	for _, pair := range [][2]json.RawMessage{
		{graphJSON(t, global), graphJSON(t, globalGraphContract(global))},
		{graphJSON(t, local), graphJSON(t, localGraphContract(local))},
		{graphJSON(t, &conf.GlobalGraph{}), graphJSON(t, globalGraphContract(&conf.GlobalGraph{}))},
		{graphJSON(t, &conf.LocalGraph{}), graphJSON(t, localGraphContract(&conf.LocalGraph{}))},
	} {
		if string(pair[0]) != string(pair[1]) {
			t.Fatalf("graph configuration changed: %s != %s", pair[0], pair[1])
		}
	}
}

func TestAPIContractSetGraphConfiguration(t *testing.T) {
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleEditor) })
	engine.POST("/api/graph/setGraphConf", setGraphConf)
	for _, entry := range []struct {
		body     string
		code     int
		local    bool
		distance int
		empty    bool
	}{
		{`{"type":" global ","conf":{}}`, 0, false, 400, false},
		{`{"type":"global","conf":{"D3":{"linkDistance":1.0}}}`, 0, false, 1, false},
		{`{"type":"local","conf":{"minRefs":"ignored","d3":{"arrow":false}}}`, 0, true, 400, false},
		{`{"type":"global","conf":{"type":null,"d3":null}}`, 0, false, 0, true},
		{`{"type":"unknown","conf":{"d3":false}}`, -1, false, 0, false},
		{`{"type":"global","conf":{"d3":false}}`, -1, false, 0, false},
		{`{"type":"global","conf":null}`, -1, false, 0, false},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/graph/setGraphConf", strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", "/api/graph/setGraphConf", recorder)
		var response struct {
			Code int `json:"code"`
			Data struct {
				MinRefs *int             `json:"minRefs"`
				D3      *conf.D3         `json:"d3"`
				Type    *conf.TypeFilter `json:"type"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
			t.Fatalf("graph settings changed: %s, %v", recorder.Body.String(), err)
		}
		if entry.code != 0 {
			continue
		}
		if (response.Data.MinRefs == nil) != entry.local {
			t.Fatalf("graph type changed: %s", recorder.Body.String())
		}
		if entry.empty {
			if response.Data.D3 != nil || response.Data.Type != nil {
				t.Fatal("explicit null was replaced by defaults")
			}
		} else if response.Data.D3 == nil || response.Data.D3.LinkDistance != entry.distance || response.Data.D3.NodeSize != 15 {
			t.Fatalf("graph defaults or numeric normalization changed: %s", recorder.Body.String())
		}
	}
}

func graphJSON[T any](t *testing.T, value T) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestAPIContractGraphQueryErrors(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/graph/getGraph", getGraph)
	engine.POST("/api/graph/getLocalGraph", getLocalGraph)
	for _, entry := range []struct {
		route, body, data string
		code              int
	}{
		{"getGraph", `{`, `null`, -1},
		{"getGraph", `{"reqId":{"a":[true,null]},"conf":null}`, `{"reqId":{"a":[true,null]}}`, -1},
		{"getGraph", `{"reqId":7,"conf":{"d3":false}}`, `{"reqId":7}`, -1},
		{"getLocalGraph", `{"reqId":8,"k":false,"conf":null}`, `{"reqId":8}`, 0},
		{"getLocalGraph", `{"reqId":9,"id":null,"k":false}`, `{"reqId":9}`, 0},
		{"getLocalGraph", `{"reqId":10,"id":" "}`, `{"reqId":10}`, -1},
		{"getLocalGraph", `{"reqId":11,"id":"id","conf":false}`, `{"reqId":11}`, -1},
	} {
		path := "/api/graph/" + entry.route
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code || string(response.Data) != entry.data {
			t.Fatalf("graph correlation response changed: %s, %v", recorder.Body.String(), err)
		}
	}
}

func TestAPIContractLocalGraphEncryptedNotebook(t *testing.T) {
	_, boxID := setupArchiveWorkspace(t)
	previous := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previous })
	engine := gin.New()
	engine.POST("/api/graph/getLocalGraph", getLocalGraph)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/graph/getLocalGraph", strings.NewReader(`{"id":"missing","reqId":12,"notebook":"`+boxID+`","conf":{"d3":false}}`)))
	requireAPIContract(t, "POST", "/api/graph/getLocalGraph", recorder)
	var response struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != model.Conf.Language(392) || string(response.Data) != `{"reqId":12}` {
		t.Fatalf("encrypted graph validation order changed: %s, %v", recorder.Body.String(), err)
	}
}

func testGraphQueryContracts(t *testing.T, id string) {
	t.Helper()
	previous := model.Conf.Graph
	model.Conf.Graph = conf.NewGraph()
	defer func() { model.Conf.Graph = previous }()
	for _, role := range []model.Role{model.RoleAdministrator, model.RoleReader} {
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role) })
		engine.POST("/api/graph/getGraph", getGraph)
		engine.POST("/api/graph/getLocalGraph", getLocalGraph)
		for _, path := range []string{"/api/graph/getGraph", "/api/graph/getLocalGraph"} {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(`{"reqId":13,"id":" `+id+` ","conf":{}}`)))
			requireAPIContract(t, "POST", path, recorder)
			var response struct {
				Code int `json:"code"`
				Data struct {
					ReqID int             `json:"reqId"`
					Nodes json.RawMessage `json:"nodes"`
					Links json.RawMessage `json:"links"`
					Conf  json.RawMessage `json:"conf"`
				} `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || response.Data.ReqID != 13 || response.Data.Nodes == nil || response.Data.Links == nil || len(response.Data.Conf) == 0 {
				t.Fatalf("graph query failed: %s, %v", recorder.Body.String(), err)
			}
		}
	}
}

// testGraphResetContracts 使用契约测试进程的临时配置目录验证重置后的持久化状态。
func testGraphResetContracts(t *testing.T) {
	t.Helper()
	previous := model.Conf.Graph
	model.Conf.Graph = conf.NewGraph()
	defer func() { model.Conf.Graph = previous }()
	model.Conf.Graph.Global.MinRefs = 12
	model.Conf.Graph.Local.DailyNote = true
	engine := gin.New()
	engine.POST("/api/graph/resetGraph", resetGraph)
	engine.POST("/api/graph/resetLocalGraph", resetLocalGraph)
	for _, entry := range []struct {
		route    string
		expected json.RawMessage
	}{
		{"resetGraph", graphJSON(t, conf.NewGlobalGraph())},
		{"resetLocalGraph", graphJSON(t, conf.NewLocalGraph())},
	} {
		path := "/api/graph/" + entry.route
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader("invalid ignored body")))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int `json:"code"`
			Data struct {
				Conf json.RawMessage `json:"conf"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || string(response.Data.Conf) != string(entry.expected) {
			t.Fatalf("graph reset changed: %s, %v", recorder.Body.String(), err)
		}
	}
	if model.Conf.Graph.Global.MinRefs != 0 || model.Conf.Graph.Local.DailyNote {
		t.Fatal("graph configuration was not reset")
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved struct {
		Graph *conf.Graph `json:"graph"`
	}
	if err = json.Unmarshal(data, &saved); err != nil || saved.Graph == nil || saved.Graph.Global == nil || saved.Graph.Local == nil {
		t.Fatalf("graph reset was not persisted: %v", err)
	}
	if string(graphJSON(t, saved.Graph.Global)) != string(graphJSON(t, conf.NewGlobalGraph())) || string(graphJSON(t, saved.Graph.Local)) != string(graphJSON(t, conf.NewLocalGraph())) {
		t.Fatal("saved graph defaults differ from response")
	}
}
