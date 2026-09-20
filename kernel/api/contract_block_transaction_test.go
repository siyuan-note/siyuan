package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractBlockTransactionConversion(t *testing.T) {
	for _, transaction := range []*model.Transaction{nil, {}, {DoOperations: []*model.Operation{}, UndoOperations: []*model.Operation{}}, {Timestamp: 123, TemplateDocTreePlanID: "plan", DoOperations: []*model.Operation{nil, {Action: "insert", ID: "id", RootID: "root", ParentID: "parent", PreviousID: "previous", NextID: "next", Data: "<div>text</div>", RetData: []string{}, BlockIDs: []string{"child"}, Context: map[string]any{"ignoreProcess": "true"}}}, UndoOperations: []*model.Operation{{Action: "delete", ID: "id", RetData: "text", Context: map[string]any{}}, {Action: "foldHeading", RetData: []string{"child"}}}}} {
		before, err := json.Marshal(transaction)
		if err != nil {
			t.Fatal(err)
		}
		converted, err := blockTransactionContract(transaction)
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(converted)
		if err != nil || string(before) != string(after) {
			t.Fatalf("transaction JSON changed: %s != %s, %v", before, after, err)
		}
		recorder := httptest.NewRecorder()
		recorder.Header().Set("Content-Type", "application/json")
		body, err := json.Marshal(apicontract.Success(converted))
		if err != nil {
			t.Fatal(err)
		}
		recorder.Write(body)
		requireAPIContract(t, "POST", "/api/block/getHeadingDeleteTransaction", recorder)
	}
	for _, operation := range []*model.Operation{{Data: 42}, {RetData: map[string]any{"unexpected": true}}, {Srcs: []map[string]any{{"id": "id"}}}, {CellUpdates: []*model.AttrViewCellUpdate{{KeyID: "key"}}}, {Context: map[string]any{"unexpected": true}}} {
		if _, err := blockOperationContract(operation); err == nil {
			t.Fatalf("unexpected payload accepted: %+v", operation)
		}
	}
}

func TestAPIContractHeadingTransactions(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_CONTRACT_HEADING") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractHeadingTransactions$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_CONTRACT_HEADING=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("heading subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.DataDir, util.TempDir, util.ConfDir = filepath.Join(root, "data"), root, root
	util.QueueDir = filepath.Join(root, "queue")
	util.HistoryDir = filepath.Join(root, "history")
	util.DBPath, util.HistoryDBPath, util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(root, "siyuan.db"), filepath.Join(root, "history.db"), filepath.Join(root, "asset_content.db"), filepath.Join(root, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	langData, err := os.ReadFile(filepath.Join("..", "..", "app", "appearance", "langs", "en.json"))
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		Time map[string]any `json:"_time"`
	}
	if err = json.Unmarshal(langData, &language); err != nil {
		t.Fatal(err)
	}
	util.TimeLangs[model.Conf.Lang] = language.Time
	model.Conf.FileTree, model.Conf.Sync, model.Conf.NotebookCrypto = conf.NewFileTree(), conf.NewSync(), conf.NewNotebookCrypto()
	model.Conf.Search, model.Conf.Editor, model.Conf.Export = conf.NewSearch(), conf.NewEditor(), conf.NewExport()
	box := &model.Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	docID := ast.NewNodeID()
	tree := treenode.NewTree(box.ID, "/"+docID+".sy", "/Contract", "Contract")
	paragraphID := tree.Root.FirstChild.ID
	heading := &ast.Node{Type: ast.NodeHeading, ID: ast.NewNodeID(), HeadingLevel: 1}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Contract heading")})
	tree.Root.AppendChild(heading)
	child := &ast.Node{Type: ast.NodeHeading, ID: ast.NewNodeID(), HeadingLevel: 2}
	child.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Contract child")})
	tree.Root.AppendChild(child)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	engine := gin.New()
	engine.POST("/api/block/foldBlock", foldBlock)
	engine.POST("/api/block/unfoldBlock", unfoldBlock)
	engine.POST("/api/block/moveBlock", moveBlock)
	engine.POST("/api/block/getHeadingDeleteTransaction", getHeadingDeleteTransaction)
	engine.POST("/api/block/getHeadingInsertTransaction", getHeadingInsertTransaction)
	engine.POST("/api/block/getHeadingFoldTransaction", getHeadingFoldTransaction)
	testAPIContractRemainingBlockQueries(t, engine, box.ID, docID, heading.ID)
	testAPIContractMindmapMigration(t, engine, box.ID, docID)
	for _, entry := range []struct {
		path, id, scope string
		code            int
		empty           bool
	}{
		{"getHeadingDeleteTransaction", heading.ID, "", 0, false},
		{"getHeadingInsertTransaction", heading.ID, "", 0, false},
		{"getHeadingFoldTransaction", heading.ID, "children", 0, false},
		{"getHeadingFoldTransaction", heading.ID, "invalid", -1, false},
		{"getHeadingDeleteTransaction", ast.NewNodeID(), "", -1, false},
		{"getHeadingInsertTransaction", ast.NewNodeID(), "", -1, false},
		{"getHeadingDeleteTransaction", paragraphID, "", 0, true},
	} {
		path := "/api/block/" + entry.path
		body, _ := json.Marshal(map[string]string{"id": entry.id, "scope": entry.scope})
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(string(body))))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
			t.Fatalf("heading response changed: %s, %v", recorder.Body.String(), err)
		}
		if entry.empty {
			if string(response.Data) != "null" {
				t.Fatalf("non-heading result must be null: %s", recorder.Body.String())
			}
		} else if entry.code == 0 {
			var transaction apicontract.BlockTransaction
			if err := json.Unmarshal(response.Data, &transaction); err != nil || len(transaction.DoOperations) == 0 || len(transaction.UndoOperations) == 0 {
				t.Fatalf("missing heading operations: %s, %v", recorder.Body.String(), err)
			}
		}
	}
	for _, entry := range []struct{ path, body, fold string }{
		{"foldBlock", `{"id":"` + heading.ID + `"}`, "1"},
		{"unfoldBlock", `{"id":"` + heading.ID + `"}`, ""},
		{"moveBlock", `{"id":"` + paragraphID + `","previousID":"` + child.ID + `"}`, ""},
	} {
		path := "/api/block/" + entry.path
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || string(response.Data) != "null" {
			t.Fatalf("block mutation response changed: %s, %v", recorder.Body.String(), err)
		}
		updated, err := model.LoadTreeByBlockID(heading.ID)
		if err != nil {
			t.Fatal(err)
		}
		if node := treenode.GetNodeInTree(updated, heading.ID); node == nil || node.IALAttr("fold") != entry.fold {
			t.Fatalf("heading fold state changed after %s", entry.path)
		}
		if entry.path == "moveBlock" {
			node := treenode.GetNodeInTree(updated, paragraphID)
			if node == nil || node.Previous == nil || node.Previous.ID != child.ID {
				t.Fatal("block was not moved after target")
			}
		}
	}
	testAPIContractBlockEdits(t, engine, box.ID, docID, heading.ID)
}

func testAPIContractBlockEdits(t *testing.T, engine *gin.Engine, boxID, docID, headingID string) {
	for _, route := range []struct {
		name    string
		handler gin.HandlerFunc
	}{
		{"appendBlock", appendBlock}, {"prependBlock", prependBlock}, {"insertBlock", insertBlock},
		{"batchAppendBlock", batchAppendBlock}, {"batchPrependBlock", batchPrependBlock}, {"batchInsertBlock", batchInsertBlock},
		{"updateBlock", updateBlock}, {"batchUpdateBlock", batchUpdateBlock}, {"deleteBlock", deleteBlock},
		{"moveOutlineHeading", moveOutlineHeading}, {"updateTaskListItemMarker", updateTaskListItemMarker},
		{"batchUpdateTaskListItemMarker", batchUpdateTaskListItemMarker},
		{"appendDailyNoteBlock", appendDailyNoteBlock}, {"prependDailyNoteBlock", prependDailyNoteBlock},
	} {
		engine.POST("/api/block/"+route.name, route.handler)
	}
	post := func(name string, request any) []*apicontract.BlockTransaction {
		t.Helper()
		body, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		path := "/api/block/" + name
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(string(body))))
		requireAPIContract(t, "POST", path, recorder)
		var result struct {
			Code int                             `json:"code"`
			Data []*apicontract.BlockTransaction `json:"data"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != 0 {
			t.Fatalf("%s failed: %s, %v", name, recorder.Body.String(), err)
		}
		return result.Data
	}
	parentInput := func(content string) map[string]any {
		return map[string]any{"parentID": docID, "data": content, "dataType": "markdown"}
	}
	for _, name := range []string{"batchAppendBlock", "batchPrependBlock", "batchInsertBlock"} {
		if result := post(name, map[string]any{"blocks": []any{}}); result != nil {
			t.Fatalf("%s empty input must return null", name)
		}
	}
	appendInput := parentInput("append text")
	appendInput["parentID"], appendInput["dataType"] = " "+docID+" ", " markdown "
	appended := post("appendBlock", appendInput)
	if len(appended) != 1 || len(appended[0].DoOperations) == 0 || appended[0].DoOperations[0].ID == "" {
		t.Fatal("append did not return inserted block ID")
	}
	appendID := appended[0].DoOperations[0].ID
	post("prependBlock", parentInput("prepend text"))
	post("insertBlock", map[string]any{"previousID": appendID, "data": "insert text", "dataType": "markdown", "parentID": nil})
	for _, name := range []string{"batchAppendBlock", "batchPrependBlock", "batchInsertBlock"} {
		post(name, map[string]any{"blocks": []any{parentInput(name + " first"), parentInput(name + " second")}})
	}
	post("updateBlock", map[string]any{"id": " " + appendID + " ", "data": "updated text", "dataType": " markdown ", "lockType": nil})
	post("batchUpdateBlock", map[string]any{"blocks": []any{map[string]any{"id": appendID, "data": "batch updated text", "dataType": "markdown", "lockType": true}}})
	post("moveOutlineHeading", map[string]any{"id": headingID, "previousID": appendID})
	post("appendBlock", parentInput("- [ ] task"))
	tree, err := model.LoadTreeByBlockID(docID)
	if err != nil {
		t.Fatal(err)
	}
	taskID := ""
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeListItem && node.ListData.Typ == 3 {
			taskID = node.ID
		}
		return ast.WalkContinue
	})
	if taskID == "" {
		t.Fatal("task fixture missing")
	}
	post("updateTaskListItemMarker", map[string]any{"id": " " + taskID + " ", "marker": "x"})
	post("batchUpdateTaskListItemMarker", map[string]any{"items": []any{map[string]string{"id": taskID, "marker": "x"}, map[string]string{"id": taskID, "marker": " "}}})
	tree, err = model.LoadTreeByBlockID(docID)
	if err != nil {
		t.Fatal(err)
	}
	marker := treenode.GetNodeInTree(tree, taskID).ChildByType(ast.NodeTaskListItemMarker)
	if marker == nil || marker.TaskListItemMarker != ' ' {
		t.Fatal("batch marker did not retain the last value")
	}
	post("deleteBlock", map[string]string{"id": " " + appendID + " "})
	tree, err = model.LoadTreeByBlockID(docID)
	if err != nil {
		t.Fatal(err)
	}
	if treenode.GetNodeInTree(tree, appendID) != nil {
		t.Fatal("block was not deleted")
	}
	box := &model.Box{ID: boxID}
	boxConf := box.GetConf()
	boxConf.DailyNoteSavePath = "/Contract"
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	post("appendDailyNoteBlock", map[string]string{"notebook": boxID, "data": "daily append", "dataType": "markdown"})
	post("prependDailyNoteBlock", map[string]string{"notebook": boxID, "data": "daily prepend", "dataType": "markdown"})
	updated := post("updateBlock", map[string]string{"id": docID, "data": "replacement document", "dataType": "markdown"})
	if len(updated) == 0 {
		t.Fatal("document update did not return operations")
	}
	data, err := json.Marshal(updated)
	if err != nil || !strings.Contains(string(data), `"createEmptyParagraph":false`) {
		t.Fatalf("document deletion options missing: %s, %v", data, err)
	}
	tree, err = model.LoadTreeByBlockID(docID)
	if err != nil {
		t.Fatal(err)
	}
	content := tree.Root.Text()
	if !strings.Contains(content, "replacement document") || strings.Contains(content, "daily append") {
		t.Fatalf("document content was not replaced: %s", content)
	}
}
