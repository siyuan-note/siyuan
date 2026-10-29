// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build sqlcipher

package tools

import (
	"bytes"
	"context"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDecisionImageEncryptedAssets(t *testing.T) {
	const helper = "SIYUAN_TEST_DECISION_ENCRYPTED_IMAGES"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDecisionImageEncryptedAssets$", "-test.v")
		cmd.Env = append(os.Environ(), helper+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("encrypted image subprocess: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.TempDir = filepath.Join(root, "data"), filepath.Join(root, "temp")
	util.ConfDir, util.HistoryDir = filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(util.TempDir, "siyuan.db"), filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.System.Store(conf.NewSystem())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Export.Store(conf.NewExport())
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	defer treenode.CloseDatabase()
	const password = "decision image fixture password"
	if err := model.EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := model.CreateEncryptedBox("Decision image", password)
	if err != nil {
		t.Fatal(err)
	}
	defer model.LockBox(boxID)
	dek, err := model.GetDEK(boxID)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(dek)
	plain := decisionImageFixture(t)
	ciphertext, err := model.EncryptAsset(boxID, "selected.png", "selected.png", dek, plain)
	if err != nil {
		t.Fatal(err)
	}
	asset := filepath.Join(util.DataDir, boxID, "assets", "selected.png")
	if err := os.MkdirAll(filepath.Dir(asset), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(asset, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	input := decisionImageInput{AssetPath: "assets/selected.png", Notebook: boxID}
	images, err := prepareDecisionImages(context.Background(), []decisionImageInput{input})
	if err != nil || len(images) != 1 {
		t.Fatalf("authenticated encrypted image unavailable: %v", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(images[0].URL, "data:image/png;base64,"))
	if err != nil || !bytes.Equal(decoded, plain) {
		t.Fatal("encrypted image changed", err)
	}
	args := decisionArgs(t, `{"items":[{"images":[{"notebook":"`+boxID+`"}]}],"questions":[{"images":[{"notebook":"`+boxID+`"}]}]}`)
	if len(decisionBoxLeases(args)) != 2 {
		t.Fatal("shared or question image lease omitted")
	}
	corrupted := append([]byte(nil), ciphertext...)
	corrupted[len(corrupted)/2] ^= 1
	if err := os.WriteFile(asset, corrupted, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareDecisionImages(context.Background(), []decisionImageInput{input}); err == nil {
		t.Fatal("corrupted ciphertext accepted")
	}
	if actual, err := os.ReadFile(asset); err != nil || !bytes.Equal(actual, corrupted) {
		t.Fatal("failed read modified ciphertext", err)
	}
	if err := os.WriteFile(asset, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	model.LockBox(boxID)
	if _, err := prepareDecisionImages(context.Background(), []decisionImageInput{input}); err == nil {
		t.Fatal("locked encrypted image accepted")
	}
	boxConf := (&model.Box{ID: boxID}).GetConf()
	if err := model.UnlockBox(boxID, password, boxConf.BoxCrypt); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareDecisionImages(context.Background(), []decisionImageInput{input}); err != nil {
		t.Fatal("existing image not recoverable after unlocking", err)
	}
	if actual, err := os.ReadFile(asset); err != nil || !bytes.Equal(actual, ciphertext) {
		t.Fatal("reading changed source ciphertext", err)
	}
}
