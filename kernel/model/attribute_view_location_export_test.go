package model

import (
	"archive/zip"
	"encoding/csv"
	"io"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewLocationCSVAndMarkdownExport(t *testing.T) {
	const boxID, avID, docID, blockID, rowID = "20261009010000-box0001", "20261009010001-av00001", "20261009010002-doc0001", "20261009010003-avnode1", "20261009010004-row0001"
	setupExportRelatedTest(t, boxID)
	Conf.Editor = conf.NewEditor()
	Conf.Search = conf.NewSearch()
	oldLang, oldLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "select": "Select", "table": "Table"}}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = oldLang, oldLangs })
	view := av.NewAttributeView(avID)
	view.Name = "Location export"
	primary := view.GetBlockKeyValues()
	primary.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: rowID, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Entry"}}}
	key := av.NewKey(ast.NewNodeID(), "Location", "", av.KeyTypeLocation)
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: key, Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: rowID, Type: av.KeyTypeLocation,
		Location: &av.ValueLocation{Name: "Home", Latitude: modelLocationCoordinate(0), Longitude: modelLocationCoordinate(0), CoordinateSystem: "wgs84", OriginalInput: "private provenance"}}}})
	view.Views[0].ItemIDs = []string{rowID}
	view.Views[0].Table.Columns = []*av.ViewTableColumn{{BaseField: &av.BaseField{ID: primary.Key.ID}}, {BaseField: &av.BaseField{ID: key.ID}}}
	for _, test := range []struct{ name, template, want string }{
		{"stored", "", "Home; 0, 0 [WGS84]"},
		{"display template", "Display override", "Display override"},
	} {
		t.Run(test.name, func(t *testing.T) {
			key.RenderTemplate = test.template
			if err := av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Export", "Export")
			database := &ast.Node{Type: ast.NodeAttributeView, ID: blockID, AttributeViewID: avID, AttributeViewType: string(av.LayoutTypeTable)}
			database.SetIALAttr("id", blockID)
			database.SetIALAttr(av.NodeAttrView, view.Views[0].ID)
			tree.Root.AppendChild(database)
			writeExportRelatedTestTree(t, tree)
			zipURL, err := ExportAv2CSV(avID, blockID)
			if err != nil {
				t.Fatal(err)
			}
			zipPath, err := url.PathUnescape(strings.TrimPrefix(zipURL, "/"))
			if err != nil {
				t.Fatal(err)
			}
			archive, err := zip.OpenReader(filepath.Join(util.TempDir, filepath.FromSlash(zipPath)))
			if err != nil {
				t.Fatal(err)
			}
			defer archive.Close()
			found := false
			for _, file := range archive.File {
				if !strings.HasSuffix(file.Name, ".csv") {
					continue
				}
				reader, err := file.Open()
				if err != nil {
					t.Fatal(err)
				}
				data, err := io.ReadAll(reader)
				reader.Close()
				if err != nil {
					t.Fatal(err)
				}
				rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(data), "\xef\xbb\xbf"))).ReadAll()
				if err != nil || len(rows) != 2 || len(rows[1]) != 2 || rows[1][1] != test.want || strings.Contains(string(data), "private provenance") {
					t.Fatalf("CSV export: %s, %v", data, err)
				}
				found = true
			}
			if !found {
				t.Fatal("CSV file missing from export")
			}
			exported, err := exportTree(tree, treeExportOptions{Config: *Conf.Export, WYSIWYG: false})
			if err != nil {
				t.Fatal(err)
			}
			engine := NewLute()
			content := string(render.NewFormatRenderer(exported, engine.RenderOptions, engine.ParseOptions).Render())
			if !strings.Contains(content, test.want) || strings.Contains(content, "private provenance") {
				t.Fatalf("Markdown export: %s", content)
			}
		})
	}
}
