// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"encoding/json"
	"math"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func orderValueFingerprint(values []*av.Value) ([32]byte, error) {
	digest := sha256.New()
	encoder := json.NewEncoder(digest)
	if err := encoder.Encode(len(values)); err != nil {
		return [32]byte{}, err
	}
	fingerprint := attributeViewOrderFingerprint{digest: digest}
	if err := fingerprint.writeValues(encoder, values); err != nil {
		return [32]byte{}, err
	}
	var result [32]byte
	digest.Sum(result[:0])
	return result, nil
}

func TestAttributeViewOrderFingerprintCoversPersistedValueFields(t *testing.T) {
	// 增加字段时同时决定流式表示或完整 JSON 回退，避免新字段静默漏出失效边界。
	for _, test := range []struct {
		typ    reflect.Type
		fields []string
	}{
		{reflect.TypeFor[av.Value](), []string{"ID", "KeyID", "BlockID", "Type", "IsDetached", "CreatedAt", "UpdatedAt",
			"Block", "Text", "Number", "Date", "MSelect", "URL", "Email", "Phone", "Location", "MAsset", "Template",
			"Created", "Updated", "Checkbox", "Relation", "Rollup", "RenderedContent", "HasRenderTemplate"}},
		{reflect.TypeFor[av.ValueBlock](), []string{"CollectionRuleID", "ID", "Icon", "Content", "RefSubtype", "Created", "Updated"}},
		{reflect.TypeFor[av.ValueText](), []string{"Content", "Rich"}},
		{reflect.TypeFor[av.ValueTemplate](), []string{"Content"}},
	} {
		var actual []string
		for _, field := range reflect.VisibleFields(test.typ) {
			if field.IsExported() && field.Tag.Get("json") != "-" {
				actual = append(actual, field.Name)
			}
		}
		slices.Sort(actual)
		slices.Sort(test.fields)
		if !slices.Equal(actual, test.fields) {
			t.Fatalf("%s fingerprint field coverage changed: got %v, want %v", test.typ, actual, test.fields)
		}
	}

	for _, field := range reflect.VisibleFields(reflect.TypeFor[av.Value]()) {
		if field.Tag.Get("json") == "-" {
			continue
		}
		t.Run(field.Name, func(t *testing.T) {
			value := &av.Value{}
			before, err := orderValueFingerprint([]*av.Value{value})
			if err != nil {
				t.Fatal(err)
			}
			changed := reflect.ValueOf(value).Elem().FieldByName(field.Name)
			switch changed.Kind() {
			case reflect.String:
				changed.SetString("changed")
			case reflect.Bool:
				changed.SetBool(true)
			case reflect.Int64:
				changed.SetInt(-1)
			case reflect.Pointer:
				changed.Set(reflect.New(changed.Type().Elem()))
			case reflect.Slice:
				changed.Set(reflect.MakeSlice(changed.Type(), 1, 1))
			default:
				t.Fatalf("unhandled value field %s", field.Name)
			}
			after, err := orderValueFingerprint([]*av.Value{value})
			if err != nil || before == after {
				t.Fatalf("field did not invalidate fingerprint: %v", err)
			}
		})
	}
}

func TestAttributeViewOrderFingerprintRetainsPayloadFieldsAndBoundaries(t *testing.T) {
	for _, test := range []struct {
		name         string
		first, other []*av.Value
	}{
		{"string boundaries", []*av.Value{{ID: "ab", KeyID: "c"}}, []*av.Value{{ID: "a", KeyID: "bc"}}},
		{"nil and empty value", []*av.Value{nil}, []*av.Value{{}}},
		{"nil and empty text", []*av.Value{{}}, []*av.Value{{Text: &av.ValueText{}}}},
		{"empty slice", nil, []*av.Value{{}}},
		{"long text tail", []*av.Value{{Text: &av.ValueText{Content: strings.Repeat("🙂", 4096)}}},
			[]*av.Value{{Text: &av.ValueText{Content: strings.Repeat("🙂", 4096) + "\x00"}}}},
		{"fallback payload", []*av.Value{{Number: &av.ValueNumber{Content: 1}}},
			[]*av.Value{{Number: &av.ValueNumber{Content: 2}}}},
		{"multiple payloads", []*av.Value{{Text: &av.ValueText{Content: "plain"}, Number: &av.ValueNumber{Content: 1}}},
			[]*av.Value{{Text: &av.ValueText{Content: "changed"}, Number: &av.ValueNumber{Content: 1}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			first, err := orderValueFingerprint(test.first)
			if err != nil {
				t.Fatal(err)
			}
			other, err := orderValueFingerprint(test.other)
			if err != nil || first == other {
				t.Fatalf("different inputs share fingerprint: %v", err)
			}
			repeated, err := orderValueFingerprint(test.first)
			if err != nil || repeated != first {
				t.Fatalf("fingerprint is not deterministic: %v", err)
			}
		})
	}
	for _, field := range reflect.VisibleFields(reflect.TypeFor[av.ValueBlock]()) {
		t.Run("block/"+field.Name, func(t *testing.T) {
			value := &av.Value{Block: &av.ValueBlock{}}
			before, _ := orderValueFingerprint([]*av.Value{value})
			changed := reflect.ValueOf(value.Block).Elem().FieldByName(field.Name)
			if changed.Kind() == reflect.String {
				changed.SetString("changed")
			} else {
				changed.SetInt(math.MinInt64)
			}
			after, err := orderValueFingerprint([]*av.Value{value})
			if err != nil || before == after {
				t.Fatalf("block field did not invalidate fingerprint: %v", err)
			}
		})
	}
	values := make([]*av.Value, 257)
	values[128] = &av.Value{Template: &av.ValueTemplate{Content: "before"}}
	before, _ := orderValueFingerprint(values)
	values[128].Template.Content = "after"
	after, err := orderValueFingerprint(values)
	if err != nil || before == after {
		t.Fatalf("later chunk did not invalidate fingerprint: %v", err)
	}
	values[0] = &av.Value{Number: &av.ValueNumber{Content: math.NaN()}}
	if _, err = orderValueFingerprint(values); err == nil {
		t.Fatal("invalid JSON fallback admitted a fingerprint")
	}
}
