// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const checkoutSourceBox = "20261024000000-checkbx"
const checkoutSourceDocument = "20261024000001-checkdc.sy"

func TestDocumentAddressingCheckoutRejectsWindowsPathAliases(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows filename aliases")
	}
	for _, alias := range []string{
		checkoutSourceBox + "/" + checkoutSourceDocument + ".",
		checkoutSourceBox + "/" + checkoutSourceDocument + " ",
		checkoutSourceBox + "." + "/" + checkoutSourceDocument,
		checkoutSourceBox + "/" + checkoutSourceDocument + "::$DATA",
	} {
		t.Run(alias, func(t *testing.T) {
			repo := newCheckoutSourceTestRepo(t)
			writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+documentaddressing.ConfigPath, []byte(`{}`), 10)
			writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+checkoutSourceDocument,
				[]byte(`{"Spec":"999","Properties":{"title":"Future"}}`), 10)
			original, err := os.Stat(filepath.Join(repo.DataPath, checkoutSourceBox, checkoutSourceDocument))
			if err != nil {
				t.Fatal(err)
			}
			aliased, err := os.Stat(filepath.Join(repo.DataPath, filepath.FromSlash(alias)))
			if err != nil || !os.SameFile(original, aliased) {
				t.Fatal("fixture did not reproduce a Windows alias of the document", err)
			}
			plan := &dejavu.CheckoutPlan{Removes: []*entity.File{{Path: "/" + alias}}}
			if err = documentAddressingPreflight(repo)(plan); !errors.Is(err, documentaddressing.ErrInvalid) {
				t.Fatal("Windows alias bypassed source validation", err)
			}
		})
	}
}

func TestDocumentAddressingCheckoutNativeAttachmentNames(t *testing.T) {
	for _, name := range []string{"assets/report.", "assets/report ", "assets/space /report.txt", "assets/report:data"} {
		t.Run(name, func(t *testing.T) {
			repo := newCheckoutSourceTestRepo(t)
			plan := &dejavu.CheckoutPlan{Upserts: []*entity.File{{Path: "/" + name}}}
			err := documentAddressingPreflight(repo)(plan)
			if runtime.GOOS == "windows" {
				if !errors.Is(err, documentaddressing.ErrInvalid) {
					t.Fatal("noncanonical Windows target was accepted", err)
				}
			} else if err != nil {
				t.Fatal("native attachment name was rejected", err)
			}
		})
	}
}

func TestDocumentAddressingCheckoutRejectsNoncanonicalPaths(t *testing.T) {
	for _, operation := range []string{"upsert", "remove", "metadata alias", "missing slash", "duplicate target", "upsert and remove"} {
		t.Run(operation, func(t *testing.T) {
			repo := newCheckoutSourceTestRepo(t)
			writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+documentaddressing.ConfigPath, []byte(`{}`), 10)
			writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+checkoutSourceDocument,
				[]byte(`{"Spec":"999","Properties":{"title":"Future"}}`), 10)
			file := &entity.File{Path: "/" + checkoutSourceBox + "\\" + checkoutSourceDocument}
			plan := &dejavu.CheckoutPlan{Upserts: []*entity.File{file}}
			if operation == "remove" {
				plan.Upserts, plan.Removes = nil, []*entity.File{file}
			} else if operation == "metadata alias" {
				file.Path = "/" + checkoutSourceBox + "\\.siyuan\\conf.json"
				plan.Upserts = append(plan.Upserts, &entity.File{Path: "/" + checkoutSourceBox + "/" + documentaddressing.ConfigPath})
			} else if operation == "missing slash" {
				file.Path = checkoutSourceBox + "/" + checkoutSourceDocument
			} else if operation == "duplicate target" || operation == "upsert and remove" {
				file.Path = "/" + checkoutSourceBox + "/" + checkoutSourceDocument
				if operation == "duplicate target" {
					plan.Upserts = append(plan.Upserts, &entity.File{Path: file.Path})
				} else {
					plan.Removes = []*entity.File{{Path: file.Path}}
				}
			}
			if err := documentAddressingPreflight(repo)(plan); !errors.Is(err, documentaddressing.ErrInvalid) {
				t.Fatal("noncanonical checkout path bypassed source or metadata validation", err)
			}
		})
	}
}

func newCheckoutSourceTestRepo(t *testing.T) *dejavu.Repo {
	t.Helper()
	previousConf, previousConfDir := Conf, util.ConfDir
	Conf = &AppConf{Lang: "en"}
	base := t.TempDir()
	util.ConfDir = filepath.Join(base, "conf")
	t.Cleanup(func() { Conf, util.ConfDir = previousConf, previousConfDir })
	repo, err := dejavu.NewRepoWithOptions(dejavu.Options{
		DataPath: filepath.Join(base, "data"), RepoPath: filepath.Join(base, "repo"),
		HistoryPath: filepath.Join(base, "history"), TempPath: filepath.Join(base, "temp"),
		DeviceID: "source-preflight", DeviceName: "source-preflight", DeviceOS: "windows",
		AESKey: []byte("0123456789abcdef0123456789abcdef"), HiddenDirectoryNames: []string{".siyuan"},
	})
	if err != nil {
		t.Fatal(err)
	}
	repo.SetCheckoutHooks(documentAddressingCheckoutHooks(repo))
	return repo
}

func writeCheckoutSourceTestFile(t *testing.T, repo *dejavu.Repo, name string, data []byte, tick int64) {
	t.Helper()
	name = filepath.Join(repo.DataPath, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, data, 0600); err != nil {
		t.Fatal(err)
	}
	stamp := time.Unix(1700000000+tick, 0)
	if err := os.Chtimes(name, stamp, stamp); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentAddressingCheckoutSourcePreflight(t *testing.T) {
	ordinary := `{"Spec":"2","Properties":{"title":"Ordinary"}}`
	future := `{"Spec":"999","Properties":{"title":"Future"}}`
	title := `{"Spec":"2","Properties":{"title":{"format":"future"}}}`
	slash := `{"Spec":"6","Properties":{"title":"Parent/Child"}}`
	for _, test := range []struct {
		name, incoming, current, config, floor, document string
		wantErr                                          error
	}{
		{name: "incoming future spec", incoming: future, current: ordinary, wantErr: treenode.ErrSpecTooNew},
		{name: "incoming future title", incoming: title, current: ordinary, wantErr: documentaddressing.ErrInvalidTitle},
		{name: "current future spec", incoming: ordinary, current: future, wantErr: treenode.ErrSpecTooNew},
		{name: "current future title", incoming: ordinary, current: title, wantErr: documentaddressing.ErrInvalidTitle},
		{name: "retired mode does not bypass source", incoming: future, current: ordinary, config: `{"documentAddressingVersion":3}`, wantErr: treenode.ErrSpecTooNew},
		{name: "retired floor does not bypass source", incoming: future, current: ordinary,
			floor: `{"version":1,"notebook":"` + checkoutSourceBox + `","minimumMode":3}`, wantErr: treenode.ErrSpecTooNew},
		{name: "ordinary", incoming: ordinary, current: `{"Spec":"2","Properties":{"title":"Old"}}`},
		{name: "literal slash", incoming: slash, current: ordinary, wantErr: nil},
		{name: "BOM source", incoming: "\xef\xbb\xbf" + ordinary, current: ordinary},
		{name: "recover corrupt source", incoming: ordinary, current: `{"Spec":"2","Properties":`},
		{name: "asset sy", incoming: future, current: ordinary, document: "assets/" + checkoutSourceDocument},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := newCheckoutSourceTestRepo(t)
			document := test.document
			if document == "" {
				document = checkoutSourceBox + "/" + checkoutSourceDocument
			}
			config := test.config
			if config == "" {
				config = `{}`
			}
			writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+documentaddressing.ConfigPath, []byte(config), 10)
			if test.floor != "" {
				writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+documentaddressing.FloorPath, []byte(test.floor), 10)
			}
			writeCheckoutSourceTestFile(t, repo, document, []byte(test.incoming), 10)
			writeCheckoutSourceTestFile(t, repo, "assets/add.txt", []byte("incoming addition"), 10)
			target, err := repo.Index("incoming source", false, nil)
			if err != nil {
				t.Fatal(err)
			}
			writeCheckoutSourceTestFile(t, repo, document, []byte(test.current), 20)
			writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+documentaddressing.ConfigPath, []byte(`{}`), 20)
			if test.floor != "" {
				if err = os.Remove(filepath.Join(repo.DataPath, checkoutSourceBox, documentaddressing.FloorPath)); err != nil {
					t.Fatal(err)
				}
			}
			if err = os.Remove(filepath.Join(repo.DataPath, "assets", "add.txt")); err != nil {
				t.Fatal(err)
			}
			writeCheckoutSourceTestFile(t, repo, "assets/keep.txt", []byte("retained local file"), 20)
			before, err := archiveDirectoryFiles(repo.DataPath)
			if err != nil {
				t.Fatal(err)
			}
			beforeDocument, err := os.Stat(filepath.Join(repo.DataPath, filepath.FromSlash(document)))
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = repo.Checkout(target.ID, nil)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("source preflight: %v, expected %v", err, test.wantErr)
			}
			if test.wantErr != nil {
				after, readErr := archiveDirectoryFiles(repo.DataPath)
				if readErr != nil || !reflect.DeepEqual(before, after) {
					t.Fatal("rejected batch changed a source, addition, or removal", readErr)
				}
				afterDocument, statErr := os.Stat(filepath.Join(repo.DataPath, filepath.FromSlash(document)))
				if statErr != nil || !beforeDocument.ModTime().Equal(afterDocument.ModTime()) {
					t.Fatal("rejected batch changed the source modification time", statErr)
				}
			} else {
				actual, readErr := os.ReadFile(filepath.Join(repo.DataPath, filepath.FromSlash(document)))
				if readErr != nil || !bytes.Equal(actual, []byte(test.incoming)) {
					t.Fatal("checkout changed source bytes", readErr)
				}
				if _, err = os.Stat(filepath.Join(repo.DataPath, "assets", "add.txt")); err != nil {
					t.Fatal("accepted batch did not apply its addition", err)
				}
				if _, err = os.Stat(filepath.Join(repo.DataPath, "assets", "keep.txt")); !os.IsNotExist(err) {
					t.Fatal("accepted batch did not apply its removal", err)
				}
			}
			// 拒绝或采用均不改写仓库中的恢复来源。
			files, err := repo.GetFiles(target)
			if err != nil {
				t.Fatal(err)
			}
			var stored []byte
			for _, file := range files {
				if strings.TrimPrefix(file.Path, "/") == document {
					stored, err = repo.OpenFile(file)
					break
				}
			}
			if err != nil || !bytes.Equal(stored, []byte(test.incoming)) {
				t.Fatal("checkout changed the incoming snapshot", err)
			}
		})
	}
}

func TestDocumentAddressingCheckoutSourceRemoval(t *testing.T) {
	for _, whole := range []bool{false, true} {
		t.Run(map[bool]string{false: "partial", true: "whole notebook"}[whole], func(t *testing.T) {
			repo := newCheckoutSourceTestRepo(t)
			writeCheckoutSourceTestFile(t, repo, "assets/retained.txt", []byte("unchanged"), 10)
			if !whole {
				writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+documentaddressing.ConfigPath, []byte(`{}`), 10)
			}
			writeCheckoutSourceTestFile(t, repo, "assets/add.txt", []byte("incoming addition"), 10)
			target, err := repo.Index("remove unsupported source", false, nil)
			if err != nil {
				t.Fatal(err)
			}
			writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+documentaddressing.ConfigPath, []byte(`{}`), 20)
			writeCheckoutSourceTestFile(t, repo, checkoutSourceBox+"/"+checkoutSourceDocument,
				[]byte(`{"Spec":"999","Properties":{"title":"Future"}}`), 20)
			if err = os.Remove(filepath.Join(repo.DataPath, "assets", "add.txt")); err != nil {
				t.Fatal(err)
			}
			writeCheckoutSourceTestFile(t, repo, "assets/keep.txt", []byte("retained until acceptance"), 20)
			before, err := archiveDirectoryFiles(repo.DataPath)
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = repo.Checkout(target.ID, nil)
			if whole {
				if err != nil {
					t.Fatal("whole notebook deletion was blocked", err)
				}
				if _, err = os.Stat(filepath.Join(repo.DataPath, checkoutSourceBox, checkoutSourceDocument)); !os.IsNotExist(err) {
					t.Fatal("whole notebook deletion retained its document", err)
				}
			} else {
				if !errors.Is(err, treenode.ErrSpecTooNew) {
					t.Fatal("partial deletion accepted an unsupported source", err)
				}
				after, readErr := archiveDirectoryFiles(repo.DataPath)
				if readErr != nil || !reflect.DeepEqual(before, after) {
					t.Fatal("rejected partial deletion changed workspace files", readErr)
				}
			}
		})
	}
}

func TestDocumentAddressingCheckoutPreservesOpaqueEncryptedSource(t *testing.T) {
	for _, futureEnvelope := range []bool{false, true} {
		t.Run(map[bool]string{false: "released ciphertext", true: "opaque future envelope"}[futureEnvelope], func(t *testing.T) {
			repo := newCheckoutSourceTestRepo(t)
			fixtureDir := filepath.Join("testdata", "structured_titles_legacy")
			manifestData, err := os.ReadFile(filepath.Join(fixtureDir, "manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			var manifest struct {
				SHA256 map[string]string `json:"sha256"`
			}
			if err = json.Unmarshal(manifestData, &manifest); err != nil {
				t.Fatal(err)
			}
			const boxID = "20261023180038-mbrj58v"
			const document = boxID + "/20261023180038-pwkjtsl.sy"
			for name, expected := range manifest.SHA256 {
				if !strings.HasPrefix(name, "data/"+boxID+"/") && !strings.HasPrefix(name, "data/.siyuan/") {
					continue
				}
				data, err := os.ReadFile(filepath.Join(fixtureDir, filepath.FromSlash(name)))
				if err != nil {
					t.Fatal(err)
				}
				digest := sha256.Sum256(data)
				if hex.EncodeToString(digest[:]) != expected {
					t.Fatal("released encrypted fixture changed", name)
				}
				writeCheckoutSourceTestFile(t, repo, strings.TrimPrefix(name, "data/"), data, 10)
			}
			original, err := os.ReadFile(filepath.Join(repo.DataPath, filepath.FromSlash(document)))
			if err != nil || !util.IsCiphertext(original) {
				t.Fatal("released ciphertext fixture is unavailable", err)
			}
			incoming := bytes.Clone(original)
			if futureEnvelope {
				incoming[4] = 255
				writeCheckoutSourceTestFile(t, repo, document, incoming, 10)
			}
			target, err := repo.Index("opaque encrypted source", false, nil)
			if err != nil {
				t.Fatal(err)
			}
			current := bytes.Clone(original)
			current[len(current)-1] ^= 1
			writeCheckoutSourceTestFile(t, repo, document, current, 20)
			before, err := archiveDirectoryFiles(repo.DataPath)
			if err != nil {
				t.Fatal(err)
			}
			previousProvider := filesys.DEKProvider
			filesys.DEKProvider = func(string) ([]byte, error) {
				t.Error("opaque checkout requested a notebook key")
				return nil, errors.New("locked notebook")
			}
			t.Cleanup(func() { filesys.DEKProvider = previousProvider })
			if _, _, err = repo.Checkout(target.ID, nil); err != nil {
				t.Fatal("opaque ciphertext checkout required an unlocked notebook", err)
			}
			actual, err := os.ReadFile(filepath.Join(repo.DataPath, filepath.FromSlash(document)))
			if err != nil || !bytes.Equal(actual, incoming) {
				t.Fatal("opaque checkout changed ciphertext", err)
			}
			after, err := archiveDirectoryFiles(repo.DataPath)
			if err != nil {
				t.Fatal(err)
			}
			delete(before, document)
			delete(after, document)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("opaque checkout changed configuration or key recovery material")
			}
		})
	}
}
