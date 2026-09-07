package model

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func TestBacklinkAttributeViewMatches(t *testing.T) {
	const first = "20260906150000-def0001"
	const second = "20260906150001-def0002"
	rich := func(row, id, content string) *av.Value {
		return &av.Value{ID: id, BlockID: row, Type: av.KeyTypeText, Text: &av.ValueText{Rich: &av.ValueTextRich{
			Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown, Content: content,
		}}}
	}
	reference := "((" + first + " \"Same title\"))"
	view := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "primary", Type: av.KeyTypeBlock}, Values: []*av.Value{
			{BlockID: "row1", Block: &av.ValueBlock{Content: "First row"}},
			{BlockID: "row2", Block: &av.ValueBlock{Content: "Second row"}},
		}},
		{Key: &av.Key{ID: "text1", Name: "First field", Type: av.KeyTypeText}, Values: []*av.Value{
			rich("row1", "value1", reference+" "+reference+" (("+second+" \"Child\"))"),
			rich("row2", "value2", reference),
			rich("removed", "orphan", reference),
			{BlockID: "row1", Text: &av.ValueText{Content: reference}},
			rich("row1", "same-anchor", "((20260906150002-other01 \"Same title\"))"),
		}},
		{Key: &av.Key{ID: "text2", Name: "Second field", Type: av.KeyTypeText}, Values: []*av.Value{rich("row1", "value3", reference)}},
		{Key: &av.Key{ID: "rollup", Type: av.KeyTypeRollup}, Values: []*av.Value{rich("row1", "derived", reference)}},
	}}
	want := []*BacklinkAttributeViewMatch{
		{ItemID: "row1", KeyID: "text1", ValueID: "value1", Title: "First row", KeyName: "First field", DefIDs: []string{first, second}},
		{ItemID: "row2", KeyID: "text1", ValueID: "value2", Title: "Second row", KeyName: "First field", DefIDs: []string{first}},
		{ItemID: "row1", KeyID: "text2", ValueID: "value3", Title: "First row", KeyName: "Second field", DefIDs: []string{first}},
	}
	if got := backlinkAttributeViewMatches(view, map[string]bool{first: true, second: true}); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected matches: %#v", got)
	}
	if got := backlinkAttributeViewMatches(view, map[string]bool{"missing": true}); len(got) != 0 {
		t.Fatalf("unrelated definition matched: %+v", got)
	}
}

func TestBacklinkAttributeViewTargetsRespectCarrier(t *testing.T) {
	const boxID = "20260906160000-box0001"
	const rootID = "20260906160001-root001"
	const avID = "20260906160002-av00001"
	const blockID = "20260906160003-db00001"
	const mirrorID = "20260906160004-db00002"
	const defID = "20260906160005-def0001"
	setupExportRelatedTest(t, boxID)
	setupAttributeViewRefI18n(t)
	view := av.NewAttributeView(avID)
	view.GetBlockKeyValues().Values = []*av.Value{{BlockID: "row", Block: &av.ValueBlock{Content: "Row"}}}
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: &av.Key{ID: "text", Type: av.KeyTypeText}, Values: []*av.Value{
		{ID: "cell", BlockID: "row", Text: &av.ValueText{Rich: &av.ValueTextRich{
			Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown, Content: "((" + defID + " \"Target\"))",
		}}},
	}})
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	tree := newAttributeViewRefCarrierTestTree(boxID, rootID, avID, blockID, mirrorID)
	ref := &sql.Ref{Type: sql.AttributeViewRefType, BlockID: blockID, DefBlockID: defID, RootID: rootID, Box: boxID, Path: tree.Path}
	got := backlinkAttributeViewTargets(tree, []*sql.Ref{ref})
	if len(got) != 1 || got[blockID] == nil || len(got[blockID].Matches) != 1 || got[mirrorID] != nil {
		t.Fatalf("unexpected carrier targets: %+v", got)
	}
	ref.Box = "other-box"
	if got = backlinkAttributeViewTargets(tree, []*sql.Ref{ref}); len(got) != 0 {
		t.Fatalf("cross-notebook reference matched: %+v", got)
	}
	const encryptedBoxID = "20260906160006-boxenc1"
	markRuntimeEncryptedBox(encryptedBoxID)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(encryptedBoxID) })
	tree.Box = encryptedBoxID
	ref.Box = encryptedBoxID
	if got = backlinkAttributeViewTargets(tree, []*sql.Ref{ref}); len(got) != 0 {
		t.Fatalf("encrypted carrier fell back to the global attribute view: %+v", got)
	}
}
