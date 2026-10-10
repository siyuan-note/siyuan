package av

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEncryptedAttributeViewSaveReplacesCiphertext(t *testing.T) {
	const boxID, avID = "20261010120000-encbox0", "20261010120001-encav00"
	oldData := util.DataDir
	oldDEK, oldEncrypted, oldUnlocked := AVDEKProvider, AVIsEncryptedBox, AVIsBoxUnlocked
	oldAcquire, oldRelease := AVLockAcquire, AVLockRelease
	util.DataDir = t.TempDir()
	key := bytes.Repeat([]byte{0x71}, 32)
	AVDEKProvider = func(string) ([]byte, error) { return key, nil }
	AVIsEncryptedBox = func(id string) bool { return id == boxID }
	AVIsBoxUnlocked = func(string) bool { return true }
	AVLockAcquire, AVLockRelease = func(string) {}, func(string) {}
	SetAVBoxID(avID, boxID)
	t.Cleanup(func() {
		SetAVBoxID(avID, "")
		cache.RemoveAVDataInBox(avID, boxID)
		util.DataDir = oldData
		AVDEKProvider, AVIsEncryptedBox, AVIsBoxUnlocked = oldDEK, oldEncrypted, oldUnlocked
		AVLockAcquire, AVLockRelease = oldAcquire, oldRelease
	})
	view := &AttributeView{ID: avID, Spec: PlainTextSpec}
	view.Name = "first encrypted version"
	if err := SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	file := attributeViewDataPathByBox(avID, boxID)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(filepath.Dir(file), "original-ciphertext")
	if err := os.Link(file, link); err != nil {
		t.Fatal(err)
	}
	view.Name = "second encrypted version with different length"
	if err := SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	retained, err := os.ReadFile(link)
	if err != nil || !bytes.Equal(before, retained) {
		t.Fatalf("save modified the previous ciphertext in place: %v", err)
	}
	cache.RemoveAVDataInBox(avID, boxID)
	loaded, err := ParseAttributeViewInBox(avID, boxID)
	if err != nil || loaded.Name != view.Name {
		t.Fatalf("updated ciphertext did not authenticate: %+v, %v", loaded, err)
	}
	plain, err := decryptAVData(boxID, avID, retained)
	if err != nil {
		t.Fatal(err)
	}
	previous, err := ParseAttributeViewData(avID, plain)
	if err != nil || previous.Name != "first encrypted version" {
		t.Fatalf("previous ciphertext is not recoverable: %+v, %v", previous, err)
	}
}
