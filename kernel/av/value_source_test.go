// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import "testing"

func TestResolveValueSource(t *testing.T) {
	value := &Value{
		Type:            KeyTypeNumber,
		Number:          &ValueNumber{Content: 42, IsNotEmpty: true},
		RenderedContent: "forty-two",
	}
	if value != ResolveValueSource(value, "") || value != ResolveValueSource(value, ValueSourceStored) {
		t.Fatal("empty and stored sources should preserve the stored value")
	}

	rendered := ResolveValueSource(value, ValueSourceRendered)
	if KeyTypeTemplate != rendered.Type || nil == rendered.Template || "forty-two" != rendered.Template.Content {
		t.Fatalf("unexpected rendered value: %+v", rendered)
	}
	if KeyTypeNumber != value.Type || nil == value.Number {
		t.Fatal("resolving a rendered value should not mutate the stored value")
	}
}
