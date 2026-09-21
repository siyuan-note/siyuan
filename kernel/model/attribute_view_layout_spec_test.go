package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewLayoutSpecLegacyRecovery(t *testing.T) {
	fixture, err := os.ReadFile("../av/testdata/spec9-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	const avID = "20260921000000-layouts"
	for _, encrypted := range []bool{false, true} {
		name := "ordinary"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			setupAttributeViewValidationTest(t)
			boxID := ""
			source := append([]byte(nil), fixture...)
			if encrypted {
				boxID = "20260921000000-cryptob"
				cleanup := prepareEncryptedBoxLifecycleTest(t, boxID)
				t.Cleanup(cleanup)
				av.SetAVBoxID(avID, boxID)
				t.Cleanup(func() { av.SetAVBoxID(avID, "") })
				source, err = av.EncryptAVData(boxID, avID, fixture)
				if err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(util.DataDir, boxID, "storage", "av", avID+".json")
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, source, 0600); err != nil {
				t.Fatal(err)
			}
			original, err := av.ParseAttributeViewForIndexInBox(avID, boxID)
			if err != nil || original.Spec != 9 {
				t.Fatalf("legacy source read: %v", err)
			}
			before, _ := os.ReadFile(path)
			if !bytes.Equal(source, before) {
				t.Fatal("reading rewrote the legacy source")
			}
			for _, view := range original.Views {
				if exported := getAttrViewTable(original, view, ""); exported == nil || len(exported.Rows) != 1 {
					t.Fatalf("legacy layout export failed: %s", view.LayoutType)
				}
			}
			if err := av.SaveAttributeView(original); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			upgraded, err := av.ParseAttributeViewForIndexInBox(avID, boxID)
			if err != nil || upgraded.Spec != 10 || !reflect.DeepEqual(upgraded.Views, original.Views) {
				t.Fatalf("upgraded layout read: %v", err)
			}

			// 历史或备份保留的旧源仍须先认证，再解析并恢复，不能依赖当前文件的格式版本。
			plain, err := decryptHistoricalAttributeView(boxID, avID, source)
			if err != nil {
				t.Fatal(err)
			}
			historical, err := av.ParseAttributeViewData(avID, plain)
			if err != nil || historical.Spec != 9 {
				t.Fatalf("historical layout read: %v", err)
			}
			if err := av.SaveAttributeView(historical); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			restored, err := av.ParseAttributeViewForIndexInBox(avID, boxID)
			if err != nil || restored.Spec != 10 || !reflect.DeepEqual(upgraded.Views, restored.Views) {
				t.Fatalf("legacy backup recovery lost layouts: %v", err)
			}
			if encrypted {
				stored, err := os.ReadFile(path)
				if err != nil || !util.IsCiphertext(stored) {
					t.Fatal("upgrade did not retain encryption")
				}
				corrupt := append([]byte(nil), source...)
				corrupt[len(corrupt)-1] ^= 1
				if _, err := decryptHistoricalAttributeView(boxID, avID, corrupt); err == nil {
					t.Fatal("unauthenticated historical source was accepted")
				}
				preserved, _ := os.ReadFile(path)
				if !bytes.Equal(stored, preserved) {
					t.Fatal("authentication failure changed the current database")
				}
			}
		})
	}
}
