package api

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractChildBlockConversion(t *testing.T) {
	for _, blocks := range [][]*model.ChildBlock{nil, {}, {nil}, {{ID: "id", Type: "p"}}, {{ID: "id", Type: "l", SubType: "o", Content: "text", Markdown: "1. text"}}} {
		before, _ := json.Marshal(blocks)
		after, err := json.Marshal(childBlockContracts(blocks))
		if err != nil || string(before) != string(after) {
			t.Fatalf("child JSON changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractDocInfoConversion(t *testing.T) {
	for _, values := range [][]*model.BlockInfo{nil, {}, {nil}, {{ID: "id", RootID: "root", Name: "name", RefCount: 2, SubFileCount: 3, RefIDs: []string{"ref"}, IAL: map[string]string{"bookmark": "mark"}, Icon: "icon", AttrViews: []*model.AttrView{nil, {ID: "av", Name: "view"}}}}, {{RefIDs: []string{}, IAL: map[string]string{}, AttrViews: []*model.AttrView{}}}} {
		before, _ := json.Marshal(values)
		after, err := json.Marshal(docInfoContracts(values))
		if err != nil || string(before) != string(after) {
			t.Fatalf("document info JSON changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractTreeStatConversion(t *testing.T) {
	for _, stat := range []*model.DocumentStat{nil, {}, {Stat: &util.BlockStatResult{WordCount: 4}, ContainsEmbed: true, StatWithEmbed: &util.BlockStatResult{WordCount: 9}, EmbedStat: &model.EmbedStat{Complete: true, QueryEmbedCount: 1, JSEmbedCount: 2, ResultCount: 3, FailedQueryCount: 4, FailedResultCount: 5, TruncatedQueryCount: 6, CycleCount: 7, DepthLimitCount: 8}}} {
		for _, includeEmbed := range []bool{false, true} {
			expected := map[string]any{"reqId": nil, "stat": nil, "containsEmbed": false}
			if stat != nil {
				expected["stat"], expected["containsEmbed"] = stat.Stat, stat.ContainsEmbed
				if includeEmbed {
					expected["statWithEmbed"], expected["embedStat"] = stat.StatWithEmbed, stat.EmbedStat
				}
			}
			body, err := json.Marshal(apicontract.Success(treeStatContract(apicontract.JSONValue{}, stat, includeEmbed)))
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			recorder.Header().Set("Content-Type", "application/json; charset=utf-8")
			recorder.Write(body)
			requireAPIContract(t, "POST", "/api/block/getTreeStat", recorder)
			var actual struct {
				Data map[string]any `json:"data"`
			}
			if err = json.Unmarshal(body, &actual); err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(expected)
			var normalized map[string]any
			if err = json.Unmarshal(before, &normalized); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(normalized, actual.Data) {
				t.Fatalf("tree stat JSON changed: %s != %s", before, body)
			}
		}
	}
}

func TestAPIContractBlockTreeConversion(t *testing.T) {
	for _, values := range []map[string]*model.BlockTreeInfo{nil, {}, {"nil": nil}, {"id": {ID: "id", Type: "p", ParentID: "parent", ParentType: "d", PreviousID: "previous", PreviousType: "h", NextID: "next", NextType: "l"}}} {
		before, _ := json.Marshal(values)
		after, err := json.Marshal(blockTreeInfoContracts(values))
		if err != nil || string(before) != string(after) {
			t.Fatalf("tree info JSON changed: %s != %s, %v", before, after, err)
		}
	}
	for _, values := range [][]*model.BlockPath{nil, {}, {nil}, {{ID: "id", Name: "name", Type: "NodeList", SubType: "u", HasChildren: true, Children: []*model.BlockPath{{ID: "child", Children: []*model.BlockPath{}}}}}} {
		before, _ := json.Marshal(values)
		after, err := json.Marshal(blockPathContracts(values))
		if err != nil || string(before) != string(after) {
			t.Fatalf("breadcrumb JSON changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractRefDefsConversion(t *testing.T) {
	for _, values := range [][]*model.RefDefs{nil, {}, {nil}, {{RefID: "ref", DefIDs: nil}}, {{RefID: "ref", DefIDs: []string{}}}, {{RefID: "ref", DefIDs: []string{"def"}}}} {
		before, _ := json.Marshal(values)
		after, err := json.Marshal(refDefContracts(values))
		if err != nil || string(before) != string(after) {
			t.Fatalf("reference JSON changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractWordCountCorrelation(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/block/getContentWordCount", getContentWordCount)
	for _, value := range []string{`null`, `1.0`, `"request"`, `true`, `[1,null,"x"]`, `{"nested":{"values":[false,2]}}`} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/block/getContentWordCount", strings.NewReader(`{"content":"","reqId":`+value+`}`)))
		requireAPIContract(t, "POST", "/api/block/getContentWordCount", recorder)
		var result struct {
			Code int `json:"code"`
			Data struct {
				ReqID any `json:"reqId"`
			} `json:"data"`
		}
		var expected any
		if err := json.Unmarshal([]byte(value), &expected); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != 0 || !reflect.DeepEqual(result.Data.ReqID, expected) {
			t.Fatalf("correlation value changed: %s, %v", recorder.Body.String(), err)
		}
	}
}

func TestAPIContractBlockStatConversion(t *testing.T) {
	for _, stat := range []*util.BlockStatResult{nil, {}, {RuneCount: 12, WordCount: 3, LinkCount: 2, ImageCount: 4, RefCount: 5, BlockCount: 6}} {
		before, _ := json.Marshal(stat)
		after, err := json.Marshal(blockStatContract(stat))
		if err != nil || string(before) != string(after) {
			t.Fatalf("stat JSON changed: %s != %s, %v", before, after, err)
		}
	}
}
