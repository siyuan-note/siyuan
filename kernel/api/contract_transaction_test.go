package api

import (
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTransactionContractActionCoverage(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	declared := map[string]bool{}
	for _, value := range bundle.Definitions["UnknownTransactionAction"].Not.Enum {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var action string
		if err = json.Unmarshal(data, &action); err != nil {
			t.Fatal(err)
		}
		declared[action] = true
	}
	source, err := parser.ParseFile(token.NewFileSet(), "../model/transaction.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	var executionBody *ast.BlockStmt
	for _, declaration := range source.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if ok && function.Name.Name == "performTx" {
			executionBody = function.Body
		}
	}
	if executionBody == nil {
		t.Fatal("transaction execution function is missing")
	}
	ast.Inspect(executionBody, func(node ast.Node) bool {
		switchNode, ok := node.(*ast.SwitchStmt)
		if !ok {
			return true
		}
		selector, ok := switchNode.Tag.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "Action" {
			return true
		}
		for _, statement := range switchNode.Body.List {
			clause, ok := statement.(*ast.CaseClause)
			if !ok {
				continue
			}
			for _, expression := range clause.List {
				literal, ok := expression.(*ast.BasicLit)
				if !ok || literal.Kind != token.STRING {
					continue
				}
				action, err := strconv.Unquote(literal.Value)
				if err != nil {
					t.Fatal(err)
				}
				if !declared[action] {
					t.Errorf("model action %s has no finite contract", action)
				}
				found++
			}
		}
		return true
	})
	if !declared["updateAttrs"] || found+1 != len(declared) {
		t.Fatalf("action coverage: model %d plus attribute event, contract %d", found, len(declared))
	}
}

func TestTransactionContractMapping(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	fixtures := []*model.Transaction{{Timestamp: 123, DoOperations: []*model.Operation{
		{Action: "update", Data: "<div>content</div>", Context: map[string]any{"focusId": "block"}},
		{Action: "updateAttrViewCell", Data: map[string]any{"text": nil}},
		{Action: "updateAttrViewCells", CellUpdates: []*model.AttrViewCellUpdate{{KeyID: "key", RowID: "item", Data: map[string]any{"number": map[string]any{"content": 1.5}}}}},
		{Action: "insertAttrViewBlock", Srcs: []map[string]any{{"id": "block"}, {"id": "item", "isDetached": true, "content": ""}}, RetData: map[string]any{"insertedItemIDs": []string{"item"}, "existingItemIDs": []string{}}},
		{Action: "plugin-custom", Data: map[string]any{"extension": []any{true, nil, "text", 1.5}}, RetData: map[string]any{"plugin": "result"}, Context: map[string]any{"plugin": map[string]any{"nested": true}}},
	}, UndoOperations: []*model.Operation{}}}
	result, err := transactionContracts(fixtures)
	if err != nil {
		t.Fatal(err)
	}
	assertAVContractJSONEqual(t, fixtures, result)
	payload, err := json.Marshal(apicontract.Success(result))
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateResponse(http.MethodPost, "/api/transactions", payload); err != nil {
		t.Fatal(err)
	}
	for _, values := range [][]*model.Transaction{nil, {}, {nil}} {
		result, err = transactionContracts(values)
		if err != nil {
			t.Fatal(err)
		}
		assertAVContractJSONEqual(t, values, result)
	}
}

func TestTransactionContractHistoryHTTP(t *testing.T) {
	model.GlobalUndoLog.Clear("")
	t.Cleanup(func() { model.GlobalUndoLog.Clear("") })
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/transactions/undo", performUndo)
	router.POST("/api/transactions/redo", performRedo)
	router.POST("/api/transactions/clearHistory", clearHistory)
	router.POST("/api/transactions/undoState", undoState)
	for _, path := range []string{"undo", "redo", "clearHistory", "undoState"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/transactions/"+path, strings.NewReader(`{"rootID":" absent "}`))
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatal(recorder.Code)
		}
		if err = bundle.ValidateResponse(http.MethodPost, "/api/transactions/"+path, recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		if (path == "undo" || path == "redo") && recorder.Body.String() != `{"code":0,"msg":"","data":{"canUndo":false,"canRedo":false}}` {
			t.Fatalf("empty replay: %s", recorder.Body.String())
		}
	}
}

func TestTransactionContractBootBeforeOperationBinding(t *testing.T) {
	// 启动完成后的进度不可回退，使用独立进程验证启动期间的请求校验顺序。
	if os.Getenv("SIYUAN_TEST_TRANSACTION_BOOT") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestTransactionContractBootBeforeOperationBinding$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_TRANSACTION_BOOT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("boot subprocess failed: %v\n%s", err, output)
		}
		return
	}
	oldConf, oldLangs := model.Conf, util.Langs
	progress := util.GetBootProgress()
	util.IncBootProgress(-progress, "")
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {74: "boot progress %d"}}
	t.Cleanup(func() {
		model.Conf, util.Langs = oldConf, oldLangs
		util.IncBootProgress(progress-util.GetBootProgress(), "")
	})
	router := gin.New()
	router.POST("/api/transactions", performTransactions)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/transactions", strings.NewReader(`{"transactions":[{"timestamp":1.2}],"reqId":1}`)))
	if !strings.Contains(recorder.Body.String(), `"msg":"boot progress 0"`) || !strings.Contains(recorder.Body.String(), `"closeTimeout":5000`) {
		t.Fatal(recorder.Body.String())
	}
}

func TestTransactionContractEncryptedContextAdmission(t *testing.T) {
	setupAttributeViewContextFilterAPITest(t)
	const boxID = "20260913120000-txenc00"
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(confPath, []byte(`{"encrypted":true}`), 0644); err != nil {
		t.Fatal(err)
	}
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	for _, operation := range []*model.Operation{
		{Action: "plugin-custom", Context: map[string]any{"boxID": boxID}},
		{Action: "update", ID: boxID},
		{Action: "insertAttrViewBlock", Srcs: []map[string]any{{"id": boxID}}},
	} {
		if err := holdTransactionEncryptedBoxRequests(context, []*model.Transaction{{DoOperations: []*model.Operation{operation}}}); err == nil {
			t.Fatalf("locked notebook must reject operation %s", operation.Action)
		}
	}
}
