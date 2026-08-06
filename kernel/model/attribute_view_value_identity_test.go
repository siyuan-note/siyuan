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

package model

import (
	"errors"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestUpdateAttributeViewValuePreservesTargetIdentity(t *testing.T) {
	const (
		targetValueID   = "20260806000000-targetv"
		targetKeyID     = "20260806000001-targetk"
		targetItemID    = "20260806000002-targeti"
		sourceValueID   = "20260806000003-sourcev"
		sourceKeyID     = "20260806000004-sourcek"
		sourceItemID    = "20260806000005-sourcei"
		targetCreatedAt = int64(100)
	)
	target := &av.Value{
		ID:         targetValueID,
		KeyID:      targetKeyID,
		BlockID:    targetItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		CreatedAt:  targetCreatedAt,
		UpdatedAt:  101,
		Block:      &av.ValueBlock{Content: "target"},
	}
	attrView := &av.AttributeView{
		ID: "20260806000006-avtest1",
		KeyValues: []*av.KeyValues{{
			Key:    &av.Key{ID: targetKeyID, Type: av.KeyTypeBlock},
			Values: []*av.Value{target},
		}},
	}
	source := &av.Value{
		ID:         sourceValueID,
		KeyID:      sourceKeyID,
		BlockID:    sourceItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		CreatedAt:  200,
		UpdatedAt:  201,
		Block:      &av.ValueBlock{Content: "source"},
	}

	updated, err := updateAttributeViewValue(nil, attrView, targetKeyID, targetItemID, source, false)
	if nil != err {
		t.Fatal(err)
	}
	if updated != target {
		t.Fatal("updated value should keep the target value instance")
	}
	if targetValueID != updated.ID || targetKeyID != updated.KeyID || targetItemID != updated.BlockID ||
		av.KeyTypeBlock != updated.Type || targetCreatedAt != updated.CreatedAt {
		t.Fatalf("target identity was overwritten: %+v", updated)
	}
	if nil == updated.Block || "source" != updated.Block.Content {
		t.Fatalf("source content was not applied: %+v", updated.Block)
	}
	if source.UpdatedAt == updated.UpdatedAt {
		t.Fatalf("source update time was retained: %d", updated.UpdatedAt)
	}
}

func TestUpdateAttributeViewValueRejectsMissingKey(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{
		Key: &av.Key{ID: "20260806000000-existing", Type: av.KeyTypeText},
	}}}

	_, err := updateAttributeViewValue(nil, attrView, "20260806000001-missing", "20260806000002-item001",
		&av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "source"}}, false)
	if !errors.Is(err, av.ErrKeyNotFound) {
		t.Fatalf("missing key returned error [%v]", err)
	}
}

func TestCheckAttrViewCorrectsValueKeyID(t *testing.T) {
	const targetKeyID = "20260806000000-targetk"
	value := &av.Value{KeyID: "20260806000001-sourcek", Type: av.KeyTypeText}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{
		Key:    &av.Key{ID: targetKeyID, Type: av.KeyTypeText},
		Values: []*av.Value{value},
	}}}

	if !checkAttrView(attrView, &av.View{}) {
		t.Fatal("correcting a value key ID should mark the attribute view as changed")
	}
	if targetKeyID != value.KeyID {
		t.Fatalf("value key ID was not corrected: %s", value.KeyID)
	}
}
