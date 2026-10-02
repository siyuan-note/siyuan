package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func testAPIContractListConversion(t *testing.T, engine *gin.Engine, docID string) {
	t.Helper()
	util.IncBootProgress(100-util.GetBootProgress(), "")
	tree, err := model.LoadTreeByBlockID(docID)
	if err != nil {
		t.Fatal(err)
	}
	_, source := util.NewLute().Md2BlockDOMTree("- First\n- Second\n", false)
	list := source.Root.ChildByType(ast.NodeList)
	tree.Root.AppendChild(list)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	engine.POST("/api/transactions", performTransactions)
	post := func(transactions []map[string]any) (int, string) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"transactions": transactions, "reqId": 123, "app": "contract", "session": "contract"})
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/transactions", strings.NewReader(string(body))))
		requireAPIContract(t, "POST", "/api/transactions", recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response.Code, recorder.Body.String()
	}
	op := map[string]any{"action": "convertList", "id": docID, "blockIDs": []string{list.ID},
		"data": apicontract.TransactionListConversion{Type: "heading", Level: 5}}
	for _, transactions := range [][]map[string]any{
		{{"doOperations": []map[string]any{op, {"action": "delete", "id": list.ID}}}},
		{{"doOperations": []map[string]any{op}}, {"doOperations": []map[string]any{{"action": "delete", "id": list.ID}}}},
		{{"doOperations": []map[string]any{{"action": "convertList", "blockIDs": []string{ast.NewNodeID()}, "data": op["data"]}}}},
	} {
		if code, response := post(transactions); code == 0 {
			t.Fatalf("invalid batch accepted: %s", response)
		}
		if current := model.GetBlockDOM(list.ID); !strings.Contains(current, `data-type="NodeList"`) {
			t.Fatal("failed HTTP conversion changed the list")
		}
	}
	if code, response := post([]map[string]any{{"doOperations": []map[string]any{op}}}); code != 0 || !strings.Contains(response, `"rootIDs":["`+docID+`"]`) {
		t.Fatalf("conversion result missing: %s", response)
	}
	current, err := model.LoadTreeByBlockID(docID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range list.ChildrenByType(ast.NodeListItem) {
		paragraph := item.ChildByType(ast.NodeParagraph)
		node := treenode.GetNodeInTree(current, paragraph.ID)
		if node == nil || node.Type != ast.NodeHeading || node.HeadingLevel != 5 {
			t.Fatal("HTTP conversion did not preserve the paragraph identity")
		}
	}
}
