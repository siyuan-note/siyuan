//go:build (sqlcipher || libsqlcipher) && cgo

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
	"github.com/gin-gonic/gin"
	pdfapi "github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractExportNotebookResponseLease(t *testing.T) {
	mode := os.Getenv("SIYUAN_TEST_EXPORT_RESPONSE_LEASE")
	if mode != "temp" && mode != "pdf" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		for _, childMode := range []string{"temp", "pdf"} {
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractExportNotebookResponseLease$", "-test.v")
			command.Env = append(os.Environ(), "SIYUAN_TEST_EXPORT_RESPONSE_LEASE="+childMode)
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("export lease subprocess (%s) failed: %v\n%s", childMode, err, output)
			}
		}
		return
	}
	root := t.TempDir()
	util.HomeDir = root
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
	{
		confSectionValue0, confSectionValue1, confSectionValue2 := conf.NewNotebookCrypto(), conf.NewSync(), conf.NewFileTree()
		model.Conf.NotebookCrypto = confSectionValue0
		model.Conf.Sync.Store(confSectionValue1)
		model.Conf.FileTree.Store(confSectionValue2)
	}
	{
		confSectionValue0, confSectionValue1, confSectionValue2 := conf.NewEditor(), conf.NewExport(), conf.NewSearch()
		model.Conf.Editor.Store(confSectionValue0)
		model.Conf.Export.Store(confSectionValue1)
		model.Conf.Search.Store(confSectionValue2)
	}
	model.Conf.Appearance.Store(conf.NewAppearance())
	model.Conf.FileTree.Load().BoxDocEnabled = true
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	if err := model.EnableEncryptedNotebook("export-password"); err != nil {
		t.Fatal(err)
	}
	boxID, err := model.CreateEncryptedBox("Export lease", "export-password")
	if err != nil {
		t.Fatal(err)
	}
	defer model.LockBox(boxID)
	tree, err := filesys.LoadTree(boxID, "/"+boxID+".sy", util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	const cover = "https://example.com/encrypted-cover.png"
	tree.Root.SetIALAttr("title-img", `background-image:url("`+cover+`")`)
	paragraph := parse.Parse("", []byte("![body](https://example.com/encrypted-body.png)\n"), util.NewLute().ParseOptions).Root.FirstChild
	paragraph.ID = ast.NewNodeID()
	paragraph.SetIALAttr("id", paragraph.ID)
	tree.Root.AppendChild(paragraph)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	docPath := filepath.Join(util.DataDir, boxID, boxID+".sy")
	before, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"image", "pdf"} {
		for _, exclude := range []bool{false, true} {
			code, msg, raw := exportContractRequest(t, "exportPreviewHTML", exportPreviewHTML,
				fmt.Sprintf(`{"id":%q,%q:true,"excludeTitleImage":%t}`, boxID, mode, exclude))
			var preview apicontract.ExportPreviewHTMLData
			if err := json.Unmarshal(raw, &preview); err != nil || code != 0 ||
				strings.Contains(preview.Content, `<img src="`+cover+`"`) == exclude ||
				!strings.Contains(preview.Content, `<img src="https://example.com/encrypted-body.png"`) {
				t.Fatalf("encrypted preview failed: %d %s %s %v", code, msg, raw, err)
			}
		}
	}
	after, err := os.ReadFile(docPath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("preview changed source ciphertext: %v", err)
	}
	engine := gin.New()
	engine.Use(model.ControlConcurrency, boxLeaseMiddleware)
	engine.POST("/api/export/exportTempContent", exportTempContent)
	engine.POST("/api/export/processPDF", processPDF)
	writer := &blockedBlockResponseWriter{ResponseRecorder: httptest.NewRecorder(), ready: make(chan []byte, 1), proceed: make(chan struct{})}
	var release sync.Once
	defer release.Do(func() { close(writer.proceed) })
	request := httptest.NewRequest("POST", "/api/export/exportTempContent", strings.NewReader(`{"id":"`+boxID+`","content":"EXPORT-SECRET"}`))
	if mode == "pdf" {
		pdfPath := filepath.Join(root, "output.pdf")
		ctx, err := pdfapi.ReadContextFile("../testdata/parsertest.pdf")
		if err != nil {
			t.Fatal(err)
		}
		if err = pdfapi.WriteContextFile(ctx, pdfPath); err != nil {
			t.Fatal(err)
		}
		request = httptest.NewRequest("POST", "/api/export/processPDF", strings.NewReader(
			fmt.Sprintf(`{"id":%q,"path":%q,"removeAssets":true,"watermark":false,"exportAssets":true}`, boxID, pdfPath)))
	}
	done := make(chan struct{})
	go func() { engine.ServeHTTP(writer, request); close(done) }()
	var body []byte
	select {
	case body = <-writer.ready:
	case <-time.After(5 * time.Second):
		t.Fatal("export response never reached writer")
	}
	var response struct {
		Code int                       `json:"code"`
		Data apicontract.ExportURLData `json:"data"`
	}
	if err = json.Unmarshal(body, &response); err != nil || response.Code != 0 || mode == "temp" && !strings.Contains(response.Data.URL, boxID+"/temp/") {
		t.Fatalf("managed export was not produced: %s %v", body, err)
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
	case <-time.After(5 * time.Second):
		t.Fatal("locking did not complete after response")
	}
	if early {
		t.Fatal("encrypted export lease ended before response serialization")
	}
	for _, mode := range []string{"image", "pdf"} {
		baselineCode, _, baseline := exportContractRequest(t, "exportPreviewHTML", exportPreviewHTML,
			fmt.Sprintf(`{"id":%q,%q:true}`, boxID, mode))
		code, _, lockedPreview := exportContractRequest(t, "exportPreviewHTML", exportPreviewHTML,
			fmt.Sprintf(`{"id":%q,%q:true,"excludeTitleImage":true}`, boxID, mode))
		var lockedData apicontract.ExportPreviewHTMLData
		if code != baselineCode || !bytes.Equal(baseline, lockedPreview) ||
			json.Unmarshal(lockedPreview, &lockedData) != nil || lockedData.Content != "" {
			t.Fatalf("locked notebook preview changed or exposed content: %d %s", code, lockedPreview)
		}
	}
	requireAPIContract(t, "POST", request.URL.Path, writer.ResponseRecorder)
	entries, err := os.ReadDir(filepath.Join(util.TempDir, "export", boxID, "temp"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatal("locking retained plaintext export artifacts")
	}
}
