package model

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupEncryptedCleanupTest(t *testing.T) (boxID, docPath string, dek []byte) {
	boxID, docPath = setupUnusedAssetWorkspace(t)
	oldHistory := util.HistoryDir
	util.HistoryDir = filepath.Join(util.WorkspaceDir, "history")
	markRuntimeEncryptedBox(boxID)
	dek = bytes.Repeat([]byte{0x31}, 32)
	setDEKForTest(boxID, append([]byte(nil), dek...))
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	t.Cleanup(func() {
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
		forgetRuntimeEncryptedBox(boxID)
		setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
		util.HistoryDir = oldHistory
	})
	writeEncryptedCleanupDoc(t, boxID, docPath, dek, "")
	return
}

func writeEncryptedCleanupDoc(t *testing.T, boxID, docPath string, dek []byte, children string) {
	t.Helper()
	id := strings.TrimSuffix(filepath.Base(docPath), ".sy")
	if children == "" {
		children = `{"Type":"NodeParagraph","ID":"20261017000001-abcdefg","Children":[]}`
	}
	data := []byte(`{"Type":"NodeDocument","ID":"` + id + `","Spec":"2","Properties":{"id":"` + id + `","title":"fixture"},"Children":[` + children + `]}`)
	rel, _ := filepath.Rel(filepath.Join(util.DataDir, boxID), docPath)
	ciphertext, err := EncryptFile(boxID, filepath.ToSlash(rel), dek, data)
	if err != nil {
		t.Fatal(err)
	}
	writeEncryptedCleanupFile(t, docPath, ciphertext)
}

func writeEncryptedCleanupFile(t *testing.T, p string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func writeEncryptedCleanupAsset(t *testing.T, boxID, name string, dek []byte, legacy bool) []byte {
	t.Helper()
	data, err := EncryptAsset(boxID, filepath.Base(name), "original-"+filepath.Base(name), dek, []byte("secret content"))
	if err != nil {
		t.Fatal(err)
	}
	if legacy {
		data = legacyEncryptedAssetFixture(t, boxID, filepath.Base(name), "original-"+filepath.Base(name), dek, []byte("secret content"))
	}
	writeEncryptedCleanupFile(t, filepath.Join(util.DataDir, boxID, "assets", name), data)
	return data
}

func TestEncryptedAssetCleanupReferences(t *testing.T) {
	boxID, docPath, dek := setupEncryptedCleanupTest(t)
	for _, name := range []string{"linked.pdf", "linked.pdf.sya", "cover.png", "custom.png", "database.png", "template.png", "agent.png", "runtime.png", "folder/child.png", "unused.png"} {
		writeEncryptedCleanupAsset(t, boxID, name, dek, false)
	}
	writeEncryptedCleanupDoc(t, boxID, docPath, dek,
		`{"Type":"NodeParagraph","ID":"20261017000001-abcdefg","Properties":{"custom-data-assets-extra":"assets/custom.png"},"Children":[{"Type":"NodeTextMark","TextMarkType":"a","TextMarkTextContent":"PDF","TextMarkAHref":"/assets/linked.pdf?page=2"},{"Type":"NodeTextMark","TextMarkType":"a","TextMarkAHref":"assets/folder/"}]}`)
	// 题头图和未挂载数据库都属于持久化引用，不能依赖全局索引或已打开的数据库缓存。
	data, _ := os.ReadFile(docPath)
	plain, _ := DecryptFile(boxID, filepath.Base(docPath), dek, data)
	plain = bytes.Replace(plain, []byte(`"title":"fixture"`), []byte(`"title":"fixture","title-img":"background-image:url(assets/cover.png)"`), 1)
	data, _ = EncryptFile(boxID, filepath.Base(docPath), dek, plain)
	writeEncryptedCleanupFile(t, docPath, data)
	avID := "20261017000002-abcdefg"
	avData := []byte(`{"spec":1,"id":"` + avID + `","keyValues":[],"views":[],"newItemTemplates":[{"name":"assets/template.png"}],"name":"assets/database.png"}`)
	key := util.DeriveSubKey(dek, "siyuan/av")
	avData, err := util.EncryptWithAAD(key, avData, []byte("siyuan:av:"+boxID+":"+avID))
	if err != nil {
		t.Fatal(err)
	}
	writeEncryptedCleanupFile(t, filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json"), avData)
	session := filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", "fixture")
	writeEncryptedCleanupFile(t, filepath.Join(session, "session.json"), []byte(`{"entries":[{"type":"assistant","toolCalls":[{"attachments":[{"path":"assets/agent.png","documentId":"`+strings.TrimSuffix(filepath.Base(docPath), ".sy")+`"}]}]}]}`))
	writeEncryptedCleanupFile(t, filepath.Join(session, "runtime.json"), []byte(`{"activeTurn":{"userContent":"![image](assets/runtime.png)"}}`))
	items, err := UnusedEncryptedBoxAssets(context.Background(), boxID)
	if err != nil || len(items) != 1 || items[0].Item != "assets/unused.png" || items[0].Name != "original-unused.png" {
		t.Fatalf("wrong unused candidates: %+v, %v", items, err)
	}
	// 全局清理继续跳过目标笔记本。
	if global, err := UnusedAssets(false); err != nil || len(global) != 0 {
		t.Fatalf("global cleanup included encrypted assets: %+v, %v", global, err)
	}
}

func TestEncryptedAssetCleanupMultipleAttributeAssets(t *testing.T) {
	boxID, docPath, dek := setupEncryptedCleanupTest(t)
	originals := map[string][]byte{}
	for _, name := range []string{"a.png", "b.png", "space name.png", "comma,name.png"} {
		originals[name] = writeEncryptedCleanupAsset(t, boxID, name, dek, false)
	}
	writeEncryptedCleanupAsset(t, boxID, "unused.png", dek, false)
	writeEncryptedCleanupDoc(t, boxID, docPath, dek,
		`{"Type":"NodeParagraph","ID":"20261017000001-abcdefg","Properties":{"custom-data-assets-list":"assets/a.png assets/b.png,assets/a.png?box=`+boxID+`","custom-data-assets-space":"assets/space name.png","custom-data-assets-comma":"assets/comma,name.png"},"Children":[]}`)
	items, err := UnusedEncryptedBoxAssets(context.Background(), boxID)
	if err != nil || len(items) != 1 || items[0].Item != "assets/unused.png" {
		t.Fatalf("attribute resources were classified as unused: %+v, %v", items, err)
	}
	if _, err = RemoveUnusedEncryptedBoxAssets(context.Background(), boxID, []string{"assets/a.png", "assets/b.png"}); err == nil {
		t.Fatal("accepted referenced attribute resources for deletion")
	}
	for name, original := range originals {
		got, err := os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", name))
		if err != nil || !bytes.Equal(got, original) {
			t.Fatalf("changed referenced resource %s: %v", name, err)
		}
	}
}

func TestEncryptedAssetCleanupRejectsActiveWriter(t *testing.T) {
	boxID, _, dek := setupEncryptedCleanupTest(t)
	original := writeEncryptedCleanupAsset(t, boxID, "unused.png", dek, false)
	avID := "20261017000002-abcdefg"
	view := &av.AttributeView{ID: avID, Spec: av.PlainTextSpec, Views: []*av.View{}, KeyValues: []*av.KeyValues{}}
	av.SetAVBoxID(avID, boxID)
	t.Cleanup(func() { av.SetAVBoxID(avID, "") })
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := AcquireEncryptedBoxOperation(boxID); err != nil {
		t.Fatal(err)
	}
	released := false
	defer func() {
		if !released {
			ReleaseEncryptedBoxOperation(boxID)
		}
	}()
	view.KeyValues = append(view.KeyValues, &av.KeyValues{
		Key: &av.Key{ID: "20261017000003-abcdefg", Name: "asset", Type: av.KeyTypeMAsset},
		Values: []*av.Value{{ID: "20261017000004-abcdefg", Type: av.KeyTypeMAsset,
			MAsset: []*av.ValueAsset{{Type: av.AssetTypeImage, Name: "image", Content: "assets/unused.png"}}}},
	})
	// 写入已取得响应租约，但仍处于读改写阶段，尚未持有保存所需的笔记本读锁。
	if _, err := UnusedEncryptedBoxAssets(context.Background(), boxID); err == nil {
		t.Fatal("scan accepted a pending writer")
	}
	if removed, err := RemoveUnusedEncryptedBoxAssets(context.Background(), boxID, []string{"assets/unused.png"}); err == nil || len(removed) != 0 {
		t.Fatalf("cleanup accepted a pending writer: %v, %v", removed, err)
	}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	ReleaseEncryptedBoxOperation(boxID)
	released = true
	if items, err := UnusedEncryptedBoxAssets(context.Background(), boxID); err != nil || len(items) != 0 {
		t.Fatalf("completed writer's reference was lost: %+v, %v", items, err)
	}
	got, err := os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", "unused.png"))
	if err != nil || !bytes.Equal(got, original) {
		t.Fatalf("pending writer's asset changed: %v", err)
	}
}

func TestEncryptedAssetCleanupDeferredAssets(t *testing.T) {
	full, partial, fullData := prepareAssetDownloadRepoTest(t)
	boxID, docID := "20261017000000-abcdefg", "20261017000001-abcdefg"
	dek := bytes.Repeat([]byte{0x31}, 32)
	doc, err := EncryptFile(boxID, docID+".sy", dek, []byte(`{"Type":"NodeDocument","ID":"`+docID+`","Spec":"2","Properties":{"id":"`+docID+`","title":"fixture"},"Children":[{"Type":"NodeParagraph","Children":[{"Type":"NodeTextMark","TextMarkType":"a","TextMarkAHref":"assets/used.pdf?page=2","TextMarkTextContent":"PDF"},{"Type":"NodeTextMark","TextMarkType":"a","TextMarkAHref":"assets/folder/","TextMarkTextContent":"folder"}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	writeEncryptedCleanupFile(t, filepath.Join(fullData, boxID, docID+".sy"), doc)
	originals := map[string][]byte{}
	for _, name := range []string{"unused.png", "used.pdf", "used.pdf.sya", "folder/kept.png"} {
		data, err := EncryptAsset(boxID, filepath.Base(name), "original-"+filepath.Base(name), dek, []byte("payload"))
		if err != nil {
			t.Fatal(err)
		}
		originals[name] = data
		writeEncryptedCleanupFile(t, filepath.Join(fullData, boxID, "assets", name), data)
	}
	if _, err = full.Index("encrypted fixture", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	markRuntimeEncryptedBox(boxID)
	setDEKForTest(boxID, append([]byte(nil), dek...))
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	t.Cleanup(func() {
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
		forgetRuntimeEncryptedBox(boxID)
		setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
	})
	assetRoot := filepath.Join(util.DataDir, boxID, "assets")
	for _, name := range []string{"unused.png", "used.pdf", "folder/kept.png"} {
		if _, err = os.Stat(filepath.Join(assetRoot, name)); !os.IsNotExist(err) {
			t.Fatalf("fixture resource was not deferred: %s, %v", name, err)
		}
	}
	items, err := UnusedEncryptedBoxAssets(context.Background(), boxID)
	if err != nil || len(items) != 1 || items[0].Item != "assets/unused.png" || items[0].Name != "original-unused.png" {
		t.Fatalf("incorrect deferred cleanup candidates: %+v, %v", items, err)
	}
	for _, name := range []string{"used.pdf", "folder/kept.png"} {
		if _, err = os.Stat(filepath.Join(assetRoot, name)); !os.IsNotExist(err) {
			t.Fatalf("scan downloaded a referenced resource: %s, %v", name, err)
		}
	}
	if _, err = RemoveUnusedEncryptedBoxAssets(context.Background(), boxID, []string{"assets/used.pdf.sya"}); err == nil {
		t.Fatal("accepted annotations belonging to a referenced deferred PDF")
	}
	got, err := os.ReadFile(filepath.Join(assetRoot, "used.pdf.sya"))
	if err != nil || !bytes.Equal(got, originals["used.pdf.sya"]) {
		t.Fatalf("referenced PDF annotations changed: %v", err)
	}
	removed, err := RemoveUnusedEncryptedBoxAssets(context.Background(), boxID, []string{"assets/unused.png"})
	if err != nil || !reflect.DeepEqual(removed, []string{"assets/unused.png"}) {
		t.Fatalf("deferred cleanup failed: %v, %v", removed, err)
	}
	histories, _ := filepath.Glob(filepath.Join(util.HistoryDir, "*-clean", boxID, "assets", "unused.png"))
	if len(histories) != 1 {
		t.Fatalf("missing deferred resource history: %v", histories)
	}
	got, err = os.ReadFile(histories[0])
	if err != nil || !bytes.Equal(got, originals["unused.png"]) {
		t.Fatal("deferred history did not preserve ciphertext")
	}
	if items, err = UnusedEncryptedBoxAssets(context.Background(), boxID); err != nil || len(items) != 0 {
		t.Fatalf("deleted deferred resource reappeared: %+v, %v", items, err)
	}
}

func TestEncryptedAssetCleanupMissingPDFKeepsAnnotations(t *testing.T) {
	boxID, docPath, dek := setupEncryptedCleanupTest(t)
	writeEncryptedCleanupDoc(t, boxID, docPath, dek,
		`{"Type":"NodeParagraph","Children":[{"Type":"NodeTextMark","TextMarkType":"a","TextMarkAHref":"assets/missing%2Epdf?page=2","TextMarkTextContent":"PDF"}]}`)
	writeEncryptedCleanupAsset(t, boxID, "missing.pdf.sya", dek, false)
	if items, err := UnusedEncryptedBoxAssets(context.Background(), boxID); err != nil || len(items) != 0 {
		t.Fatalf("missing PDF's annotations were not protected: %+v, %v", items, err)
	}
}

func TestEncryptedAssetCleanupAbortUnreadable(t *testing.T) {
	for _, kind := range []string{"document authentication", "document JSON", "new spec", "database authentication", "database spec", "database directory", "agent JSON", "asset authentication"} {
		t.Run(kind, func(t *testing.T) {
			boxID, docPath, dek := setupEncryptedCleanupTest(t)
			original := writeEncryptedCleanupAsset(t, boxID, "unused.png", dek, false)
			switch kind {
			case "document authentication":
				writeEncryptedCleanupFile(t, docPath, []byte("corrupt"))
			case "document JSON", "new spec":
				plain := []byte(`{"Type":`)
				if kind == "new spec" {
					plain = []byte(`{"Type":"NodeDocument","Spec":"99"}`)
				}
				data, _ := EncryptFile(boxID, filepath.Base(docPath), dek, plain)
				writeEncryptedCleanupFile(t, docPath, data)
			case "database authentication", "database spec":
				id := "20261017000002-abcdefg"
				data := []byte("corrupt")
				if kind == "database spec" {
					key := util.DeriveSubKey(dek, "siyuan/av")
					data, _ = util.EncryptWithAAD(key, []byte(`{"id":"`+id+`","spec":999}`), []byte("siyuan:av:"+boxID+":"+id))
				}
				writeEncryptedCleanupFile(t, filepath.Join(util.DataDir, boxID, "storage", "av", id+".json"), data)
			case "agent JSON":
				writeEncryptedCleanupFile(t, filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", "fixture", "runtime.json"), []byte("{"))
			case "database directory":
				writeEncryptedCleanupFile(t, filepath.Join(util.DataDir, boxID, "storage", "av"), []byte("not a directory"))
			case "asset authentication":
				original[len(original)-1] ^= 1
				writeEncryptedCleanupFile(t, filepath.Join(util.DataDir, boxID, "assets", "unused.png"), original)
			}
			removed, err := RemoveUnusedEncryptedBoxAssets(context.Background(), boxID, []string{"assets/unused.png"})
			if err == nil || len(removed) != 0 {
				t.Fatalf("incomplete scan deleted data: %v, %v", removed, err)
			}
			got, _ := os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", "unused.png"))
			if !bytes.Equal(got, original) {
				t.Fatal("failed cleanup modified source ciphertext")
			}
			if _, err = os.Stat(util.HistoryDir); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("failed preflight created cleanup history")
			}
		})
	}
}

func TestEncryptedAssetCleanupRevalidatesCandidates(t *testing.T) {
	boxID, docPath, dek := setupEncryptedCleanupTest(t)
	writeEncryptedCleanupAsset(t, boxID, "unused.png", dek, false)
	if items, err := UnusedEncryptedBoxAssets(context.Background(), boxID); err != nil || len(items) != 1 {
		t.Fatalf("initial scan: %v, %v", items, err)
	}
	writeEncryptedCleanupDoc(t, boxID, docPath, dek, `{"Type":"NodeParagraph","Children":[{"Type":"NodeTextMark","TextMarkType":"a","TextMarkAHref":"assets/unused.png","TextMarkTextContent":"reference"}]}`)
	for _, paths := range [][]string{{"assets/unused.png"}, {"assets/../outside"}, {"assets/unused.png?box=other"}} {
		if _, err := RemoveUnusedEncryptedBoxAssets(context.Background(), boxID, paths); err == nil {
			t.Fatalf("accepted stale or invalid candidates: %v", paths)
		}
	}
	if _, err := UnusedEncryptedBoxAssets(context.Background(), ""); err == nil {
		t.Fatal("empty notebook fell back to global cleanup")
	}
	setEncryptedBoxState(boxID, EncryptedBoxStateLocked)
	cachedDEKsLock.Lock()
	delete(cachedDEKs, boxID)
	cachedDEKsLock.Unlock()
	if _, err := UnusedEncryptedBoxAssets(context.Background(), boxID); err == nil {
		t.Fatal("locked notebook was scanned")
	}
}

func TestEncryptedAssetCleanupFailureRollsBack(t *testing.T) {
	boxID, _, dek := setupEncryptedCleanupTest(t)
	originals := map[string][]byte{}
	for _, name := range []string{"a.png", "b.png"} {
		originals[name] = writeEncryptedCleanupAsset(t, boxID, name, dek, false)
	}
	items, err := UnusedEncryptedBoxAssets(context.Background(), boxID)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	err = deleteEncryptedBoxAssets(context.Background(), boxID, dek, items, func(p string) error {
		calls++
		if calls == 2 {
			return errors.New("injected delete failure")
		}
		return os.Remove(p)
	}, nil)
	if err == nil {
		t.Fatal("delete failure was hidden")
	}
	for name, original := range originals {
		data, err := os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", name))
		if err != nil || !bytes.Equal(data, original) {
			t.Fatalf("rollback lost %s: %v", name, err)
		}
	}
}

func TestEncryptedAssetCleanupHistoryCompatibility(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "legacy"}[legacy], func(t *testing.T) {
			boxID, _, dek := setupEncryptedCleanupTest(t)
			original := writeEncryptedCleanupAsset(t, boxID, "sub/unused.png", dek, legacy)
			removed, err := RemoveUnusedEncryptedBoxAssets(context.Background(), boxID, []string{"assets/sub/unused.png"})
			if err != nil || !reflect.DeepEqual(removed, []string{"assets/sub/unused.png"}) {
				t.Fatalf("cleanup failed: %v, %v", removed, err)
			}
			histories, _ := filepath.Glob(filepath.Join(util.HistoryDir, "*-clean", boxID, "assets", "sub", "unused.png"))
			if len(histories) != 1 {
				t.Fatalf("missing ciphertext history: %v", histories)
			}
			data, _ := os.ReadFile(histories[0])
			if !bytes.Equal(data, original) {
				t.Fatal("history was re-encrypted or corrupted")
			}
			rel, _ := filepath.Rel(util.WorkspaceDir, histories[0])
			if err = RollbackAssetsHistory(filepath.ToSlash(rel)); err != nil {
				t.Fatal(err)
			}
			data, _ = os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", "sub", "unused.png"))
			if !bytes.Equal(data, original) {
				t.Fatal("history restore changed ciphertext or target path")
			}
			data[len(data)-1] ^= 1
			writeEncryptedCleanupFile(t, histories[0], data)
			if err = RollbackAssetsHistory(filepath.ToSlash(rel)); err == nil {
				t.Fatal("unauthenticated history was restored")
			}
		})
	}
}

func TestEncryptedAssetCleanupInterruptedRecovery(t *testing.T) {
	boxID, _, dek := setupEncryptedCleanupTest(t)
	original := writeEncryptedCleanupAsset(t, boxID, "unused.png", dek, false)
	root := encryptedAssetCleanupDir(boxID)
	backup := filepath.Join(root, "assets", "unused.png")
	writeEncryptedCleanupFile(t, backup, original)
	hash, _ := encryptedCleanupFileHash(backup)
	journal := encryptedAssetCleanupJournal{Spec: 1, Files: []encryptedAssetCleanupFile{{Path: "assets/unused.png", Hash: hash}}}
	journal.Checksum = encryptedCleanupJournalChecksum(&journal)
	data, _ := json.Marshal(journal)
	writeEncryptedCleanupFile(t, filepath.Join(root, "manifest.json"), data)
	live := filepath.Join(util.DataDir, boxID, "assets", "unused.png")
	if err := os.Remove(live); err != nil {
		t.Fatal(err)
	}
	if err := recoverEncryptedAssetCleanupOperations(); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(live)
	if !bytes.Equal(got, original) {
		t.Fatal("interrupted cleanup did not restore ciphertext")
	}
	// 错误清单不得改写笔记本目录之外的数据。
	journal.Files[0].Path = "assets/../../outside"
	journal.Checksum = encryptedCleanupJournalChecksum(&journal)
	data, _ = json.Marshal(journal)
	writeEncryptedCleanupFile(t, filepath.Join(root, "manifest.json"), data)
	if err := recoverEncryptedAssetCleanupOperations(); err == nil {
		t.Fatal("invalid recovery path accepted")
	}
}

func TestEncryptedAssetCleanupCommitFailureRollsBack(t *testing.T) {
	boxID, _, dek := setupEncryptedCleanupTest(t)
	original := writeEncryptedCleanupAsset(t, boxID, "unused.png", dek, false)
	items, err := UnusedEncryptedBoxAssets(context.Background(), boxID)
	if err != nil {
		t.Fatal(err)
	}
	err = deleteEncryptedBoxAssets(context.Background(), boxID, dek, items, func(p string) error {
		if err := os.Remove(p); err != nil {
			return err
		}
		// 用目录阻止提交标记落盘，验证失败不能把已删除批次当成成功。
		manifest := filepath.Join(encryptedAssetCleanupDir(boxID), "manifest.json")
		if err := os.Remove(manifest); err != nil {
			return err
		}
		return os.Mkdir(manifest, 0700)
	}, nil)
	if err == nil {
		t.Fatal("commit failure was hidden")
	}
	got, readErr := os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", "unused.png"))
	if readErr != nil || !bytes.Equal(got, original) {
		t.Fatalf("commit failure lost source ciphertext: %v", readErr)
	}
}

func TestEncryptedAssetCleanupSourceChangeRollsBack(t *testing.T) {
	boxID, docPath, dek := setupEncryptedCleanupTest(t)
	original := writeEncryptedCleanupAsset(t, boxID, "unused.png", dek, false)
	items, err := UnusedEncryptedBoxAssets(context.Background(), boxID)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := encryptedCleanupSourceDigest(context.Background(), boxID)
	err = deleteEncryptedBoxAssets(context.Background(), boxID, dek, items, func(p string) error {
		if err := os.Remove(p); err != nil {
			return err
		}
		writeEncryptedCleanupDoc(t, boxID, docPath, dek, `{"Type":"NodeParagraph","Children":[{"Type":"NodeTextMark","TextMarkType":"a","TextMarkAHref":"assets/unused.png"}]}`)
		return nil
	}, func() error {
		after, err := encryptedCleanupSourceDigest(context.Background(), boxID)
		if err != nil {
			return err
		}
		if before != after {
			return errors.New("references changed")
		}
		return nil
	})
	if err == nil {
		t.Fatal("changed references were ignored")
	}
	got, _ := os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", "unused.png"))
	if !bytes.Equal(got, original) {
		t.Fatal("changed references did not restore source asset")
	}
}

func TestEncryptedAssetCleanupLockWaits(t *testing.T) {
	boxID, _, _ := setupEncryptedCleanupTest(t)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		_ = withEncryptedAssetCleanup(context.Background(), boxID, func([]byte) error {
			close(entered)
			<-release
			return nil
		})
		close(done)
	}()
	<-entered
	locked := make(chan struct{})
	go func() {
		beginEncryptedBoxLock(boxID)
		close(locked)
	}()
	select {
	case <-locked:
		t.Fatal("locking did not wait for cleanup")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case <-locked:
	case <-time.After(3 * time.Second):
		t.Fatal("cleanup leaked operation lease")
	}
	<-done
}

func TestEncryptedAssetCleanupPausesNewOperations(t *testing.T) {
	boxID, _, _ := setupEncryptedCleanupTest(t)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		_ = withEncryptedAssetCleanup(context.Background(), boxID, func([]byte) error {
			close(entered)
			<-release
			return nil
		})
		close(done)
	}()
	<-entered
	admitted := make(chan error, 1)
	go func() {
		err := AcquireEncryptedBoxOperation(boxID)
		if err == nil {
			ReleaseEncryptedBoxOperation(boxID)
		}
		admitted <- err
	}()
	select {
	case <-admitted:
		close(release)
		<-done
		t.Fatal("new operation entered during cleanup")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case err := <-admitted:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cleanup did not reopen operation admission")
	}
	<-done
}

func TestEncryptedAssetCleanupReadConflictReturnsWithoutWaiting(t *testing.T) {
	boxID, _, _ := setupEncryptedCleanupTest(t)
	HoldBoxReadLock(boxID)
	if _, err := UnusedEncryptedBoxAssets(context.Background(), boxID); err == nil {
		ReleaseBoxReadLock(boxID)
		t.Fatal("cleanup admitted a conflicting notebook reader")
	}
	ReleaseBoxReadLock(boxID)
	if _, err := UnusedEncryptedBoxAssets(context.Background(), boxID); err != nil {
		t.Fatalf("failed cleanup did not reopen admission: %v", err)
	}
}
