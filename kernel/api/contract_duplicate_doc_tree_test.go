//go:build (sqlcipher || libsqlcipher) && cgo

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractDuplicateDocTree(t *testing.T) {
	const helper = "SIYUAN_TEST_DUPLICATE_DOC_TREE"
	if os.Getenv(helper) != "1" {
		// 隔离数据库、密钥及异步索引，不影响开发中的内核。
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractDuplicateDocTree$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("document tree subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.WorkspaceDir = root
	util.ServerURL = &url.URL{Scheme: "http"}
	util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "temp"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath, util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, util.DBName), filepath.Join(util.TempDir, "history.db"), filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	model.Conf.NotebookCrypto, model.Conf.Sync, model.Conf.FileTree = conf.NewNotebookCrypto(), conf.NewSync(), conf.NewFileTree()
	model.Conf.Editor, model.Conf.Export, model.Conf.Search = conf.NewEditor(), conf.NewExport(), conf.NewSearch()
	model.Conf.Api = &conf.API{Token: "duplicate-tree-test"}
	model.Conf.AccessAuthCode = "application-password"
	langData, err := os.ReadFile(filepath.Join("..", "..", "app", "appearance", "langs", "en.json"))
	if err != nil {
		t.Fatal(err)
	}
	var language struct {
		Time          map[string]any `json:"_time"`
		AttributeView map[string]any `json:"_attrView"`
	}
	if err = json.Unmarshal(langData, &language); err != nil {
		t.Fatal(err)
	}
	util.TimeLangs["en"] = language.Time
	util.Lang = "en"
	util.AttrViewLangs["en"] = language.AttributeView
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("duplicate-tree-test", cookie.NewStore([]byte("duplicate-tree-session-test-key"))))
	ServeAPI(engine)
	const endpoint = "/api/filetree/duplicateDocTree"
	request := func(id string) *http.Request {
		ret := httptest.NewRequest("POST", endpoint, strings.NewReader(`{"id":"`+id+`"}`))
		ret.Header.Set("Authorization", "Token duplicate-tree-test")
		return ret
	}
	post := func(id string, success bool) apicontract.FileTreeDuplicateData {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request(id))
		requireAPIContract(t, "POST", endpoint, recorder)
		var response struct {
			Code int                               `json:"code"`
			Data apicontract.FileTreeDuplicateData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || (response.Code == 0) != success {
			t.Fatalf("unexpected duplicate response: %s, %v", recorder.Body.String(), err)
		}
		return response.Data
	}
	fixture := func(boxID string) (*parse.Tree, *parse.Tree) {
		t.Helper()
		source := treenode.NewTree(boxID, "/"+ast.NewNodeID()+".sy", "/Source", "Source")
		child := treenode.NewTree(boxID, "/"+source.ID+"/"+ast.NewNodeID()+".sy", "/Source/Child", "Child")
		source.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: child.ID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Child"})
		for _, tree := range []*parse.Tree{source, child} {
			if _, err := filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
		}
		return source, child
	}
	checkCopy := func(data apicontract.FileTreeDuplicateData, source *parse.Tree) {
		t.Helper()
		copyTree, _, err := filesys.ReadTreeSnapshot(data.Notebook, data.Path)
		if err != nil || data.Notebook != source.Box || copyTree.ID != data.ID || copyTree.HPath != data.HPath {
			t.Fatalf("invalid copy response or file: %+v, %v", data, err)
		}
		entries, err := os.ReadDir(filepath.Join(util.DataDir, data.Notebook, data.ID))
		if err != nil || len(entries) != 1 {
			t.Fatalf("copied child missing: %v", err)
		}
		childID := strings.TrimSuffix(entries[0].Name(), ".sy")
		if copyTree.Root.FirstChild.FirstChild.TextMarkBlockRefID != childID {
			t.Fatal("cross-document reference did not target the copied child")
		}
		if _, _, err = filesys.ReadTreeSnapshot(data.Notebook, "/"+data.ID+"/"+entries[0].Name()); err != nil {
			t.Fatal(err)
		}
	}
	box := &model.Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err = box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	source, _ := fixture(box.ID)
	checkCopy(post(source.ID, true), source)
	post(source.Root.FirstChild.ID, false)
	post(ast.NewNodeID(), false)
	util.ReadOnly = true
	post(source.ID, false)
	util.ReadOnly = false
	unauthorized := request(source.ID)
	unauthorized.Header.Del("Authorization")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, unauthorized)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated copy admitted: %s", recorder.Body.String())
	}

	const password = "duplicate-password"
	if err = model.EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := model.CreateEncryptedBox("Encrypted copy", password)
	if err != nil {
		t.Fatal(err)
	}
	defer model.LockBox(boxID)
	source, child := fixture(boxID)
	view := av.NewAttributeView(ast.NewNodeID())
	rowID := ast.NewNodeID()
	view.GetBlockKeyValues().Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: view.GetBlockKey().ID,
		BlockID: rowID, Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: source.Root.FirstChild.ID, Content: "Original bound row"}}}
	view.Views[0].ItemIDs = []string{rowID}
	av.SetAVBoxID(view.ID, boxID)
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	viewNode := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: view.ID, AttributeViewType: "table"}
	viewNode.SetIALAttr("id", viewNode.ID)
	source.Root.AppendChild(viewNode)
	if _, err = filesys.WriteTree(source); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(source)
	av.UpsertBlockRel(view.ID, viewNode.ID)
	viewPath := filepath.Join(util.DataDir, boxID, "storage", "av", view.ID+".json")
	viewBefore, _ := os.ReadFile(viewPath)
	sourceData, _ := os.ReadFile(filepath.Join(util.DataDir, boxID, source.Path))
	childPath := filepath.Join(util.DataDir, boxID, child.Path)
	childData, _ := os.ReadFile(childPath)
	writer := &blockedBlockResponseWriter{ResponseRecorder: httptest.NewRecorder(), ready: make(chan []byte, 1), proceed: make(chan struct{})}
	var release sync.Once
	defer release.Do(func() { close(writer.proceed) })
	done := make(chan struct{})
	go func() { engine.ServeHTTP(writer, request(source.ID)); close(done) }()
	var body []byte
	select {
	case body = <-writer.ready:
	case <-time.After(10 * time.Second):
		t.Fatal("copy response never reached writer")
	}
	var response struct {
		Code int                               `json:"code"`
		Data apicontract.FileTreeDuplicateData `json:"data"`
	}
	if err = json.Unmarshal(body, &response); err != nil || response.Code != 0 {
		t.Fatalf("encrypted copy failed: %s, %v", body, err)
	}
	checkCopy(response.Data, source)
	viewAfter, _ := os.ReadFile(viewPath)
	rels := av.GetBlockRels()[view.ID]
	if !bytes.Equal(viewBefore, viewAfter) || len(rels) != 2 {
		t.Fatal("encrypted mirror changed database rows or omitted its new carrier")
	}
	mirrorPath := filepath.Join(util.DataDir, boxID, "storage", "av", "blocks.msgpack")
	mirrorData, _ := os.ReadFile(mirrorPath)
	if !util.IsCiphertext(mirrorData) {
		t.Fatal("encrypted mirror relations leaked plaintext")
	}
	copiedData, _ := os.ReadFile(filepath.Join(util.DataDir, boxID, response.Data.Path))
	if json.Valid(copiedData) || bytes.Contains(copiedData, []byte("Duplicated")) {
		t.Fatal("encrypted copy leaked plaintext")
	}
	locked := make(chan struct{})
	go func() { model.LockBox(boxID); close(locked) }()
	early := false
	select {
	case <-locked:
		early = true
	case <-time.After(300 * time.Millisecond):
	}
	release.Do(func() { close(writer.proceed) })
	<-done
	select {
	case <-locked:
	case <-time.After(10 * time.Second):
		t.Fatal("locking did not complete after response")
	}
	if early {
		t.Fatal("copy lease ended before response serialization")
	}
	requireAPIContract(t, "POST", endpoint, writer.ResponseRecorder)
	post(source.ID, false)
	if err = model.UnlockBox(boxID, password, (&model.Box{ID: boxID}).GetConf().BoxCrypt); err != nil {
		t.Fatal(err)
	}
	if _, err = model.Mount(boxID); err != nil {
		t.Fatal(err)
	}
	checkCopy(response.Data, source)
	for p, before := range map[string][]byte{source.Path: sourceData, child.Path: childData} {
		after, _ := os.ReadFile(filepath.Join(util.DataDir, boxID, p))
		if !bytes.Equal(before, after) {
			t.Fatal("copy or lock cycle rewrote encrypted source")
		}
	}
	beforeEntries, _ := os.ReadDir(filepath.Join(util.DataDir, boxID))
	corrupt := append([]byte(nil), childData...)
	corrupt[len(corrupt)-1] ^= 1
	if err = os.WriteFile(childPath, corrupt, 0644); err != nil {
		t.Fatal(err)
	}
	post(source.ID, false)
	afterEntries, _ := os.ReadDir(filepath.Join(util.DataDir, boxID))
	preserved, _ := os.ReadFile(childPath)
	if len(beforeEntries) != len(afterEntries) || !bytes.Equal(corrupt, preserved) {
		t.Fatal("authentication failure created a partial copy or changed corrupt source")
	}
	if err = os.WriteFile(childPath, childData, 0644); err != nil {
		t.Fatal(err)
	}
	// 缓存中已有定义时，磁盘认证失败仍必须拒绝复制，并补偿已写入的文档和排序。
	sortPath := filepath.Join(util.DataDir, boxID, ".siyuan", "sort.json")
	sortBefore, _ := os.ReadFile(sortPath)
	mirrorBefore, _ := os.ReadFile(mirrorPath)
	corruptView := append([]byte(nil), viewBefore...)
	corruptView[len(corruptView)-1] ^= 1
	if err = os.WriteFile(viewPath, corruptView, 0644); err != nil {
		t.Fatal(err)
	}
	post(source.ID, false)
	sortAfter, _ := os.ReadFile(sortPath)
	mirrorAfter, _ := os.ReadFile(mirrorPath)
	afterEntries, _ = os.ReadDir(filepath.Join(util.DataDir, boxID))
	preserved, _ = os.ReadFile(viewPath)
	if !bytes.Equal(sortBefore, sortAfter) || !bytes.Equal(mirrorBefore, mirrorAfter) ||
		len(beforeEntries) != len(afterEntries) || !bytes.Equal(corruptView, preserved) {
		t.Fatal("database authentication failure left a partial copy or changed source metadata")
	}
	if err = os.WriteFile(viewPath, viewBefore, 0644); err != nil {
		t.Fatal(err)
	}
}

func TestAPIContractDuplicateDocTreeRejectsReader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	model.Conf = &model.AppConf{Lang: "en"}
	t.Cleanup(func() { model.Conf = previousConf })
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader); c.Next() })
	ServeAPI(engine)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/filetree/duplicateDocTree", strings.NewReader(`{}`)))
	if recorder.Code != http.StatusForbidden || recorder.Body.Len() != 0 {
		t.Fatalf("reader request reached copy handler: %s", recorder.Body.String())
	}
}
