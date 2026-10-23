package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
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

func TestDocumentAddressingBlocksCachedAccessAndConfigRepair(t *testing.T) {
	fixture := setupFileOperationTest(t)
	previousConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConfDir })
	boxID := fixture.box.ID
	boxDir := filepath.Join(util.DataDir, boxID)
	configPath := filepath.Join(boxDir, documentaddressing.ConfigPath)
	docPath := filepath.Join(boxDir, fixture.sourcePath)
	source, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = filesys.LoadTree(boxID, fixture.sourcePath, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	cache.PutDocIALInBox(fixture.sourcePath, boxID, map[string]string{"title": "cached"})
	data := []byte(`{"name":"future","closed":false,"documentAddressingVersion":3}`)
	if err = os.WriteFile(configPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	for _, removeConfig := range []bool{false, true} {
		if removeConfig {
			if err = os.Remove(configPath); err != nil {
				t.Fatal(err)
			}
		}
		boxes, listErr := listNotebooks(true)
		if listErr != nil || len(boxes) != 1 || !boxes[0].Closed {
			t.Fatalf("unsupported notebook opened: %+v, %v", boxes, listErr)
		}
		if properties := fixture.box.docIAL(fixture.sourcePath); properties != nil {
			t.Fatalf("returned cached properties: %v", properties)
		}
		if _, loadErr := filesys.LoadTree(boxID, fixture.sourcePath, util.NewLute()); !errors.Is(loadErr, documentaddressing.ErrUnsupported) {
			t.Fatal(loadErr)
		}
		if _, _, listErr = fixture.box.Ls("/"); !errors.Is(listErr, documentaddressing.ErrUnsupported) {
			t.Fatal(listErr)
		}
		if saveErr := fixture.box.SaveConf(conf.NewBoxConf()); !errors.Is(saveErr, documentaddressing.ErrUnsupported) {
			t.Fatal(saveErr)
		}
		if _, mountErr := mountBox(boxID); !errors.Is(mountErr, documentaddressing.ErrUnsupported) {
			t.Fatal(mountErr)
		}
		actual, readErr := os.ReadFile(configPath)
		if removeConfig {
			if !errors.Is(readErr, os.ErrNotExist) {
				t.Fatal("missing configuration was repaired")
			}
		} else if readErr != nil || !bytes.Equal(actual, data) {
			t.Fatal("source configuration changed")
		}
	}
	actual, err := os.ReadFile(docPath)
	if err != nil || !bytes.Equal(actual, source) {
		t.Fatal("document changed")
	}
}

func TestDocumentAddressingRejectsFutureConfigBeforeWrite(t *testing.T) {
	fixture := setupFileOperationTest(t)
	previousConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConfDir })
	name := filepath.Join(util.DataDir, fixture.box.ID, documentaddressing.ConfigPath)
	before, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	if err = fixture.box.saveConf0([]byte(`{"documentAddressingVersion":3}`)); !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatal(err)
	}
	after, err := os.ReadFile(name)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("rejected configuration was written")
	}
}

func TestDocumentAddressingSnapshotPreflight(t *testing.T) {
	previousConf := Conf
	Conf = &AppConf{Lang: "en"}
	t.Cleanup(func() { Conf = previousConf })
	for _, marker := range []string{"config", "floor"} {
		t.Run(marker, func(t *testing.T) {
			base := t.TempDir()
			oldConfDir := util.ConfDir
			util.ConfDir = filepath.Join(base, "conf")
			t.Cleanup(func() { util.ConfDir = oldConfDir })
			dataDir := filepath.Join(base, "data")
			repo, err := dejavu.NewRepoWithOptions(dejavu.Options{
				DataPath: dataDir, RepoPath: filepath.Join(base, "repo"), HistoryPath: filepath.Join(base, "history"), TempPath: filepath.Join(base, "temp"),
				DeviceID: "device", DeviceName: "device", DeviceOS: "windows", AESKey: []byte("0123456789abcdef0123456789abcdef"), HiddenDirectoryNames: []string{".siyuan"},
			})
			if err != nil {
				t.Fatal(err)
			}
			const boxID = "20260101120000-abcdefg"
			write := func(name, content string, tick int64) {
				t.Helper()
				name = filepath.Join(dataDir, boxID, name)
				if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(name, []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
				stamp := time.Unix(1700000000+tick, 0)
				if err := os.Chtimes(name, stamp, stamp); err != nil {
					t.Fatal(err)
				}
			}
			config := `{"documentAddressingVersion":3}`
			if marker == "floor" {
				config = `{}`
				write(documentaddressing.FloorPath, `{"version":1,"notebook":"`+boxID+`","minimumMode":3}`, 10)
			}
			write(documentaddressing.ConfigPath, config, 10)
			write("existing.sy", "future source", 10)
			write("added.sy", "future addition", 10)
			snapshot, err := repo.Index("future", false, nil)
			if err != nil {
				t.Fatal(err)
			}
			write(documentaddressing.ConfigPath, `{"name":"legacy"}`, 20)
			write("existing.sy", "legacy source", 20)
			write("keep.sy", "must not be removed", 20)
			if err = os.Remove(filepath.Join(dataDir, boxID, "added.sy")); err != nil {
				t.Fatal(err)
			}
			if marker == "floor" {
				if err = os.Remove(filepath.Join(dataDir, boxID, documentaddressing.FloorPath)); err != nil {
					t.Fatal(err)
				}
			}
			repo.SetCheckoutHooks(documentAddressingCheckoutHooks(repo))
			if _, _, err = repo.Checkout(snapshot.ID, nil); !errors.Is(err, documentaddressing.ErrUnsupported) {
				t.Fatalf("preflight result: %v", err)
			}
			for name, want := range map[string]string{documentaddressing.ConfigPath: `{"name":"legacy"}`, "existing.sy": "legacy source", "keep.sy": "must not be removed"} {
				actual, readErr := os.ReadFile(filepath.Join(dataDir, boxID, name))
				if readErr != nil || string(actual) != want {
					t.Fatalf("source %s changed: %s, %v", name, actual, readErr)
				}
			}
			if _, err = os.Stat(filepath.Join(dataDir, boxID, "added.sy")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("future document written")
			}
			if err = documentaddressing.CheckBox(dataDir, util.ConfDir, boxID); !errors.Is(err, documentaddressing.ErrUnsupported) {
				t.Fatalf("incoming requirement not retained: %v", err)
			}
		})
	}
}

func TestDocumentAddressingSyncPreflightSurvivesTaskCleanup(t *testing.T) {
	full, partial, fullData := prepareAssetDownloadRepoTest(t)
	backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{
		Dir: "main", RepoPath: full.Path, AvailableSize: 1 << 30,
		Local: &cloud.ConfLocal{Endpoint: Conf.LoadSync().Local.Endpoint},
	}})
	remote, err := dejavu.NewRepoWithOptions(dejavu.Options{
		DataPath: full.DataPath, RepoPath: full.Path, HistoryPath: full.HistoryPath, TempPath: full.TempPath,
		DeviceID: full.DeviceID, DeviceName: full.DeviceName, DeviceOS: full.DeviceOS,
		AESKey: Conf.LoadRepo().Key, Cloud: backend, HiddenDirectoryNames: []string{".siyuan"},
	})
	if err != nil {
		t.Fatal(err)
	}
	const boxID = "20261022000100-abcdefg"
	write := func(name, data string, tick int64) {
		t.Helper()
		name = filepath.Join(fullData, boxID, name)
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
		stamp := time.Unix(1700000000+tick, 0)
		if err := os.Chtimes(name, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	write(documentaddressing.ConfigPath, `{}`, 10)
	write("existing.sy", "legacy", 10)
	write("keep.sy", "retained", 10)
	if _, err = remote.Index("legacy notebook", false, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = remote.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	write(documentaddressing.ConfigPath, `{"documentAddressingVersion":3}`, 20)
	write("existing.sy", "future", 20)
	write("new.sy", "future addition", 20)
	if err = os.Remove(filepath.Join(fullData, boxID, "keep.sy")); err != nil {
		t.Fatal(err)
	}
	if _, err = remote.Index("future notebook", false, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = remote.Sync(nil); err != nil {
		t.Fatal(err)
	}
	checkout := startSyncCheckout(partial)
	if checkout == nil {
		t.Fatal("missing checkout task")
	}
	finished := false
	t.Cleanup(func() {
		if !finished {
			var err error
			checkout.finish(partial, &err)
		}
	})
	_, _, err = partial.Sync(nil)
	if !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatalf("task lost preflight: %v", err)
	}
	checkout.finish(partial, &err)
	finished = true
	if _, _, err = partial.RecoverAssetDownloads(nil); !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatalf("task cleanup lost preflight: %v", err)
	}
	reopened, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = reopened.RecoverAssetDownloads(nil); !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatalf("reopening pending recovery lost preflight: %v", err)
	}
	for name, want := range map[string]string{documentaddressing.ConfigPath: `{}`, "existing.sy": "legacy", "keep.sy": "retained"} {
		actual, readErr := os.ReadFile(filepath.Join(util.DataDir, boxID, name))
		if readErr != nil || string(actual) != want {
			t.Fatalf("rejected sync changed %s: %q, %v", name, actual, readErr)
		}
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, boxID, "new.sy")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("rejected sync wrote a new document")
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
		if err = os.WriteFile(filepath.Join(source, sourceBox+".sy"), []byte("unparsed future document"), 0644); err != nil {
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
		if _, err = importSY0(archive, fixture.box.ID, "/", whole, false, nil, false); !errors.Is(err, documentaddressing.ErrUnsupported) {
			t.Fatalf("import accepted future mode: %v", err)
		}
		if _, err = inspectSYNotebookArchive(archive); !errors.Is(err, documentaddressing.ErrUnsupported) {
			t.Fatalf("bundle inspection accepted future mode: %v", err)
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

func TestDocumentAddressingImportRemapsOnlyWholeNotebookFloor(t *testing.T) {
	oldData, oldConfDir := util.DataDir, util.ConfDir
	util.DataDir, util.ConfDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.DataDir, util.ConfDir = oldData, oldConfDir })
	const sourceBox, targetBox = "20260101120000-abcdefg", "20260101120001-hijklmn"
	for _, whole := range []bool{false, true} {
		source := t.TempDir()
		metaDir := filepath.Join(source, ".siyuan")
		if err := os.MkdirAll(metaDir, 0755); err != nil {
			t.Fatal(err)
		}
		data := []byte(`{"version":1,"notebook":"` + sourceBox + `","minimumMode":1}`)
		if err := os.WriteFile(filepath.Join(source, documentaddressing.FloorPath), data, 0644); err != nil {
			t.Fatal(err)
		}
		meta, err := json.Marshal(boxDocMeta{Spec: boxDocMetaSpec, BoxDocID: sourceBox})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(metaDir, boxDocMetaName), meta, 0644); err != nil {
			t.Fatal(err)
		}
		if err = checkImportedDocumentAddressing(source); err != nil {
			t.Fatal(err)
		}
		if err = prepareImportedDocumentAddressing(source, targetBox, whole); err != nil {
			t.Fatal(err)
		}
		if whole {
			if err = documentaddressing.CheckSource(targetBox, source); err != nil {
				t.Fatalf("identity not remapped: %v", err)
			}
			if err = documentaddressing.CheckSource(sourceBox, source); !errors.Is(err, documentaddressing.ErrInvalid) {
				t.Fatalf("source identity retained: %v", err)
			}
		} else if _, err = os.Stat(filepath.Join(source, documentaddressing.FloorPath)); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("partial import retained source floor")
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
	if _, err := validateImportedNotebookIdentities(install); !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatal(err)
	}
	err := applyDataImport(t.TempDir(), install, func(string, string) error { t.Fatal("batch began writing"); return nil })
	if !errors.Is(err, documentaddressing.ErrUnsupported) {
		t.Fatal(err)
	}
}

func TestDocumentAddressingNotebookHistoryPreservesSource(t *testing.T) {
	historyPath, boxID := setupNotebookHistoryRollbackTest(t)
	oldConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = oldConfDir })
	name := filepath.Join(util.WorkspaceDir, historyPath, documentaddressing.ConfigPath)
	source := []byte(`{"name":"future","documentAddressingVersion":3}`)
	if err := os.WriteFile(name, source, 0644); err != nil {
		t.Fatal(err)
	}
	if err := RollbackNotebookHistory(historyPath); !errors.Is(err, documentaddressing.ErrUnsupported) {
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

func TestDocumentAddressingNativeExportPreservesFloor(t *testing.T) {
	const boxID = "20260101120000-abcdefg"
	setupExportRelatedTest(t, boxID)
	name := filepath.Join(util.DataDir, boxID, documentaddressing.FloorPath)
	source := []byte(`{"version":1,"notebook":"` + boxID + `","minimumMode":2}`)
	if err := os.WriteFile(name, source, 0644); err != nil {
		t.Fatal(err)
	}
	archive := openExportArchive(t, ExportNotebookSY(boxID))
	data := readArchiveFile(t, archive, boxID+"/"+documentaddressing.FloorPath)
	if data != string(source) {
		t.Fatal("export lost capability floor")
	}
}
