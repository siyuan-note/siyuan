// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	pdfmodel "github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func pdfImagesSubprocess(t *testing.T) bool {
	t.Helper()
	const env = "SIYUAN_TEST_PDF_IMAGES"
	if os.Getenv(env) == t.Name() {
		return false
	}
	cmd := exec.Command(os.Args[0], "-test.run=^"+t.Name()+"$", "-test.timeout=60s")
	cmd.Env = append(os.Environ(), env+"="+t.Name())
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("PDF test subprocess: %v\n%s", err, output)
	}
	return true
}

func pdfImagesFixture(t *testing.T, filter string) (PDFImageSource, string) {
	t.Helper()
	fixture := setupFileOperationTest(t)
	Conf.Editor.Store(conf.NewEditor())
	Conf.Search.Store(conf.NewSearch())
	Conf.System.Store(conf.NewSystem())
	originalWorkspaceDir := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspaceDir })
	util.DBPath = filepath.Join(util.WorkspaceDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(util.WorkspaceDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.WorkspaceDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	for _, docPath := range []string{fixture.sourcePath, fixture.targetPath} {
		tree, err := filesys.LoadTree(fixture.box.ID, docPath, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	data := testutil.PDFImageFixture(filter)
	assets := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assets, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "figures.pdf"), data, 0644); err != nil {
		t.Fatal(err)
	}
	tree, err := filesys.LoadTree(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "assets/figures.pdf", TextMarkTextContent: "Figures"})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	return PDFImageSource{DocumentID: tree.ID, Path: "assets/figures.pdf"}, fixture.targetID
}

func TestPDFImagesListPreviewExtract(t *testing.T) {
	if pdfImagesSubprocess(t) {
		return
	}
	source, target := pdfImagesFixture(t, "")
	ctx := context.Background()
	list, err := ListPDFImages(ctx, source, nil, 0, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if list.PageCount != 3 || list.Total != 3 || len(list.Images) != 1 || !list.HasMore || len(list.Revision) != 64 {
		t.Fatalf("list: %+v", list)
	}
	next, err := ListPDFImages(ctx, source, nil, 1, 20, list.Revision)
	if err != nil || len(next.Images) != 2 || next.HasMore {
		t.Fatalf("continuation: %+v %v", next, err)
	}
	first := list.Images[0]
	selection := PDFImageSelection{Revision: list.Revision, Page: first.Page, Object: first.Object}
	prepared, err := PreparePDFImage(ctx, source, selection)
	if err != nil {
		t.Fatal(err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(prepared.Data))
	if err != nil || prepared.Width != 3 || prepared.Height != 2 {
		t.Fatalf("preview: %+v %v", prepared, err)
	}
	if pixel := color.NRGBAModel.Convert(decoded.At(0, 0)).(color.NRGBA); pixel.R != 255 || pixel.A != 255 {
		t.Fatalf("preview bytes changed: %v", pixel)
	}
	transparent := next.Images[0]
	alpha, err := PreparePDFImage(ctx, source, PDFImageSelection{Revision: list.Revision, Page: transparent.Page, Object: transparent.Object})
	if err != nil {
		t.Fatal(err)
	}
	alphaImage, _, err := image.Decode(bytes.NewReader(alpha.Data))
	if err != nil {
		t.Fatal(err)
	}
	if pixel := color.NRGBAModel.Convert(alphaImage.At(0, 0)).(color.NRGBA); pixel.A != 0 {
		t.Fatalf("transparency lost: %v", pixel)
	}
	results, err := ExtractPDFImages(ctx, source, list.Revision, target, []PDFImageSelection{
		selection, {Page: 2, Object: first.Object}, {Page: 3, Object: first.Object},
	})
	if err != nil || len(results) != 3 {
		t.Fatalf("extract: %+v %v", results, err)
	}
	if results[0].Artifact == nil || results[1].Artifact == nil || results[0].Artifact.Path != results[1].Artifact.Path || results[2].Error == "" {
		t.Fatalf("dedup/partial result: %+v", results)
	}
	if results[0].SourceURL != "assets/figures.pdf?page=1" {
		t.Fatalf("source: %s", results[0].SourceURL)
	}
	saved, err := ReadAssetBytesInBox(treenode.GetBlockTree(target).BoxID, results[0].Artifact.Path)
	if err != nil || !bytes.Equal(saved, prepared.Data) {
		t.Fatalf("saved pixels changed: %v", err)
	}
	again, err := ExtractPDFImages(ctx, source, list.Revision, target, []PDFImageSelection{selection})
	if err != nil || again[0].Artifact.Path != results[0].Artifact.Path {
		t.Fatalf("retry duplicated asset: %+v %v", again, err)
	}
	vector, err := ListPDFImages(ctx, source, []int{3}, 0, 20, "")
	if err != nil || vector.Total != 0 || vector.Images == nil {
		t.Fatalf("vector page: %+v %v", vector, err)
	}
	if tree, err := filesys.LoadTree(treenode.GetBlockTree(target).BoxID, treenode.GetBlockTree(target).Path, util.NewLute()); err != nil || tree.Root.FirstChild.Next != nil {
		t.Fatalf("extraction unexpectedly inserted document blocks: %v", err)
	}
}

func TestPDFImagesRejectStaleAndInvalidSelections(t *testing.T) {
	if pdfImagesSubprocess(t) {
		return
	}
	source, target := pdfImagesFixture(t, "")
	ctx := context.Background()
	list, err := ListPDFImages(ctx, source, nil, 0, 20, "")
	if err != nil {
		t.Fatal(err)
	}
	selection := PDFImageSelection{Revision: list.Revision, Page: 1, Object: list.Images[0].Object}
	for _, tc := range []struct {
		name   string
		change func(*PDFImageSource, *PDFImageSelection)
	}{
		{"unreferenced", func(s *PDFImageSource, _ *PDFImageSelection) { s.Path = "assets/other.pdf" }},
		{"network", func(s *PDFImageSource, _ *PDFImageSelection) { s.Path = "https://example.com/a.pdf" }},
		{"traversal", func(s *PDFImageSource, _ *PDFImageSelection) { s.Path = "assets/../figures.pdf" }},
		{"wrong notebook", func(s *PDFImageSource, _ *PDFImageSelection) { s.Path += "?box=another" }},
		{"missing revision", func(_ *PDFImageSource, v *PDFImageSelection) { v.Revision = "" }},
		{"stale revision", func(_ *PDFImageSource, v *PDFImageSelection) { v.Revision = "outdated" }},
		{"wrong page", func(_ *PDFImageSource, v *PDFImageSelection) { v.Page = 3 }},
		{"wrong object", func(_ *PDFImageSource, v *PDFImageSelection) { v.Object = 9999 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, v := source, selection
			tc.change(&s, &v)
			if _, err := PreparePDFImage(ctx, s, v); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
	if _, err = ListPDFImages(ctx, source, nil, 1, 20, ""); err == nil {
		t.Fatal("pagination without revision accepted")
	}
	if _, err = ListPDFImages(ctx, source, []int{4}, 0, 20, ""); err == nil {
		t.Fatal("invalid page accepted")
	}
	if _, err = ListPDFImages(ctx, source, nil, 0, 101, ""); err == nil {
		t.Fatal("invalid limit accepted")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = ExtractPDFImages(cancelled, source, list.Revision, target, []PDFImageSelection{selection}); err == nil {
		t.Fatal("cancelled extraction succeeded")
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, "assets", "figures.pdf"), append(testutil.PDFImageFixture(""), '\n'), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = PreparePDFImage(ctx, source, selection); err == nil || !strings.Contains(err.Error(), "PDF changed") {
		t.Fatalf("changed PDF reused: %v", err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, "assets", "figures.pdf"), []byte("damaged PDF"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = ListPDFImages(ctx, source, nil, 0, 20, ""); err == nil {
		t.Fatal("damaged PDF accepted")
	}
}

func TestPDFImagesUnsupportedEncoding(t *testing.T) {
	if pdfImagesSubprocess(t) {
		return
	}
	source, target := pdfImagesFixture(t, "JPXDecode")
	list, err := ListPDFImages(context.Background(), source, []int{1}, 0, 20, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Images) != 2 {
		t.Fatalf("unsupported image missing from inventory: %+v", list)
	}
	results, err := ExtractPDFImages(context.Background(), source, list.Revision, target, []PDFImageSelection{
		{Page: 1, Object: list.Images[0].Object}, {Page: 1, Object: list.Images[1].Object},
	})
	if err != nil || len(results) != 2 || results[0].Artifact == nil || results[1].Error == "" {
		t.Fatalf("unsupported encoding: %+v %v", results, err)
	}
}

func TestPDFImagesPasswordAndSizeLimits(t *testing.T) {
	if pdfImagesSubprocess(t) {
		return
	}
	source, _ := pdfImagesFixture(t, "")
	config := pdfmodel.NewDefaultConfiguration()
	config.UserPW, config.OwnerPW = "pdf-user-password", "pdf-owner-password"
	var encrypted bytes.Buffer
	if err := api.Encrypt(bytes.NewReader(testutil.PDFImageFixture("")), &encrypted, config); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.DataDir, "assets", "figures.pdf")
	if err := os.WriteFile(file, encrypted.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ListPDFImages(context.Background(), source, nil, 0, 20, ""); err == nil {
		t.Fatal("password-protected PDF was accepted without password")
	}
	if after, err := os.ReadFile(file); err != nil || !bytes.Equal(after, encrypted.Bytes()) {
		t.Fatalf("password-protected source changed: %v", err)
	}
	f, err := os.OpenFile(file, os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Truncate(pdfImageMaxPDFBytes + 2*1024*1024 + 1); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	_ = f.Close()
	if _, err = ListPDFImages(context.Background(), source, nil, 0, 20, ""); err == nil || !strings.Contains(err.Error(), "64 MiB") {
		t.Fatalf("oversized PDF was parsed: %v", err)
	}
}

func TestPDFImagesEncryptedAssets(t *testing.T) {
	if pdfImagesSubprocess(t) {
		return
	}
	_, ordinaryTarget := pdfImagesFixture(t, "")
	const boxID = "20261028000000-pdfenc1"
	t.Cleanup(prepareEncryptedBoxLifecycleTest(t, boxID))
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
	dek, err := GetDEKIfUnlocked(boxID)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(dek)
	mountedEncryptedBoxes.Store(boxID, true)
	util.TempDir = t.TempDir()
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
		t.Fatal(err)
	}
	if err = sql.OpenEncryptedDB(boxID, dek); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sql.CloseEncryptedDB(boxID); treenode.CloseEncryptedBlockTreeDB(boxID) })
	const name = "source.pdf"
	plain := testutil.PDFImageFixture("")
	ciphertext := legacyEncryptedAssetFixture(t, boxID, name, "source.pdf", dek, plain)
	file := filepath.Join(util.DataDir, boxID, "assets", name)
	if err = os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(boxID, "/20261028000001-pdfenc2.sy", "/PDF", "PDF")
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "assets/" + name + "?box=" + boxID, TextMarkTextContent: "PDF"})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	source := PDFImageSource{DocumentID: tree.ID, Path: "assets/" + name + "?box=" + boxID}
	ctx := context.Background()
	list, err := ListPDFImages(ctx, source, nil, 0, 20, "")
	if err != nil || list.Total != 3 {
		t.Fatalf("legacy encrypted PDF: %+v %v", list, err)
	}
	selection := PDFImageSelection{Revision: list.Revision, Page: 1, Object: list.Images[0].Object}
	preview, err := PreparePDFImage(ctx, source, selection)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ExtractPDFImages(ctx, source, list.Revision, ordinaryTarget, []PDFImageSelection{selection}); err == nil {
		t.Fatal("extracted ciphertext source into ordinary notebook")
	}
	result, err := ExtractPDFImages(ctx, source, list.Revision, tree.ID, []PDFImageSelection{selection, selection})
	if err != nil || len(result) != 2 || result[0].Artifact == nil || result[1].Artifact == nil {
		t.Fatalf("encrypted extraction: %+v %v", result, err)
	}
	if result[0].Artifact.Path != result[1].Artifact.Path || !strings.Contains(result[0].Artifact.Path, "?box="+boxID) {
		t.Fatalf("encrypted batch dedup/scope: %+v", result)
	}
	saved, err := ReadAssetBytesInBox(boxID, result[0].Artifact.Path)
	if err != nil || !bytes.Equal(saved, preview.Data) {
		t.Fatalf("encrypted extracted image changed: %v", err)
	}
	abs, err := GetAssetAbsPathInBox(result[0].Artifact.Path, boxID)
	if err != nil {
		t.Fatal(err)
	}
	onDisk, err := os.ReadFile(abs)
	if err != nil || bytes.Equal(saved, onDisk) || !bytes.HasPrefix(onDisk, []byte("SYAE")) {
		t.Fatalf("extracted image was saved as plaintext: %v", err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "assets")); !os.IsNotExist(err) {
		t.Fatalf("encrypted extraction created global assets: %v", err)
	}
	corrupt := bytes.Clone(ciphertext)
	corrupt[len(corrupt)-8] ^= 1
	if err = os.WriteFile(file, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = PreparePDFImage(ctx, source, selection); err == nil {
		t.Fatal("corrupt encrypted PDF accepted")
	}
	if after, err := os.ReadFile(file); err != nil || !bytes.Equal(after, corrupt) {
		t.Fatalf("corrupt PDF was overwritten: %v", err)
	}
	if err = os.WriteFile(file, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	LockBox(boxID)
	if _, err = ListPDFImages(ctx, source, nil, 0, 20, ""); err == nil {
		t.Fatal("locked PDF was readable")
	}
}
