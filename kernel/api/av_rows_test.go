package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAttributeViewRowTitleSearch(t *testing.T) {
	row := &av.TableRow{Cells: []*av.TableCell{
		nil, {BaseValue: &av.BaseValue{}},
		{BaseValue: &av.BaseValue{Value: &av.Value{Type: av.KeyTypeBlock}}},
		{BaseValue: &av.BaseValue{Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Other field"}}}},
		{BaseValue: &av.BaseValue{Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "PLAN Alpha"}}}},
		{BaseValue: &av.BaseValue{Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Other block"}}}},
	}}
	for _, test := range []struct {
		search string
		want   bool
	}{{"", true}, {"plan alpha", true}, {"alpha", true}, {"other", false}, {"missing", false}} {
		if got := attributeViewRowMatchesTitle(row, test.search); got != test.want {
			t.Fatalf("title search %q: got %t, want %t", test.search, got, test.want)
		}
	}
	if attributeViewRowMatchesTitle(&av.TableRow{}, "plan") {
		t.Fatal("row without a primary cell matched a title search")
	}
}
