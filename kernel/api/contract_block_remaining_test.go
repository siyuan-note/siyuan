package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractSearchBlockConversion(t *testing.T) {
	for _, blocks := range [][]*model.Block{nil, {}, {nil, {Box: "box", Path: "/path", HPath: "/title", ID: "id", RootID: "root", ParentID: "parent", Name: "name", Alias: "alias", Memo: "memo", Tag: "tag", Content: "content", Number: "1", FContent: "fcontent", Markdown: "markdown", Folded: true, Type: "NodeParagraph", SubType: "sub", RefText: "ref", Refs: []*model.Block{{ID: "ref"}}, DefID: "def", DefPath: "/def", IAL: map[string]string{"name": "value"}, Children: []*model.Block{}, Depth: 1, Count: 2, RefCount: 3, Sort: 4, Created: "created", Updated: "updated", RiffCardID: "card", RiffCard: &model.RiffCard{Due: time.Date(2026, 9, 13, 12, 0, 0, 123, time.FixedZone("offset", 8*60*60)), Reps: 2, Lapses: 1, State: 2}}}} {
		before, err := json.Marshal(blocks)
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(searchBlockContracts(blocks))
		if err != nil || string(before) != string(after) {
			t.Fatalf("block JSON changed: %s != %s, %v", before, after, err)
		}
	}
}

func testAPIContractRemainingBlockQueries(t *testing.T, engine *gin.Engine, boxID, docID, headingID string) {
	engine.POST("/api/block/getDocHeadingLevelTransaction", getDocHeadingLevelTransaction)
	engine.POST("/api/block/getHeadingLevelTransaction", getHeadingLevelTransaction)
	engine.POST("/api/block/getRecentUpdatedBlocks", getRecentUpdatedBlocks)
	engine.POST("/api/block/checkBlockRef", checkBlockRef)
	post := func(name, body string, code int) json.RawMessage {
		t.Helper()
		path := "/api/block/" + name
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != code {
			t.Fatalf("%s: %s, %v", name, recorder.Body.String(), err)
		}
		return response.Data
	}
	for _, body := range []string{"", "null", `{"id":"x","source":0,"target":1}`, `{"id":"x","source":7,"target":1}`, `{"id":42}`} {
		post("getDocHeadingLevelTransaction", body, -1)
	}
	for _, entry := range []struct {
		source, target int
		children       bool
	}{{0, 0, false}, {1, 3, false}, {1, 2, true}, {6, 1, true}} {
		input := map[string]interface{}{"id": docID, "notebook": boxID, "source": entry.source, "target": entry.target, "withSubheadings": entry.children}
		body, _ := json.Marshal(input)
		data := post("getDocHeadingLevelTransaction", string(body), 0)
		want, err := model.GetDocHeadingLevelTransaction(docID, boxID, entry.source, entry.target, entry.children)
		if err != nil {
			t.Fatal(err)
		}
		// 时间戳由每次事务查询生成，比较其余完整载荷。
		var got model.DocHeadingLevelResult
		if err = json.Unmarshal(data, &got); err != nil {
			t.Fatal(err)
		}
		if got.Transaction != nil && want.Transaction != nil {
			got.Transaction.Timestamp = want.Transaction.Timestamp
		}
		actualJSON, _ := json.Marshal(got)
		wantJSON, _ := json.Marshal(want)
		if string(actualJSON) != string(wantJSON) {
			t.Fatalf("document heading JSON changed: %s != %s", actualJSON, wantJSON)
		}
	}
	for _, body := range []string{`{"id":"` + headingID + `","level":3.9}`, `{"ids":["` + headingID + `","` + headingID + `"],"id":false,"level":3}`} {
		data := post("getHeadingLevelTransaction", body, 0)
		var got model.Transaction
		if err := json.Unmarshal(data, &got); err != nil {
			t.Fatal(err)
		}
		want, err := model.GetHeadingLevelBatchTransaction([]string{headingID}, 3)
		if err != nil {
			t.Fatal(err)
		}
		got.Timestamp = want.Timestamp
		actualJSON, _ := json.Marshal(got)
		wantJSON, _ := json.Marshal(want)
		if string(actualJSON) != string(wantJSON) {
			t.Fatalf("heading JSON changed: %s != %s", actualJSON, wantJSON)
		}
	}
	post("getHeadingLevelTransaction", `{"ids":[],"level":2}`, 0)
	data := post("getRecentUpdatedBlocks", "not JSON", 0)
	want, _ := json.Marshal(model.RecentUpdatedBlocks())
	if string(data) != string(want) {
		t.Fatalf("recent blocks changed: %s != %s", data, want)
	}
	for _, body := range []string{`{"ids":["` + headingID + `"],"exactIDs":[],"deletedIDs":[]}`, `{"scope":"notebook","notebook":" ` + boxID + ` "}`, `{"scope":"documents","paths":["` + boxID + `/` + docID + `.sy"]}`} {
		if data := post("checkBlockRef", body, 0); string(data) != "false" {
			t.Fatalf("unexpected reference: %s", data)
		}
	}
	post("checkBlockRef", `{"ids":["`+headingID+`"],"deletedIDs":["`+docID+`"]}`, -1)
}
