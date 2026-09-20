package tools

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func configureDecisionTest(t *testing.T, endpoint string) {
	t.Helper()
	original := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.AI = conf.NewAI()
	model.Conf.Editor = conf.NewEditor()
	model.Conf.Export = conf.NewExport()
	model.Conf.AI.Decision = &conf.Decision{Enabled: true, Endpoint: endpoint, APIKey: "test-key", Name: "jev-test", Timeout: 1}
	t.Cleanup(func() { model.Conf = original })
}

func decisionArgs(t *testing.T, raw string) map[string]any {
	t.Helper()
	var args map[string]any
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		t.Fatal(err)
	}
	return args
}

func TestDecisionSequentialPartialResults(t *testing.T) {
	var calls, active atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if active.Add(1) != 1 {
			t.Error("decision batch used concurrent requests")
		}
		defer active.Add(-1)
		if calls.Add(1) == 2 {
			w.WriteHeader(429)
			return
		}
		io.WriteString(w, `{"model":"jev-test","answers":{"q":{"type":"noul","noul":0.1}}}`)
	}))
	defer server.Close()
	configureDecisionTest(t, server.URL)
	args := decisionArgs(t, `{"action":"evaluate","items":[{"id":"a","text":"first"},{"id":"b","text":"second"},{"id":"c","text":"third"}],"questions":[{"id":"q","type":"noul","instructions":"Relevant?"}]}`)
	_, validator := LookupToolWithValidator("decision")
	if validator == nil {
		t.Fatal("decision schema did not register")
	}
	if err := validator.ValidateInput(args); err != nil {
		t.Fatalf("valid decision arguments rejected: %v", err)
	}
	result, err := decisionHandler(context.Background(), args)
	if err != nil || !result.IsError || calls.Load() != 2 {
		t.Fatalf("batch failure handling: %+v %v calls=%d", result, err, calls.Load())
	}
	var batch struct {
		Items []decisionItemResult `json:"items"`
	}
	if err = json.Unmarshal([]byte(result.Content[0].Text), &batch); err != nil {
		t.Fatal(err)
	}
	if len(batch.Items) != 3 || batch.Items[0].Status != "completed" || batch.Items[1].Status != "error" || batch.Items[2].Status != "not_run" || batch.Items[1].Result != nil {
		t.Fatalf("successful or failed results confused: %+v", batch)
	}
	model.Conf.AI.Decision.Enabled = false
	result, _ = decisionHandler(context.Background(), args)
	if !result.IsError || calls.Load() != 2 {
		t.Fatal("disabled decision performed requests")
	}
}

func TestDecisionRejectsInvalidBatchBeforeRequest(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer server.Close()
	configureDecisionTest(t, server.URL)
	for _, raw := range []string{
		`{"action":"evaluate","items":[{"id":"a","text":"text"},{"id":"a","text":"duplicate"}],"questions":[{"id":"q","type":"noul","instructions":"Relevant?"}]}`,
		`{"action":"evaluate","items":[{"id":"a","text":"text"}],"questions":[{"id":"q","type":"score","instructions":"Rate","levels":["only"]}]}`,
		`{"action":"evaluate","items":[{"id":"a"}],"questions":[{"id":"q","type":"noul","instructions":"Relevant?"}]}`,
	} {
		result, err := decisionHandler(context.Background(), decisionArgs(t, raw))
		if err != nil || !result.IsError {
			t.Fatalf("invalid batch accepted: %+v %v", result, err)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid batch sent content")
	}
}

func TestDecisionBlockSources(t *testing.T) {
	originalData, originalDB := util.DataDir, util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath = originalData, originalDB
		if originalDB != "" {
			treenode.InitBlockTree(false)
		}
	})
	configureDecisionTest(t, "http://unused.invalid")
	const boxID = "20260920000000-normal1"
	const docID = "20260920000000-doc0001"
	const blockID = "20260920000000-block01"
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Test", docID)
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: blockID}
	paragraph.SetIALAttr("id", blockID)
	content := strings.Repeat("Full source text. ", 100) + "END-MARKER"
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(content)})
	tree.Root.AppendChild(paragraph)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	state, err := decisionItemState(context.Background(), decisionItem{ID: "doc", BlockIDs: []string{docID}}, "task")
	if err != nil || len(state.Blocks) != 1 || !strings.Contains(state.Blocks[0].Markdown, "END-MARKER") {
		t.Fatalf("full document not loaded: %+v %v", state, err)
	}
	state, err = decisionItemState(context.Background(), decisionItem{ID: "block", BlockIDs: []string{blockID}}, "task")
	if err != nil || !strings.Contains(state.Blocks[0].Markdown, content) {
		t.Fatalf("full block not loaded: %+v %v", state, err)
	}
	if _, err = decisionItemState(context.Background(), decisionItem{ID: "missing", BlockIDs: []string{"20260920000000-missing"}}, "task"); err == nil {
		t.Fatal("missing block accepted")
	}
	const lockedBox = "20260920000000-locked1"
	dir := filepath.Join(util.DataDir, lockedBox, ".siyuan")
	if err = os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "conf.json"), []byte(`{"encrypted":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = decisionItemState(context.Background(), decisionItem{ID: "locked", Notebook: lockedBox, BlockIDs: []string{blockID}}, "task"); err == nil {
		t.Fatal("locked notebook accepted")
	}
	args := decisionArgs(t, `{"action":"evaluate","items":[{"id":"locked","notebook":"20260920000000-locked1","blockIDs":["20260920000000-block01"]}],"questions":[{"id":"q","type":"noul","instructions":"Relevant?"}]}`)
	leases := decisionBoxLeases(args)
	if len(leases) != 1 || leases[0] != lockedBox {
		t.Fatal("missing encrypted notebook lease")
	}
	result, _ := decisionHandler(context.Background(), args)
	if !result.IsError || !strings.Contains(result.Content[0].Text, "locked") {
		t.Fatal("locked source reached decision request")
	}
}
