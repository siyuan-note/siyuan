//go:build fts5

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractDocHistorySnapshots(t *testing.T) {
	const helper = "SIYUAN_TEST_HISTORY_SNAPSHOTS"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractDocHistorySnapshots$", "-test.v")
		cmd.Env = append(os.Environ(), helper+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("history snapshot contract failed: %v\n%s", err, output)
		}
		return
	}
	root, lockedBoxID := setupArchiveWorkspace(t)
	util.TempDir = filepath.Join(root, "temp")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.RepoDir = filepath.Join(root, "repo")
	util.HistoryDBPath = filepath.Join(root, "history.db")
	util.DBPath = filepath.Join(root, "siyuan.db")
	util.AssetContentDBPath = filepath.Join(root, "assets.db")
	util.BlockTreeDBPath = filepath.Join(root, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.Repo = conf.NewRepo()
	model.Conf.Repo.Key = bytes.Repeat([]byte{1}, 32)
	model.Conf.Sync = conf.NewSync()
	model.Conf.System = conf.NewSystem()
	model.Conf.Editor = conf.NewEditor()
	model.Conf.Export = conf.NewExport()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	const id = "20260928100000-abcdefg"
	const box = "20260928100000-normal1"
	const created = "1790560800"
	data := []byte(`{"ID":"` + id + `","Spec":"2","Type":"NodeDocument","Properties":{"id":"` + id + `","title":"History"},"Children":[]}`)
	historyPath := "2026-09-28-100000-update/" + box + "/" + id + ".sy"
	for _, p := range []string{filepath.Join(util.HistoryDir, historyPath), filepath.Join(util.DataDir, box, id+".sy")} {
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	sql.IndexHistoriesQueue([]*sql.History{
		{ID: id, Type: model.HistoryTypeDoc, Op: "update", Title: "History", Path: historyPath, Created: created},
		{ID: "20260928100000-locked1", Type: model.HistoryTypeDoc, Op: "update", Title: "Locked", Path: "2026-09-28-100000-update/" + lockedBoxID + "/20260928100000-locked1.sy", Created: created},
	})
	sql.FlushHistoryQueue()
	repo, err := dejavu.NewRepo(util.DataDir, util.RepoDir, util.HistoryDir, util.TempDir, "test", "test", "test", model.Conf.Repo.Key, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	index, err := repo.Index("memo\nline", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.AddTag(index.ID, "release"); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	const endpoint = "/api/history/getDocHistorySnapshots"
	engine.POST(endpoint, getDocHistorySnapshots)
	engine.POST("/api/repo/getRepoSnapshots", getRepoSnapshots)
	engine.POST("/api/repo/getRepoDocHistory", getRepoDocHistory)
	for _, include := range []bool{false, true} {
		body, _ := json.Marshal(map[string]interface{}{"id": index.ID, "page": 1, "includeFiles": include})
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/repo/getRepoSnapshots", bytes.NewReader(body)))
		requireAPIContract(t, "POST", "/api/repo/getRepoSnapshots", recorder)
		var response struct {
			Code int                           `json:"code"`
			Data apicontract.RepoSnapshotsData `json:"data"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || len(response.Data.Snapshots) != 1 {
			t.Fatalf("snapshot detail: %s, %v", recorder.Body.String(), err)
		}
		if (len(response.Data.Snapshots[0].Files) > 0) != include {
			t.Fatalf("unexpected file metadata: %s", recorder.Body.String())
		}
		if tags := response.Data.Snapshots[0].Tags; len(tags) != 1 || tags[0] != "release" {
			t.Fatalf("missing snapshot tags: %s", recorder.Body.String())
		}
	}
	for _, test := range []struct {
		body string
		code int
	}{
		{`{"id":"` + id + `","created":["` + created + `"]}`, 0},
		{`{"id":"` + id + `","created":["` + created + `"],"op":"update"}`, 0},
		{`{"id":"20260928100000-locked1","created":["` + created + `"]}`, -1},
		{`{"id":"` + id + `","created":["0"]}`, -1},
		{`{"id":"` + id + `","created":[]}`, -1},
		{`{"id":"` + id + `","created":["` + created + `"],"op":"invalid"}`, -1},
		{`{"id":"` + id + `","created":[null]}`, -1},
		{`{}`, -1},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", endpoint, strings.NewReader(test.body)))
		requireAPIContract(t, "POST", endpoint, recorder)
		var response struct {
			Code int                                 `json:"code"`
			Data apicontract.DocHistorySnapshotsData `json:"data"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != test.code {
			t.Fatalf("unexpected response: %s: %s, %v", test.body, recorder.Body.String(), err)
		}
		if test.code == 0 {
			if len(response.Data.Histories) != 1 || len(response.Data.Histories[0].Snapshots) != 1 {
				t.Fatalf("missing association: %s", recorder.Body.String())
			}
			snapshot := response.Data.Histories[0].Snapshots[0]
			if snapshot.ID != index.ID || snapshot.Memo != "memo\nline" || len(snapshot.Tags) != 1 || snapshot.Tags[0] != "release" {
				t.Fatalf("metadata lost: %+v", snapshot)
			}
		}
	}
	for _, tagged := range []bool{true, false} {
		if !tagged {
			if err = repo.RemoveTag("release"); err != nil {
				t.Fatal(err)
			}
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/repo/getRepoDocHistory", strings.NewReader(`{"id":"`+id+`","page":1}`)))
		requireAPIContract(t, "POST", "/api/repo/getRepoDocHistory", recorder)
		var response struct {
			Code int                            `json:"code"`
			Data apicontract.RepoDocHistoryData `json:"data"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || len(response.Data.Files) != 1 {
			t.Fatalf("repository document history: %s, %v", recorder.Body.String(), err)
		}
		associations := response.Data.Files[0].Snapshots
		if associations == nil || (len(associations) == 1) != tagged {
			t.Fatalf("repository associations: %s", recorder.Body.String())
		}
		if tagged && (associations[0].ID != index.ID || associations[0].FileID != response.Data.Files[0].FileID || associations[0].Memo != "memo\nline" || associations[0].Tags[0] != "release") {
			t.Fatalf("repository association metadata: %s", recorder.Body.String())
		}
	}
}
