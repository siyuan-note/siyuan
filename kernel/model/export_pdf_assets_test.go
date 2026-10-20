package model

import (
	"bytes"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	pdfapi "github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	pdfmodel "github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func pdfAssetTestContext(t *testing.T, uris ...string) *pdfmodel.Context {
	t.Helper()
	ctx, err := pdfapi.ReadContextFile("../testdata/parsertest.pdf")
	if err != nil {
		t.Fatal(err)
	}
	annotations := []pdfmodel.AnnotationRenderer{}
	for i, uri := range uris {
		annotations = append(annotations, pdfmodel.NewLinkAnnotation(*types.NewRectangle(20, 20, 100, 40),
			"", fmt.Sprintf("pdf-asset-%d", i), "", 0, nil, nil, uri, nil, false, 0, pdfmodel.BSSolid))
	}
	if len(annotations) > 0 {
		if _, err = pdfcpu.AddAnnotationsMap(ctx, map[int][]pdfmodel.AnnotationRenderer{1: annotations}, false); err != nil {
			t.Fatal(err)
		}
	}
	return roundTripPDFAssetContext(t, ctx)
}

func roundTripPDFAssetContext(t *testing.T, ctx *pdfmodel.Context) *pdfmodel.Context {
	t.Helper()
	p := filepath.Join(t.TempDir(), "test.pdf")
	if err := pdfapi.WriteContextFile(ctx, p); err != nil {
		t.Fatal(err)
	}
	ret, err := pdfapi.ReadContextFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return ret
}

func pdfAssetAttachmentContents(t *testing.T, ctx *pdfmodel.Context) (ret [][]byte) {
	t.Helper()
	for page := 1; page <= ctx.PageCount; page++ {
		pageRef, err := ctx.PageDictIndRef(page)
		if err != nil {
			t.Fatal(err)
		}
		pageDict, err := ctx.DereferenceDict(*pageRef)
		if err != nil {
			t.Fatal(err)
		}
		annotations, err := ctx.DereferenceArray(pageDict["Annots"])
		if err != nil {
			t.Fatal(err)
		}
		for _, ref := range annotations {
			annotation, err := ctx.DereferenceDict(ref)
			if err != nil {
				t.Fatal(err)
			}
			if subtype := annotation.NameEntry("Subtype"); subtype == nil || *subtype != "FileAttachment" {
				continue
			}
			spec, err := ctx.DereferenceDict(annotation["FS"])
			if err != nil {
				t.Fatal(err)
			}
			files, err := ctx.DereferenceDict(spec["EF"])
			if err != nil {
				t.Fatal(err)
			}
			stream, _, err := ctx.DereferenceStreamDict(files["F"])
			if err != nil {
				t.Fatal(err)
			}
			if err = stream.Decode(); err != nil {
				t.Fatal(err)
			}
			ret = append(ret, bytes.Clone(stream.Content))
		}
	}
	return
}

func TestPDFExportAssets(t *testing.T) {
	const boxID = "20261017100000-pdf0001"
	setupExportRelatedTest(t, boxID)
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	assetDir := filepath.Join(util.DataDir, boxID, "assets")
	if err := os.MkdirAll(assetDir, 0755); err != nil {
		t.Fatal(err)
	}
	const name = "linked image.png"
	for _, file := range []string{name, "cover.png", "body.png"} {
		if err := os.WriteFile(filepath.Join(assetDir, file), []byte("asset-"+file), 0644); err != nil {
			t.Fatal(err)
		}
	}
	uri := "http://127.0.0.1:6806/assets/" + url.PathEscape(name)
	for _, embed := range []bool{false, true} {
		t.Run(fmt.Sprint("embed=", embed), func(t *testing.T) {
			output := filepath.Join(t.TempDir(), "assets")
			if err := os.Mkdir(output, 0755); err != nil {
				t.Fatal(err)
			}
			prior := filepath.Join(output, name)
			if err := os.WriteFile(prior, []byte("existing"), 0644); err != nil {
				t.Fatal(err)
			}
			ctx := pdfAssetTestContext(t, uri, uri, "https://example.com/keep")
			exported := &pdfExportAssets{directory: output, boxID: boxID}
			if err := processPDFLinkEmbedAssets(ctx, []string{"assets/cover.png", "assets/body.png"}, boxID, embed, exported); err != nil {
				t.Fatal(err)
			}
			ctx = roundTripPDFAssetContext(t, ctx)
			links := []string{}
			attachmentCount := 0
			for _, annotations := range ctx.PageAnnots {
				for kind, group := range annotations {
					if kind == pdfmodel.AnnFileAttachment {
						attachmentCount += len(group.Map)
					}
					if kind == pdfmodel.AnnLink {
						for _, annotation := range group.Map {
							links = append(links, annotation.ContentString())
						}
					}
				}
			}
			if !strings.Contains(strings.Join(links, "\n"), "https://example.com/keep") {
				t.Fatal("unrelated link was removed")
			}
			files, err := os.ReadDir(output)
			if err != nil {
				t.Fatal(err)
			}
			if embed {
				if len(files) != 1 || attachmentCount != 2 {
					t.Fatalf("embedded assets created sidecars or lost attachments: %v, %d", files, attachmentCount)
				}
				for _, content := range pdfAssetAttachmentContents(t, ctx) {
					if string(content) != "asset-"+name {
						t.Fatalf("attachment contents changed: %q", content)
					}
				}
			} else {
				expected := "assets/linked%20image-1.png"
				if len(files) != 2 || strings.Count(strings.Join(links, "\n"), expected) != 2 {
					t.Fatalf("copied assets or rewritten links differ: %v %v", files, links)
				}
				copied, err := os.ReadFile(filepath.Join(output, "linked image-1.png"))
				if err != nil || string(copied) != "asset-"+name {
					t.Fatalf("linked image content changed: %q %v", copied, err)
				}
			}
			priorData, err := os.ReadFile(prior)
			if err != nil || string(priorData) != "existing" {
				t.Fatalf("existing asset overwritten: %q %v", priorData, err)
			}
		})
	}
	for _, embed := range []bool{false, true} {
		ctx := pdfAssetTestContext(t)
		output := filepath.Join(t.TempDir(), "assets")
		exported := &pdfExportAssets{directory: output, boxID: boxID}
		if err := processPDFLinkEmbedAssets(ctx, []string{"assets/cover.png", "assets/body.png"}, boxID, embed, exported); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(output); !os.IsNotExist(err) {
			t.Fatalf("unlinked page images created assets directory: %v", err)
		}
	}
	output := filepath.Join(t.TempDir(), "assets")
	exported := &pdfExportAssets{directory: output, boxID: boxID}
	if _, err := exported.copy("assets/" + name); err != nil {
		t.Fatal(err)
	}
	if _, err := exported.copy("assets/missing.bin"); err == nil {
		t.Fatal("missing linked file accepted")
	}
	exported.rollback()
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("rollback left new output: %v", err)
	}
	t.Run("directory and rollback preserve unrelated files", func(t *testing.T) {
		bundle := filepath.Join(assetDir, "bundle.rtfd")
		if err := os.MkdirAll(filepath.Join(bundle, "sub"), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(bundle, "sub", "body.txt"), []byte("bundle"), 0644); err != nil {
			t.Fatal(err)
		}
		output := filepath.Join(t.TempDir(), "assets")
		if err := os.MkdirAll(filepath.Join(output, "bundle.rtfd"), 0755); err != nil {
			t.Fatal(err)
		}
		exported := &pdfExportAssets{directory: output, boxID: boxID}
		link, err := exported.copy("assets/bundle.rtfd")
		if err != nil || link != "assets/bundle-1.rtfd" {
			t.Fatalf("directory collision: %s %v", link, err)
		}
		data, err := os.ReadFile(filepath.Join(output, "bundle-1.rtfd", "sub", "body.txt"))
		if err != nil || string(data) != "bundle" {
			t.Fatalf("directory asset contents: %q %v", data, err)
		}
		other := filepath.Join(output, "unrelated.txt")
		if err := os.WriteFile(other, []byte("keep"), 0644); err != nil {
			t.Fatal(err)
		}
		exported.rollback()
		if _, err := os.Stat(filepath.Join(output, "bundle-1.rtfd")); !os.IsNotExist(err) {
			t.Fatalf("rollback left new bundle: %v", err)
		}
		if _, err := os.Stat(filepath.Join(output, "bundle.rtfd")); err != nil {
			t.Fatalf("existing directory lost: %v", err)
		}
		data, err = os.ReadFile(other)
		if err != nil || string(data) != "keep" {
			t.Fatalf("unrelated file lost: %q %v", data, err)
		}
	})
}

func TestPDFExportEncryptedAssets(t *testing.T) {
	const boxID = "20261017100000-pdf0002"
	setupExportRelatedTest(t, boxID)
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.DataDir)
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	forgetRuntimeNormalBox(boxID)
	markRuntimeEncryptedBox(boxID)
	dek := bytes.Repeat([]byte{45}, 32)
	setDEKForTest(boxID, dek)
	t.Cleanup(func() {
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
		clear(dek)
	})
	plain := []byte("authenticated legacy attachment")
	ciphertext := legacyEncryptedAssetFixture(t, boxID, "secret.bin", "secret.bin", dek, plain)
	source := filepath.Join(util.DataDir, boxID, "assets", "secret.bin")
	if err := os.MkdirAll(filepath.Dir(source), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	uri := "http://127.0.0.1:6806/assets/secret.bin?box=" + boxID
	for _, embed := range []bool{false, true} {
		ctx := pdfAssetTestContext(t, uri)
		output := filepath.Join(t.TempDir(), "assets")
		exported := &pdfExportAssets{directory: output, boxID: boxID}
		if err := processPDFLinkEmbedAssets(ctx, nil, boxID, embed, exported); err != nil {
			t.Fatal(err)
		}
		ctx = roundTripPDFAssetContext(t, ctx)
		if !embed {
			data, err := os.ReadFile(filepath.Join(output, "secret.bin"))
			if err != nil || !bytes.Equal(data, plain) {
				t.Fatalf("encrypted export did not authenticate: %q %v", data, err)
			}
		} else {
			attachments := pdfAssetAttachmentContents(t, ctx)
			if len(attachments) != 1 || !bytes.Equal(attachments[0], plain) {
				t.Fatalf("encrypted attachment payload changed: %q", attachments)
			}
			if _, err := os.Stat(output); !os.IsNotExist(err) {
				t.Fatalf("embedded encrypted attachment left sidecar: %v", err)
			}
		}
	}
	after, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(after, ciphertext) {
		t.Fatalf("export changed ciphertext: %v", err)
	}
	corrupt := append([]byte{}, ciphertext...)
	corrupt[len(corrupt)-8] ^= 1
	if err := os.WriteFile(source, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	exported := &pdfExportAssets{directory: filepath.Join(t.TempDir(), "assets"), boxID: boxID}
	if _, err := exported.copy("assets/secret.bin?box=" + boxID); err == nil {
		t.Fatal("corrupt encrypted asset accepted")
	}
	exported.rollback()
	after, err = os.ReadFile(source)
	if err != nil || !bytes.Equal(after, corrupt) {
		t.Fatalf("failed export changed source: %v", err)
	}
	if err := os.WriteFile(source, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	cachedDEKsLock.Lock()
	delete(cachedDEKs, boxID)
	cachedDEKsLock.Unlock()
	exported = &pdfExportAssets{directory: filepath.Join(t.TempDir(), "assets"), boxID: boxID}
	if _, err := exported.copy("assets/secret.bin?box=" + boxID); err == nil {
		t.Fatal("locked encrypted asset accepted")
	}
	exported.rollback()
}
