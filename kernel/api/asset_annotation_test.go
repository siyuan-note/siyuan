// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func annotationContractEngine() *gin.Engine {
	engine := gin.New()
	engine.Use(boxLeaseMiddleware, func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator); c.Next() })
	engine.POST("/api/asset/setFileAnnotation", setFileAnnotation)
	engine.POST("/api/asset/getFileAnnotation", getFileAnnotation)
	return engine
}

func annotationContractSave(t *testing.T, engine *gin.Engine, path, data string, base *string) (int, string) {
	t.Helper()
	body, err := json.Marshal(apicontract.SetAssetAnnotationRequest{Path: path, Data: data, BaseData: base})
	if err != nil {
		t.Fatal(err)
	}
	// A nil optional pointer must be omitted, as real legacy callers do.
	if base == nil {
		body, _ = json.Marshal(map[string]string{"path": path, "data": data})
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/setFileAnnotation", bytes.NewReader(body)))
	requireAPIContract(t, "POST", "/api/asset/setFileAnnotation", recorder)
	var response struct {
		Code int
		Msg  string
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Code, response.Msg
}

func TestAssetAnnotationContractMerge(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	if err := os.WriteFile(filepath.Join(assets, "fixture.pdf"), []byte("PDF"), 0600); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(assets, "fixture.pdf.sya")
	engine := annotationContractEngine()
	base := `{"s":{"content":"original"}}`
	for _, test := range []struct {
		name, first, second, want string
		conflict                  bool
	}{
		{"distinct additions", `{"s":{"content":"original"},"a":{"content":"A"}}`, `{"s":{"content":"original"},"b":{"content":"B"}}`, `{"s":{"content":"original"},"a":{"content":"A"},"b":{"content":"B"}}`, false},
		{"edit preserves additions", `{"s":{"content":"original"},"a":{"content":"A"}}`, `{"s":{"content":"edited"}}`, `{"s":{"content":"edited"},"a":{"content":"A"}}`, false},
		{"delete last cached annotation", `{"s":{"content":"original"},"a":{"content":"A"}}`, `{}`, `{"a":{"content":"A"}}`, false},
		{"same annotation edit", `{"s":{"content":"new"}}`, `{"s":{"content":"other"}}`, `{"s":{"content":"new"}}`, true},
		{"stale delete", `{"s":{"content":"new"}}`, `{}`, `{"s":{"content":"new"}}`, true},
		{"edit deleted annotation", `{}`, `{"s":{"content":"new"}}`, `{}`, true},
		{"same addition ID", `{"s":{"content":"original"},"a":{"content":"A"}}`, `{"s":{"content":"original"},"a":{"content":"B"}}`, `{"s":{"content":"original"},"a":{"content":"A"}}`, true},
		{"idempotent edit", `{"s":{"content":"new"}}`, `{"s":{"content":"new"}}`, `{"s":{"content":"new"}}`, false},
		{"idempotent delete", `{}`, `{}`, `{}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if code, msg := annotationContractSave(t, engine, "assets/fixture.pdf.sya", base, nil); code != 0 {
				t.Fatalf("legacy setup: %d %s", code, msg)
			}
			if code, msg := annotationContractSave(t, engine, "assets/fixture.pdf.sya", test.first, &base); code != 0 {
				t.Fatalf("first viewer: %d %s", code, msg)
			}
			before, _ := os.ReadFile(file)
			code, msg := annotationContractSave(t, engine, "assets/fixture.pdf.sya", test.second, &base)
			if (code != 0) != test.conflict || (test.conflict && msg != errAnnotationConflict.Error()) {
				t.Fatalf("second viewer: %d %s", code, msg)
			}
			data, err := os.ReadFile(file)
			if test.conflict && !bytes.Equal(before, data) {
				t.Fatal("conflict changed original bytes")
			}
			if test.want == "{}" {
				if !os.IsNotExist(err) {
					t.Fatalf("empty mapping must be removed: %v", err)
				}
				return
			}
			actual, err := parseFileAnnotations(string(data))
			if err != nil {
				t.Fatal(err)
			}
			want, _ := parseFileAnnotations(test.want)
			if !reflect.DeepEqual(actual, want) {
				t.Fatalf("got %s, want %s", data, test.want)
			}
		})
	}
	for _, invalid := range []string{"null", "[]", "broken"} {
		if err := os.WriteFile(file, []byte("corrupt source"), 0600); err != nil {
			t.Fatal(err)
		}
		if code, _ := annotationContractSave(t, engine, "assets/fixture.pdf.sya", "{}", &invalid); code == 0 {
			t.Fatal("invalid baseline was accepted")
		}
		if code, _ := annotationContractSave(t, engine, "assets/fixture.pdf.sya", "{}", new("{}")); code == 0 {
			t.Fatal("corrupt source was overwritten")
		}
		if data, _ := os.ReadFile(file); string(data) != "corrupt source" {
			t.Fatal("invalid input changed source")
		}
	}
	// Competing edits from the same baseline must serialize into one success.
	annotationContractSave(t, engine, "assets/fixture.pdf.sya", base, nil)
	var wg sync.WaitGroup
	results := make(chan int, 2)
	for _, data := range []string{`{"s":{"content":"one"}}`, `{"s":{"content":"two"}}`} {
		wg.Go(func() {
			code, _ := annotationContractSave(t, engine, "assets/fixture.pdf.sya", data, &base)
			results <- code
		})
	}
	wg.Wait()
	if first, second := <-results, <-results; first+second != -1 {
		t.Fatalf("concurrent results: %d, %d", first, second)
	}
}

func TestAssetAnnotationContractEncryptedMerge(t *testing.T) {
	const child = "SIYUAN_TEST_ANNOTATION_ENCRYPTED_MERGE"
	if os.Getenv(child) == "" {
		command := exec.Command(os.Args[0], "-test.run=^TestAssetAnnotationContractEncryptedMerge$", "-test.timeout=60s", "-test.v")
		command.Env = append(os.Environ(), child+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("%v\n%s", err, output)
		}
		return
	}
	setupAssetContractWorkspace(t)
	root := util.WorkspaceDir
	util.TempDir, util.ConfDir, util.HistoryDir = filepath.Join(root, "temp"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath, util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, "siyuan.db"), filepath.Join(util.TempDir, "history.db"), filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, directory := range []string{util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.Search.Store(conf.NewSearch())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	if err := sql.InitAssetContentDatabase(true); err != nil {
		t.Fatal(err)
	}
	defer sql.CloseDatabase()
	if err := model.EnableEncryptedNotebook("annotation-password"); err != nil {
		t.Fatal(err)
	}
	boxID, err := model.CreateEncryptedBox("Annotations", "annotation-password")
	if err != nil {
		t.Fatal(err)
	}
	defer model.LockBox(boxID)
	dek, err := model.GetDEKIfUnlocked(boxID)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(dek)
	asset := filepath.Join(util.DataDir, boxID, "assets", "fixture.pdf")
	if err = os.MkdirAll(filepath.Dir(asset), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(asset, []byte("PDF"), 0600); err != nil {
		t.Fatal(err)
	}
	file := asset + ".sya"
	// Supported existing authenticated format, created without the new API.
	base := `{"s":{"content":"old"}}`
	ciphertext, err := model.EncryptAsset(boxID, filepath.Base(file), filepath.Base(file), dek, []byte(base))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	engine := annotationContractEngine()
	path := "assets/fixture.pdf?box=" + boxID + ".sya"
	for _, data := range []string{`{"s":{"content":"old"},"a":{"content":"A"}}`, `{"s":{"content":"old"},"b":{"content":"B"}}`} {
		if code, msg := annotationContractSave(t, engine, path, data, &base); code != 0 {
			t.Fatalf("encrypted merge: %d %s", code, msg)
		}
	}
	stored, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := model.DecryptAsset(boxID, filepath.Base(file), dek, stored)
	if err != nil {
		t.Fatal(err)
	}
	annotations, err := parseFileAnnotations(string(plain))
	if err != nil || len(annotations) != 3 || bytes.Contains(stored, []byte("content")) {
		t.Fatalf("encrypted result: %s, %v", plain, err)
	}
	corrupt := append([]byte(nil), stored...)
	corrupt[len(corrupt)-1] ^= 1
	if err = os.WriteFile(file, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if code, _ := annotationContractSave(t, engine, path, "{}", &base); code == 0 {
		t.Fatal("corrupt ciphertext deletion succeeded")
	}
	if actual, _ := os.ReadFile(file); !bytes.Equal(actual, corrupt) {
		t.Fatal("authentication failure changed ciphertext")
	}
	if err = os.WriteFile(file, stored, 0600); err != nil {
		t.Fatal(err)
	}
	model.LockBox(boxID)
	if code, _ := annotationContractSave(t, engine, path, "{}", &base); code == 0 {
		t.Fatal("locked notebook mutation succeeded")
	}
	if actual, _ := os.ReadFile(file); !bytes.Equal(actual, stored) {
		t.Fatal("locked save changed ciphertext")
	}
	if err = model.UnlockBox(boxID, "annotation-password", (&model.Box{ID: boxID}).GetConf().BoxCrypt); err != nil {
		t.Fatal(err)
	}
	if _, err = readFileAnnotationData(file, boxID); err != nil {
		t.Fatalf("unlock recovery: %v", err)
	}
}
