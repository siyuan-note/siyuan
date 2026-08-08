// SiYuan - From thought to insight, with agents
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
	"encoding/json"
	"math"
	"testing"
)

func TestUpgradeSpec6CardConfiguration(t *testing.T) {
	attrView := &AttributeView{
		Spec: 5,
		Views: []*View{{
			Gallery: &LayoutGallery{
				CardSize:        CardSizeSmall,
				CardAspectRatio: CardAspectRatio3_4,
			},
			Kanban: &LayoutKanban{
				CardSize:        CardSizeLarge,
				CardAspectRatio: CardAspectRatio2_3,
			},
		}},
	}

	UpgradeSpec(attrView)

	if CurrentSpec != attrView.Spec {
		t.Fatalf("expected spec %d, got %d", CurrentSpec, attrView.Spec)
	}
	if 180 != attrView.Views[0].Gallery.CardWidth {
		t.Fatalf("expected gallery width 180, got %d", attrView.Views[0].Gallery.CardWidth)
	}
	if math.Abs(3.0/4.0-attrView.Views[0].Gallery.CardAspectRatioValue) > 1e-9 {
		t.Fatalf("unexpected gallery aspect ratio %v", attrView.Views[0].Gallery.CardAspectRatioValue)
	}
	if 320 != attrView.Views[0].Kanban.CardWidth {
		t.Fatalf("expected kanban width 320, got %d", attrView.Views[0].Kanban.CardWidth)
	}
	if math.Abs(2.0/3.0-attrView.Views[0].Kanban.CardAspectRatioValue) > 1e-9 {
		t.Fatalf("unexpected kanban aspect ratio %v", attrView.Views[0].Kanban.CardAspectRatioValue)
	}
}

func TestUpgradeSpec7RemovesPersistedCurrentView(t *testing.T) {
	attrView := &AttributeView{}
	if err := json.Unmarshal([]byte(`{"spec":6,"viewID":"legacy-view","views":[]}`), attrView); nil != err {
		t.Fatal(err)
	}
	UpgradeSpec(attrView)
	if 7 != attrView.Spec {
		t.Fatalf("expected spec 7, got %d", attrView.Spec)
	}
	data, err := json.Marshal(attrView)
	if nil != err {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); nil != err {
		t.Fatal(err)
	}
	if _, ok := fields["viewID"]; ok {
		t.Fatalf("legacy viewID was persisted: %s", data)
	}
}
