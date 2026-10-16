package av

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEncryptedAttributeViewSaveReplacesCiphertext(t *testing.T) {
	testEncryptedAttributeViewSaveReplacesCiphertext(t, false)
}

func TestEncryptedDeprecatedLayoutRecovery(t *testing.T) {
	testEncryptedAttributeViewSaveReplacesCiphertext(t, true)
}

func testEncryptedAttributeViewSaveReplacesCiphertext(t *testing.T, legacy bool) {
	t.Helper()
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
	file := attributeViewDataPathByBox(avID, boxID)
	if legacy {
		raw, err := os.ReadFile("testdata/spec1-deprecated-layouts.json")
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(raw, view); err != nil {
			t.Fatal(err)
		}
		view.Name = "first encrypted version"
		raw, err = json.Marshal(view)
		if err != nil {
			t.Fatal(err)
		}
		ciphertext, err := encryptAVData(boxID, avID, raw)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(file, ciphertext, 0600); err != nil {
			t.Fatal(err)
		}
		view, err = ParseAttributeViewInBox(avID, boxID)
		if err != nil {
			t.Fatal(err)
		}
	} else if err := SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
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
	if legacy && (previous.Spec != 1 || len(previous.Views[0].Table.RowIDs) != 2 ||
		len(loaded.Views[0].ItemIDs) != 2 || loaded.Views[0].PageSize != 25) {
		t.Fatal("encrypted save lost legacy layout data or its recovery source")
	}
}
