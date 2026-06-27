// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package av

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
)

// TestParseAttributeViewKeysByPath 校验流式 keys-only 解析读出的元数据完整，且 Values 被跳过。
func TestParseAttributeViewKeysByPath(t *testing.T) {
	tmpDir := t.TempDir()
	avID := "20260611104916-testkeys01"
	avJSONPath := filepath.Join(tmpDir, avID+".json")
	// 字段顺序与真实 av.json 一致；values 含嵌套对象/数组，覆盖 Skip 对复杂结构的处理
	avJSON := `{
		"spec": 5,
		"id": "` + avID + `",
		"name": "测试库",
		"viewID": "20260611104916-v01",
		"keyIDs": ["k1", "k2"],
		"keyValues": [
			{
				"key": {"id": "k1", "name": "主键", "type": "block"},
				"values": [
					{"id": "v1", "keyID": "k1", "blockID": "b1", "type": "block", "number": {"content": 1.5, "isNotEmpty": true}, "mSelect": [{"content": "选项A", "color": "1"}]},
					{"id": "v2", "keyID": "k1", "blockID": "b2", "type": "block"}
				]
			},
			{
				"key": {"id": "k2", "name": "字段B", "type": "text"},
				"values": [
					{"id": "v3", "keyID": "k2", "blockID": "b1", "type": "text"}
				]
			}
		],
		"views": [
			{"id": "20260611104916-v01", "name": "视图1", "layoutType": 0}
		]
	}`
	if err := os.WriteFile(avJSONPath, []byte(avJSON), 0644); err != nil {
		t.Fatalf("write temp av.json failed: %s", err)
	}
	cache.ClearAVCache()

	keysAV, err := ParseAttributeViewKeysByPath(avJSONPath)
	if err != nil {
		t.Fatalf("ParseAttributeViewKeysByPath failed: %s", err)
	}

	if keysAV.Spec != CurrentSpec {
		t.Errorf("Spec = %d, want %d", keysAV.Spec, CurrentSpec)
	}
	if keysAV.ID != avID {
		t.Errorf("ID = %q, want %q", keysAV.ID, avID)
	}
	if keysAV.Name != "测试库" {
		t.Errorf("Name = %q, want %q", keysAV.Name, "测试库")
	}
	if keysAV.ViewID != "20260611104916-v01" {
		t.Errorf("ViewID = %q, want %q", keysAV.ViewID, "20260611104916-v01")
	}
	if len(keysAV.KeyIDs) != 2 || keysAV.KeyIDs[0] != "k1" || keysAV.KeyIDs[1] != "k2" {
		t.Errorf("KeyIDs = %v, want [k1 k2]", keysAV.KeyIDs)
	}
	if len(keysAV.Views) != 1 || keysAV.Views[0].ID != "20260611104916-v01" {
		t.Errorf("Views = %+v, want 1 view with id 20260611104916-v01", keysAV.Views)
	}

	if len(keysAV.KeyValues) != 2 {
		t.Fatalf("KeyValues len = %d, want 2", len(keysAV.KeyValues))
	}
	for i, kv := range keysAV.KeyValues {
		if kv.Key == nil {
			t.Fatalf("KeyValues[%d].Key is nil", i)
		}
		if len(kv.Values) != 0 {
			t.Errorf("KeyValues[%d] (key %s) Values len = %d, want 0", i, kv.Key.ID, len(kv.Values))
		}
	}
	if keysAV.KeyValues[0].Key.ID != "k1" || keysAV.KeyValues[0].Key.Name != "主键" {
		t.Errorf("KeyValues[0].Key = %+v, want id=k1 name=主键", keysAV.KeyValues[0].Key)
	}
	if keysAV.KeyValues[1].Key.ID != "k2" || keysAV.KeyValues[1].Key.Name != "字段B" {
		t.Errorf("KeyValues[1].Key = %+v, want id=k2 name=字段B", keysAV.KeyValues[1].Key)
	}

	if keysAV.RenderedViewables == nil {
		t.Error("RenderedViewables is nil, want empty map")
	}
}

// TestParseAttributeViewKeysByPath_OldSpecFallback 校验非当前 spec 回退全量解析，全量能读出 Values。
func TestParseAttributeViewKeysByPath_OldSpecFallback(t *testing.T) {
	tmpDir := t.TempDir()
	avID := "20260611104916-testold01"
	avJSONPath := filepath.Join(tmpDir, avID+".json")
	avJSON := `{
		"spec": 0,
		"id": "` + avID + `",
		"name": "旧版本库",
		"keyValues": [
			{
				"key": {"id": "k1", "name": "字段A", "type": "block"},
				"values": [
					{"id": "v1", "keyID": "k1", "blockID": "20260101000000-abc123", "type": "block"}
				]
			}
		]
	}`
	if err := os.WriteFile(avJSONPath, []byte(avJSON), 0644); err != nil {
		t.Fatalf("write temp av.json failed: %s", err)
	}
	cache.ClearAVCache()

	oldAV, err := ParseAttributeViewKeysByPath(avJSONPath)
	if err != nil {
		t.Fatalf("ParseAttributeViewKeysByPath (old spec) failed: %s", err)
	}

	if len(oldAV.KeyValues) != 1 {
		t.Fatalf("KeyValues len = %d, want 1", len(oldAV.KeyValues))
	}
	if len(oldAV.KeyValues[0].Values) != 1 {
		t.Errorf("fallback: KeyValues[0].Values len = %d, want 1", len(oldAV.KeyValues[0].Values))
	}
}

// TestParseAttributeViewKeysByPath_NotExist 校验文件不存在时返回 ErrViewNotFound。
func TestParseAttributeViewKeysByPath_NotExist(t *testing.T) {
	_, err := ParseAttributeViewKeysByPath("/nonexistent/path/av.json")
	if err != ErrViewNotFound {
		t.Errorf("err = %v, want ErrViewNotFound", err)
	}
}

// TestSaveAttributeView_RejectKeysOnly 校验 keys-only 解析结果不会被落盘（静默跳过），避免数据丢失。
func TestSaveAttributeView_RejectKeysOnly(t *testing.T) {
	tmpDir := t.TempDir()
	avID := "20260611104916-testsave01"
	avJSONPath := filepath.Join(tmpDir, avID+".json")
	avJSON := `{"spec":5,"id":"` + avID + `","name":"库","keyValues":[{"key":{"id":"k1","name":"主键","type":"block"},"values":[{"id":"v1","keyID":"k1","blockID":"b1","type":"block"}]}],"views":[]}`
	if err := os.WriteFile(avJSONPath, []byte(avJSON), 0644); err != nil {
		t.Fatalf("write av.json failed: %s", err)
	}
	cache.ClearAVCache()

	// keys-only 解析：Values 被跳过
	keysAV, err := ParseAttributeViewKeysByPath(avJSONPath)
	if err != nil {
		t.Fatalf("parse failed: %s", err)
	}
	if !keysAV.keysOnlyParsed {
		t.Fatal("keysOnlyParsed flag not set")
	}

	// 尝试保存 keys-only 对象：应静默跳过（无 error），不写文件
	if err := SaveAttributeView(keysAV); err != nil {
		t.Fatalf("SaveAttributeView returned error for keys-only: %s", err)
	}

	// 重新全量解析，确认磁盘上的 Values 仍在（未被空 Values 覆盖）
	cache.ClearAVCache()
	fullAV, err := ParseAttributeViewByPath(avJSONPath)
	if err != nil {
		t.Fatalf("re-parse failed: %s", err)
	}
	if len(fullAV.KeyValues) != 1 || len(fullAV.KeyValues[0].Values) != 1 {
		t.Errorf("disk data corrupted: KeyValues[0].Values len = %d, want 1 (keys-only save must not overwrite)", len(fullAV.KeyValues[0].Values))
	}
}
