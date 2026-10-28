//go:build fts5

package model

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
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
	for _, testCase := range []struct{ encrypted, subItems bool }{{}, {encrypted: true}, {subItems: true}, {encrypted: true, subItems: true}} {
		encrypted, subItems := testCase.encrypted, testCase.subItems
		name := "normal"
		if encrypted {
			name = "encrypted"
		}
		if subItems {
			name += "-subitems"
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
			relationTargets := []*av.AttributeView{av.NewAttributeView(ast.NewNodeID()), av.NewAttributeView(ast.NewNodeID())}
			archiveEntries := map[string][]byte{}
			for _, target := range relationTargets {
				key := av.NewKey(ast.NewNodeID(), "Related", "", av.KeyTypeRelation)
				key.Relation = &av.Relation{AvID: target.ID}
				attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{Key: key})
				if err := av.SaveAttributeView(target); err != nil {
					t.Fatal(err)
				}
				data, err := json.Marshal(target)
				if err != nil {
					t.Fatal(err)
				}
				archiveEntries["Daily/storage/av/"+target.ID+".json"] = data
			}
			values := attrView.GetBlockKeyValues()
			for i, id := range []string{externalID, docID} {
				itemID := ast.NewNodeID()
				values.Values = append(values.Values, &av.Value{ID: ast.NewNodeID(), KeyID: values.Key.ID,
					BlockID: itemID, Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: id, Content: []string{"External", "Internal"}[i]}})
				attrView.Views[0].ItemIDs = append(attrView.Views[0].ItemIDs, itemID)
			}
			if subItems {
				p, c := ast.NewNodeID(), ast.NewNodeID()
				attrView.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: p, ChildrenKeyID: c}
				attrView.KeyValues = append(attrView.KeyValues,
					&av.KeyValues{Key: &av.Key{ID: p, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: avID, IsTwoWay: true, BackKeyID: c}}},
					&av.KeyValues{Key: &av.Key{ID: c, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: avID, IsTwoWay: true, BackKeyID: p}}})
				if err = attrView.SetSubItemsParents(map[string]string{values.Values[1].BlockID: values.Values[0].BlockID}); err != nil {
					t.Fatal(err)
				}
				attrView.Views[0].SubItemsDisplay = "nested"
				carrier := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: avID}
				carrier.SetIALAttr("id", carrier.ID)
				carrier.SetIALAttr(av.NodeAttrView, attrView.Views[0].ID)
				carrier.SetIALAttr(av.NodeAttrVisibleViewIDs, attrView.Views[0].ID)
				contextFilter, encodeErr := (&av.AttributeViewContextFilter{Spec: av.AttributeViewContextFilterSpec, KeyID: p}).Marshal()
				if encodeErr != nil {
					t.Fatal(encodeErr)
				}
				carrier.SetIALAttr(av.NodeAttrContextFilter, contextFilter)
				source.Root.AppendChild(carrier)
				writeExportRelatedTestTree(t, source)
				// 两个库故意使用相同旧条目 ID，验证按所属库重映射。
				target := relationTargets[0]
				targetRow := values.Values[0].BlockID
				target.GetBlockKeyValues().Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: target.GetBlockKey().ID, BlockID: targetRow,
					Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Related row"}}}
				target.Views[0].ItemIDs = []string{targetRow}
				var relation *av.KeyValues
				for _, kv := range attrView.KeyValues {
					if kv.Key.Relation != nil && kv.Key.Relation.AvID == target.ID {
						relation = kv
						break
					}
				}
				backID := ast.NewNodeID()
				relation.Key.Relation.IsTwoWay, relation.Key.Relation.BackKeyID = true, backID
				relation.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: relation.Key.ID, BlockID: values.Values[0].BlockID,
					Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{targetRow}}}}
				target.KeyValues = append(target.KeyValues, &av.KeyValues{Key: &av.Key{ID: backID, Type: av.KeyTypeRelation,
					Relation: &av.Relation{AvID: avID, IsTwoWay: true, BackKeyID: relation.Key.ID}}, Values: []*av.Value{{ID: ast.NewNodeID(),
					KeyID: backID, BlockID: targetRow, Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{values.Values[0].BlockID}}}}})
				archiveEntries["Daily/storage/av/"+target.ID+".json"], err = json.Marshal(target)
				if err != nil {
					t.Fatal(err)
				}
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
			archiveEntries["Daily/"+docID+".sy"] = docData
			archiveEntries["Daily/storage/av/"+avID+".json"] = avData
			for path, data := range archiveEntries {
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
			var newAvID, newDocID, newViewID, newVisibleViewID, newContextKeyID string
			for _, entry := range entries {
				if !strings.HasSuffix(entry.Name(), ".sy") {
					continue
				}
				tree, loadErr := filesys.LoadTree(targetBoxID, "/"+entry.Name(), util.NewLute())
				if loadErr != nil {
					t.Fatal(loadErr)
				}
				newAvID, newDocID = tree.Root.IALAttr(av.NodeAttrNameAvs), tree.ID
				if subItems {
					carrier := tree.Root.ChildrenByType(ast.NodeAttributeView)[0]
					newViewID, newVisibleViewID = carrier.IALAttr(av.NodeAttrView), carrier.IALAttr(av.NodeAttrVisibleViewIDs)
					contextFilter, contextErr := av.ParseAttributeViewContextFilter(carrier.IALAttr(av.NodeAttrContextFilter))
					if contextErr != nil || contextFilter == nil {
						t.Fatalf("imported context filter is invalid: %v", contextErr)
					}
					newContextKeyID = contextFilter.KeyID
				}
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
			relationCount := 0
			for _, kv := range imported.KeyValues {
				if kv.Key.Type != av.KeyTypeRelation {
					continue
				}
				if imported.IsSubItemsKey(kv.Key.ID) {
					continue
				}
				relationCount++
				targetID := kv.Key.Relation.AvID
				t.Cleanup(func() { av.SetAVBoxID(targetID, "") })
				if targetID == relationTargets[0].ID || targetID == relationTargets[1].ID {
					t.Fatal("relation target ID was not remapped")
				}
				target, err := av.ParseAttributeViewInBox(targetID, avBoxID)
				if err != nil {
					t.Fatal(err)
				}
				if subItems && kv.Key.Relation.IsTwoWay {
					rowID := imported.GetBlockKeyValues().Values[0].BlockID
					targetRow := target.GetBlockKeyValues().Values[0].BlockID
					back, keyErr := target.GetKeyValues(kv.Key.Relation.BackKeyID)
					if keyErr != nil || back.Key.Relation.BackKeyID != kv.Key.ID || back.Key.Relation.AvID != imported.ID ||
						!slices.Equal(back.Values[0].Relation.BlockIDs, []string{rowID}) || !slices.Equal(kv.Values[0].Relation.BlockIDs, []string{targetRow}) || targetRow == rowID {
						t.Fatalf("cross-database identities were not remapped consistently: %v", keyErr)
					}
				}
				if !slices.Contains(av.GetSrcAvIDs(targetID), newAvID) {
					t.Fatalf("import omitted relation dependency %s -> %s", newAvID, targetID)
				}
			}
			if relationCount != 2 {
				t.Fatalf("imported %d relation fields, want 2", relationCount)
			}
			rows := imported.GetBlockKeyValues().Values
			if len(rows) != 2 || rows[0].IsDetached != encrypted || rows[1].IsDetached || rows[1].Block.ID != newDocID ||
				rows[0].Block.Content != "External" || (!subItems && rows[0].BlockID != values.Values[0].BlockID) {
				t.Fatalf("imported bindings or row data changed unexpectedly: %+v", rows)
			}
			if subItems {
				if rows[0].BlockID == values.Values[0].BlockID || rows[1].BlockID == values.Values[1].BlockID ||
					rows[0].ID == values.Values[0].ID || imported.SubItems.ParentKeyID == attrView.SubItems.ParentKeyID ||
					imported.GetBlockKey().ID == attrView.GetBlockKey().ID || newViewID == attrView.Views[0].ID ||
					newViewID != imported.Views[0].ID || newVisibleViewID != newViewID {
					t.Fatal("native import retained database field, row, value or view identities")
				}
				if newContextKeyID != imported.SubItems.ParentKeyID {
					t.Fatal("native import retained the context filter's original field identity")
				}
				index, graphErr := imported.BuildSubItemsIndex()
				if graphErr != nil || index.Parents[rows[1].BlockID] != rows[0].BlockID || imported.Views[0].SubItemsDisplay != "nested" {
					t.Fatalf("native import lost hierarchy: %v", graphErr)
				}
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
			Conf.Export.Load().IncludeRelatedDocs = false
			if exportPath := ExportSYs([]string{externalID}); exportPath == "" {
				t.Fatal("original document export failed after import")
			}
		})
	}
}
