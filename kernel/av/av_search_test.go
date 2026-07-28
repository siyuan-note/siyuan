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

import "testing"

func TestParseAttributeViewSearchInfo(t *testing.T) {
	data := []byte(`{
		"spec": 6,
		"name": "Schedule",
		"keyValues": [{"key": {"name": "Ignored"}}],
		"views": [
			{"id": "view-1", "name": "状态：进行", "type": "table", "table": {"columns": []}},
			{"id": "view-2", "name": "分类：项目", "type": "gallery", "gallery": {"fields": []}}
		]
	}`)

	info, err := parseAttributeViewSearchInfo(data)
	if err != nil {
		t.Fatalf("parse search info failed: %s", err)
	}
	if info.Name != "Schedule" || len(info.Views) != 2 {
		t.Fatalf("unexpected search info: %+v", info)
	}
	if info.Views[0].ID != "view-1" || info.Views[0].Name != "状态：进行" ||
		info.Views[0].LayoutType != LayoutTypeTable {
		t.Fatalf("unexpected first view: %+v", info.Views[0])
	}
	if info.Views[1].LayoutType != LayoutTypeGallery {
		t.Fatalf("unexpected second view: %+v", info.Views[1])
	}

	if _, err = parseAttributeViewSearchInfo([]byte(`{"spec": 7}`)); err != ErrSpecTooNew {
		t.Fatalf("expected newer spec error, got %v", err)
	}
}
