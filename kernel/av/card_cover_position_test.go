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

import "testing"

func TestCardCoverSource(t *testing.T) {
	const keyID = "20200101000000-abcdefg"
	if CardCoverSourceContent != CardCoverSource(CoverFromContentImage, "") {
		t.Fatal("content image source mismatch")
	}
	if "asset:"+keyID != CardCoverSource(CoverFromAssetField, keyID) {
		t.Fatal("asset source mismatch")
	}
	if "" != CardCoverSource(CoverFromContentBlock, "") {
		t.Fatal("content block should not have an image source")
	}
	if !IsValidCardCoverSource(CardCoverSourceContent) || !IsValidCardCoverSource("asset:"+keyID) {
		t.Fatal("valid cover source rejected")
	}
	if IsValidCardCoverSource("asset:invalid") || IsValidCardCoverSource("unknown") {
		t.Fatal("invalid cover source accepted")
	}
}

func TestAttributeViewCardCoverPosition(t *testing.T) {
	attrView := &AttributeView{}
	position := &CardCoverPosition{Image: "assets/cover.png", X: 25, Y: 75}
	attrView.SetCardCoverPosition("item1", CardCoverSourceContent, position)

	got := attrView.GetCardCoverPosition("item1", CardCoverSourceContent, position.Image)
	if nil == got || position.Image != got.Image || position.X != got.X || position.Y != got.Y {
		t.Fatalf("unexpected card cover position: %+v", got)
	}
	got.X = 10
	if position.X != attrView.GetCardCoverPosition("item1", CardCoverSourceContent, position.Image).X {
		t.Fatal("returned card cover position must be copied")
	}
	if nil != attrView.GetCardCoverPosition("item1", CardCoverSourceContent, "assets/replaced.png") {
		t.Fatal("replaced image should reset the effective position")
	}
	if nil != attrView.CardCoverPositions || !attrView.HasCardCoverPositionChanges() {
		t.Fatal("replaced image should remove the stored position")
	}
	attrView.ResetCardCoverPositionChanges()
	if attrView.HasCardCoverPositionChanges() {
		t.Fatal("card cover position change flag should be reset")
	}

	attrView.SetCardCoverPosition("item1", CardCoverSourceContent, position)
	attrView.CopyCardCoverPositions("item1", "item2")
	copied := attrView.GetCardCoverPosition("item2", CardCoverSourceContent, position.Image)
	if nil == copied || position.X != copied.X || position.Y != copied.Y {
		t.Fatalf("unexpected copied card cover position: %+v", copied)
	}
	attrView.RemoveCardCoverPositionsBySource(CardCoverSourceContent)
	if 0 != len(attrView.CardCoverPositions) {
		t.Fatal("cover positions should be removed with their source")
	}
}

func TestAttributeViewResetCardCoverPosition(t *testing.T) {
	attrView := &AttributeView{}
	attrView.SetCardCoverPosition("item1", CardCoverSourceContent,
		&CardCoverPosition{Image: "assets/cover.png", X: 25, Y: 75})
	attrView.SetCardCoverPosition("item1", CardCoverSourceContent, nil)

	if nil != attrView.CardCoverPositions {
		t.Fatal("reset should keep card cover positions sparse")
	}
}
