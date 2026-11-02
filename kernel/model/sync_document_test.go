// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncDocumentExitPreflight(t *testing.T) {
	repo := newCheckoutSourceTestRepo(t)
	previousDataDir := util.DataDir
	util.DataDir = repo.DataPath
	t.Cleanup(func() { util.DataDir = previousDataDir })
	document := checkoutSourceBox + "/" + checkoutSourceDocument
	writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+documentaddressing.ConfigPath, []byte(`{}`), 10)
	writeCheckoutSourceTestFile(t, repo, document, []byte(`{"Spec":"999","Properties":{"title":"Future"}}`), 10)
	hooks, _ := exitSyncHooks(repo, context.Background())
	plan := &dejavu.CheckoutPlan{Removes: []*entity.File{{Path: "/" + document}}}
	if err := hooks.Preflight(plan); err != nil {
		t.Fatal("exit sync interpreted unsupported document content", err)
	}
	plan.Removes[0].Path += "/../alias.sy"
	if err := hooks.Preflight(plan); !errors.Is(err, documentaddressing.ErrInvalid) {
		t.Fatal("exit sync accepted a noncanonical document path", err)
	}
}

func TestSyncDocumentOpaqueRoundTrip(t *testing.T) {
	previousConf, previousConfDir := Conf, util.ConfDir
	t.Cleanup(func() { Conf, util.ConfDir = previousConf, previousConfDir })
	Conf = &AppConf{Lang: "en"}
	util.ConfDir = t.TempDir()
	base := t.TempDir()
	newRepo := func(device string) *dejavu.Repo {
		dir := filepath.Join(base, device)
		backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: "main", RepoPath: filepath.Join(dir, "repo"),
			AvailableSize: 1 << 30, Local: &cloud.ConfLocal{Endpoint: filepath.Join(base, "cloud")}}})
		repo, err := dejavu.NewRepo(filepath.Join(dir, "data"), filepath.Join(dir, "repo"), filepath.Join(dir, "history"),
			filepath.Join(dir, "temp"), device, device, "windows", []byte("0123456789abcdef0123456789abcdef"), nil, backend)
		if err != nil {
			t.Fatal(err)
		}
		repo.SetCheckoutHooks(dejavu.CheckoutHooks{Preflight: syncDocumentPreflight(repo)})
		return repo
	}
	source, target := newRepo("source"), newRepo("target")
	document := checkoutSourceBox + "/" + checkoutSourceDocument
	ordinary := checkoutSourceBox + "/20261102000000-compat1.sy"
	removed := checkoutSourceBox + "/20261102000000-remove1.sy"
	for _, repo := range []*dejavu.Repo{source, target} {
		writeCheckoutSourceTestFile(t, repo, document, []byte(`{"Spec":"2","Properties":{"title":"Old"}}`), 10)
		writeCheckoutSourceTestFile(t, repo, ordinary, []byte(`{"Spec":"2","Properties":{"title":"Compatible"}}`), 10)
		writeCheckoutSourceTestFile(t, repo, removed, []byte(`{"Spec":"999","Properties":{"title":"Remove"}}`), 10)
		if _, err := repo.Index("initial", true, nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := source.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := target.Sync(nil); err != nil {
		t.Fatal(err)
	}
	future := []byte("\xef\xbb\xbf" + `{"Spec":"999","DocumentTitle":{"format":"future","content":"opaque"}}`)
	compatible := []byte(`{"Spec":"2","Properties":{"title":"Updated compatible"}}`)
	writeCheckoutSourceTestFile(t, source, document, future, 20)
	writeCheckoutSourceTestFile(t, source, ordinary, compatible, 20)
	if err := os.Remove(filepath.Join(source.DataPath, filepath.FromSlash(removed))); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Index("remote update", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := source.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := target.SyncDownload(nil); err != nil {
		t.Fatal("new document format blocked download", err)
	}
	for name, expected := range map[string][]byte{document: future, ordinary: compatible} {
		actual, err := os.ReadFile(filepath.Join(target.DataPath, filepath.FromSlash(name)))
		if err != nil || !bytes.Equal(actual, expected) {
			t.Fatal("download changed source bytes", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(target.DataPath, filepath.FromSlash(removed))); !os.IsNotExist(err) {
		t.Fatal("sync did not apply remote deletion", err)
	}
	if _, err := target.Index("after download", true, nil); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		changes, _, err := target.Sync(nil)
		if err != nil || changes.DataChanged() {
			t.Fatal("unchanged opaque documents produced another diff", err, changes)
		}
	}
}
