//go:build fts5

package model

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestImportSYAttributeViewBindingIsolation(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "normal"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			const (
				sourceBoxID = "20260909110000-source0"
				targetBoxID = "20260909110001-target0"
				externalID  = "20260909110002-extern0"
				docID       = "20260909110003-doc0000"
				avID        = "20260909110004-av00000"
			)
			setupExportRelatedTest(t, sourceBoxID, targetBoxID)
			setupNotebookDocumentImportDatabase(t)
			Conf.Lang = "en"
			oldTimeLangs := util.TimeLangs
			labels := map[string]any{}
			for _, key := range []string{"now", "1s", "xs", "1m", "xm", "1h", "xh", "1d", "xd", "1w", "xw", "1M", "xM", "1y", "2y", "xy", "max", "albl", "blbl"} {
				labels[key] = key
			}
			util.TimeLangs = map[string]map[string]any{"en": labels}
			t.Cleanup(func() { util.TimeLangs = oldTimeLangs })
			oldLang, oldAVLangs := util.Lang, util.AttrViewLangs
			util.Lang = "en"
			util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
			t.Cleanup(func() {
				util.Lang, util.AttrViewLangs = oldLang, oldAVLangs
				cache.ClearAVCache()
			})
			if encrypted {
				forgetRuntimeNormalBox(targetBoxID)
				markRuntimeEncryptedBox(targetBoxID)
				dek := bytes.Repeat([]byte{0x62}, 32)
				setDEKForTest(targetBoxID, dek)
				boxConf := conf.NewBoxConf()
				boxConf.Encrypted = true
				boxConf.BoxCrypt = &conf.BoxEncryption{Spec: boxEncryptionSpec}
				if err := encryptBoxMetadata(targetBoxID, boxConf, dek); err != nil {
					t.Fatal(err)
				}
				configData, err := json.Marshal(boxConf)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(util.DataDir, targetBoxID, ".siyuan", "conf.json"), configData, 0600); err != nil {
					t.Fatal(err)
				}
				mountedEncryptedBoxes.Store(targetBoxID, true)
				t.Cleanup(func() {
					mountedEncryptedBoxes.Delete(targetBoxID)
					encryptedBoxLifecycles.Delete(targetBoxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, targetBoxID)
					cachedDEKsLock.Unlock()
				})
			}
			external := treenode.NewTree(sourceBoxID, "/"+externalID+".sy", "/External", "External")
			external.Root.SetIALAttr(av.NodeAttrNameAvs, avID)
			writeExportRelatedTestTree(t, external)
			externalPath := filepath.Join(util.DataDir, sourceBoxID, external.Path)
			before, err := os.ReadFile(externalPath)
			if err != nil {
				t.Fatal(err)
			}
			source := treenode.NewTree(sourceBoxID, "/"+docID+".sy", "/Daily", "Daily")
			source.Root.SetIALAttr(av.NodeAttrNameAvs, avID)
			writeExportRelatedTestTree(t, source)
			attrView := av.NewAttributeView(avID)
			values := attrView.GetBlockKeyValues()
			for i, id := range []string{externalID, docID} {
				itemID := ast.NewNodeID()
				values.Values = append(values.Values, &av.Value{ID: ast.NewNodeID(), KeyID: values.Key.ID,
					BlockID: itemID, Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: id, Content: []string{"External", "Internal"}[i]}})
				attrView.Views[0].ItemIDs = append(attrView.Views[0].ItemIDs, itemID)
			}
			if err = av.SaveAttributeView(attrView); err != nil {
				t.Fatal(err)
			}
			avData, err := json.Marshal(attrView)
			if err != nil {
				t.Fatal(err)
			}
			docData, err := os.ReadFile(filepath.Join(util.DataDir, sourceBoxID, source.Path))
			if err != nil {
				t.Fatal(err)
			}
			archivePath := filepath.Join(t.TempDir(), "binding.sy.zip")
			archive, err := os.Create(archivePath)
			if err != nil {
				t.Fatal(err)
			}
			writer := zip.NewWriter(archive)
			for path, data := range map[string][]byte{"Daily/" + docID + ".sy": docData, "Daily/storage/av/" + avID + ".json": avData} {
				entry, createErr := writer.Create(path)
				if createErr != nil {
					t.Fatal(createErr)
				}
				if _, err = entry.Write(data); err != nil {
					t.Fatal(err)
				}
			}
			if err = writer.Close(); err != nil {
				t.Fatal(err)
			}
			if err = archive.Close(); err != nil {
				t.Fatal(err)
			}
			if err = ImportSY(archivePath, targetBoxID, "/"); err != nil {
				t.Fatal(err)
			}
			entries, err := os.ReadDir(filepath.Join(util.DataDir, targetBoxID))
			if err != nil {
				t.Fatal(err)
			}
			var newAvID, newDocID string
			for _, entry := range entries {
				if !strings.HasSuffix(entry.Name(), ".sy") {
					continue
				}
				tree, loadErr := filesys.LoadTree(targetBoxID, "/"+entry.Name(), util.NewLute())
				if loadErr != nil {
					t.Fatal(loadErr)
				}
				newAvID, newDocID = tree.Root.IALAttr(av.NodeAttrNameAvs), tree.ID
			}
			if newAvID == "" || newAvID == avID || newDocID == docID {
				t.Fatalf("imported IDs were not remapped: %s, %s", newAvID, newDocID)
			}
			t.Cleanup(func() { av.SetAVBoxID(newAvID, "") })
			avBoxID := ""
			if encrypted {
				avBoxID = targetBoxID
			}
			imported, err := av.ParseAttributeViewInBox(newAvID, avBoxID)
			if err != nil {
				t.Fatal(err)
			}
			rows := imported.GetBlockKeyValues().Values
			if len(rows) != 2 || rows[0].IsDetached != encrypted || rows[1].IsDetached || rows[1].Block.ID != newDocID ||
				rows[0].Block.Content != "External" || rows[0].BlockID != values.Values[0].BlockID {
				t.Fatalf("imported bindings or row data changed unexpectedly: %+v", rows)
			}
			after, err := os.ReadFile(externalPath)
			if err != nil {
				t.Fatal(err)
			}
			if encrypted && (!bytes.Equal(before, after) || rows[0].Block.ID != "") {
				t.Fatal("encrypted import changed the original document or retained its binding")
			}
			if encrypted {
				ciphertext, readErr := os.ReadFile(filepath.Join(util.DataDir, targetBoxID, "storage", "av", newAvID+".json"))
				if readErr != nil || bytes.Contains(ciphertext, []byte("External")) {
					t.Fatalf("encrypted import did not protect database contents: %v", readErr)
				}
				if _, statErr := os.Stat(filepath.Join(util.DataDir, "storage", "av", newAvID+".json")); !os.IsNotExist(statErr) {
					t.Fatalf("encrypted database appeared in global storage: %v", statErr)
				}
			}
			if !encrypted && (!bytes.Contains(after, []byte(newAvID)) || rows[0].Block.ID != externalID) {
				t.Fatal("ordinary import did not preserve its external binding")
			}
			exportDir := t.TempDir()
			if err = exportAv(avID, "", exportDir, exportDir, nil); err != nil {
				t.Fatalf("original database export failed after import: %v", err)
			}
			Conf.Export.IncludeRelatedDocs = false
			if exportPath := ExportSYs([]string{externalID}); exportPath == "" {
				t.Fatal("original document export failed after import")
			}
		})
	}
}
