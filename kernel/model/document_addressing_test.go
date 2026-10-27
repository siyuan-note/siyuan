// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentAddressingImportTitlePreflight(t *testing.T) {
	fixture := setupFileOperationTest(t)
	oldConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = oldConfDir })
	for _, whole := range []bool{false, true} {
		for _, sourceError := range []struct {
			name, document string
			err            error
		}{
			{"title", `{"Spec":"2","Properties":{"title":{"text":"Future"}}}`, documentaddressing.ErrInvalidTitle},
			{"version", `{"Spec":"999","Spec":"2","Properties":{"title":"Legacy"}}`, treenode.ErrSpecTooNew},
		} {
			t.Run(sourceError.name+map[bool]string{false: "/documents", true: "/notebook"}[whole], func(t *testing.T) {
				root := t.TempDir()
				metadata := filepath.Join(root, ".siyuan")
				if err := os.MkdirAll(metadata, 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(metadata, "conf.json"), []byte(`{"name":"Incoming"}`), 0644); err != nil {
					t.Fatal(err)
				}
				for name, source := range map[string]string{
					"20261022000000-abcdefg.sy": `{"Spec":"2","Properties":{"title":"Ordinary"}}`,
					"20261022000001-hijklmn.sy": sourceError.document,
				} {
					if err := os.WriteFile(filepath.Join(root, name), []byte(source), 0644); err != nil {
						t.Fatal(err)
					}
				}
				archive := filepath.Join(t.TempDir(), "incoming.sy.zip")
				writer, err := gulu.Zip.Create(archive)
				if err != nil {
					t.Fatal(err)
				}
				if err = writer.AddDirectory("Incoming", root); err != nil {
					_ = writer.Close()
					t.Fatal(err)
				}
				if err = writer.Close(); err != nil {
					t.Fatal(err)
				}
				original, err := os.ReadFile(archive)
				if err != nil {
					t.Fatal(err)
				}
				before, err := archiveDirectoryFiles(util.DataDir)
				if err != nil {
					t.Fatal(err)
				}
				beforeConf, err := archiveDirectoryFiles(util.ConfDir)
				if err != nil {
					t.Fatal(err)
				}
				created, err := importSY0(archive, fixture.box.ID, "/", whole, false, nil, false)
				if created != "" || !errors.Is(err, sourceError.err) {
					t.Fatalf("source preflight ran after adoption: %q, %v", created, err)
				}
				after, err := archiveDirectoryFiles(util.DataDir)
				if err != nil || !reflect.DeepEqual(before, after) {
					t.Fatal("rejected import wrote workspace data", err)
				}
				retained, err := os.ReadFile(archive)
				if err != nil || !bytes.Equal(original, retained) {
					t.Fatal("rejected import changed the archive")
				}
				if afterConf, err := archiveDirectoryFiles(util.ConfDir); err != nil || !reflect.DeepEqual(beforeConf, afterConf) {
					t.Fatal("inspection of an unadopted source changed capability records")
				}
			})
		}
	}
}

func TestDocumentAddressingImportChecksBeforeRemapping(t *testing.T) {
	fixture := setupFileOperationTest(t)
	oldConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = oldConfDir })
	const sourceBox = "20260101120000-abcdefg"
	for _, whole := range []bool{false, true} {
		root := t.TempDir()
		source := filepath.Join(root, "Notebook")
		metadata := filepath.Join(source, ".siyuan")
		if err := os.MkdirAll(metadata, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(metadata, "conf.json"), []byte(`{"name":"future","documentAddressingVersion":3}`), 0644); err != nil {
			t.Fatal(err)
		}
		meta, err := json.Marshal(boxDocMeta{Spec: boxDocMetaSpec, BoxDocID: sourceBox})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(metadata, boxDocMetaName), meta, 0644); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(source, sourceBox+".sy"), []byte(`{"Spec":"999","Properties":{"title":"Future"}}`), 0644); err != nil {
			t.Fatal(err)
		}
		archive := filepath.Join(t.TempDir(), "future.sy.zip")
		writer, err := gulu.Zip.Create(archive)
		if err != nil {
			t.Fatal(err)
		}
		if err = writer.AddDirectory("Notebook", source); err != nil {
			_ = writer.Close()
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		before, err := os.ReadFile(archive)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = importSY0(archive, fixture.box.ID, "/", whole, false, nil, false); !errors.Is(err, treenode.ErrSpecTooNew) {
			t.Fatalf("import accepted future Spec: %v", err)
		}
		if _, err = inspectSYNotebookArchive(archive); err == nil {
			t.Fatalf("bundle inspection accepted future Spec: %v", err)
		}
		after, err := os.ReadFile(archive)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("archive changed")
		}
		boxes, err := os.ReadDir(util.DataDir)
		if err != nil {
			t.Fatal(err)
		}
		for _, box := range boxes {
			if box.IsDir() && len(box.Name()) == len(sourceBox) && box.Name() != fixture.box.ID {
				t.Fatalf("created notebook before validation: %s", box.Name())
			}
		}
	}
}

func TestDocumentAddressingImportIgnoresRetiredFloor(t *testing.T) {
	for _, source := range []string{`{}`, `{`, `{"minimumMode":999}`, `{"version":1,"notebook":"different","minimumMode":1}`} {
		root := t.TempDir()
		name := filepath.Join(root, documentaddressing.FloorPath)
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(source), 0644); err != nil {
			t.Fatal(err)
		}
		if err := checkImportedDocumentAddressing(root); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(name)
		if err != nil || string(data) != source {
			t.Fatal("retired notebook record changed", err)
		}
	}
}

func TestDocumentAddressingDataImportRejectsBeforeAnyWrite(t *testing.T) {
	fixture := setupFileOperationTest(t)
	oldConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = oldConfDir })
	install := t.TempDir()
	metaDir := filepath.Join(install, fixture.box.ID, ".siyuan")
	if err := os.MkdirAll(metaDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(metaDir, "conf.json"), []byte(`{"documentAddressingVersion":3}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(install, "ordinary.txt"), []byte("other batch content"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(install, fixture.box.ID, "20261022120001-future1.sy"), []byte(`{"Spec":"999","Properties":{"title":"Future"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	err := applyDataImport(t.TempDir(), install, func(string, string) error { t.Fatal("batch began writing"); return nil })
	if !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatal(err)
	}
}

func TestDocumentAddressingNotebookHistoryPreservesSource(t *testing.T) {
	historyPath, boxID := setupNotebookHistoryRollbackTest(t)
	oldConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = oldConfDir })
	name := filepath.Join(util.WorkspaceDir, historyPath, "20261022120001-future1.sy")
	source := []byte(`{"Spec":"999","Properties":{"title":"Future"}}`)
	if err := os.WriteFile(name, source, 0644); err != nil {
		t.Fatal(err)
	}
	if err := RollbackNotebookHistory(historyPath); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, boxID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("restoration created notebook before validation")
	}
	data, err := os.ReadFile(name)
	if err != nil || !bytes.Equal(data, source) {
		t.Fatal("history source changed")
	}
}

func TestDocumentAddressingNativeExportLeavesRetiredFloor(t *testing.T) {
	const boxID = "20260101120000-abcdefg"
	setupExportRelatedTest(t, boxID)
	name := filepath.Join(util.DataDir, boxID, documentaddressing.FloorPath)
	source := []byte(`{"version":1,"notebook":"` + boxID + `","minimumMode":2}`)
	if err := os.WriteFile(name, source, 0644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{boxID, "Named-notebook"} {
		box := &Box{ID: boxID}
		boxConf := box.GetConf()
		boxConf.Name = name
		if err := box.SaveConf(boxConf); err != nil {
			t.Fatal(err)
		}
		exported := ExportNotebookSY(boxID)
		archive := openExportArchive(t, exported)
		for _, file := range archive.File {
			if file.Name == name+"/"+documentaddressing.FloorPath {
				t.Fatal("export regenerated a retired record")
			}
		}
		if data, err := os.ReadFile(filepath.Join(util.DataDir, boxID, documentaddressing.FloorPath)); err != nil || !bytes.Equal(data, source) {
			t.Fatal("export changed notebook record", err)
		}
		archivePath, err := exportedFilePath(exported)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = inspectSYNotebookArchive(archivePath); err != nil {
			t.Fatalf("exported notebook %q cannot be imported: %v", name, err)
		}
	}
}
