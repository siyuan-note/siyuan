// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPDFAttachmentRecovery(t *testing.T) {
	const env = "SIYUAN_TEST_PDF_ATTACHMENT"
	if os.Getenv(env) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestPDFAttachmentRecovery$", "-test.timeout=60s")
		cmd.Env = append(os.Environ(), env+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("PDF attachment subprocess: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir = filepath.Join(root, "data")
	util.BlockTreeDBPath = filepath.Join(root, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	box := &model.Box{ID: ast.NewNodeID()}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	treenode.InitBlockTree(true)
	defer treenode.CloseDatabase()
	tree := treenode.NewTree(box.ID, "/"+ast.NewNodeID()+".sy", "/PDF", "PDF")
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "assets/source.pdf", TextMarkTextContent: "PDF"})
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	file := filepath.Join(util.DataDir, "assets", "source.pdf")
	if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, testutil.PDFImageFixture(""), 0644); err != nil {
		t.Fatal(err)
	}
	source := model.PDFImageSource{DocumentID: tree.ID, Path: "assets/source.pdf"}
	list, err := model.ListPDFImages(context.Background(), source, nil, 0, 20, "")
	if err != nil {
		t.Fatal(err)
	}
	selection := &model.PDFImageSelection{Revision: list.Revision, Page: 1, Object: list.Images[0].Object}
	prepared, err := model.PreparePDFImage(context.Background(), source, *selection)
	if err != nil {
		t.Fatal(err)
	}
	_, added, err := mergeAgentAttachments(nil, []tools.ModelAttachment{{Type: "image", Path: source.Path, DocumentID: tree.ID, PDFImage: selection, Data: prepared.Data, MIMEType: prepared.MIMEType}})
	if err != nil || len(added) != 1 {
		t.Fatal(added, err)
	}
	encoded, err := json.Marshal(added)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte("Data")) || !bytes.Contains(encoded, []byte(`"pdfImage"`)) {
		t.Fatalf("invalid persisted attachment: %s", encoded)
	}
	var restored []AgentAttachment
	if err = json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	data, mime, _, _, err := resolveAgentAttachment(restored[0])
	if err != nil || mime != "image/png" || !bytes.Equal(data, prepared.Data) {
		t.Fatalf("preview recovery changed: %v %s", err, mime)
	}
	if err = os.WriteFile(file, append(testutil.PDFImageFixture(""), '\n'), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, _, _, err = resolveAgentAttachment(restored[0]); err == nil {
		t.Fatal("recovered stale preview")
	}
	message, ok := buildAttachmentMessage(restored)
	if !ok || !strings.Contains(message.Content, "unavailable") || !strings.Contains(message.Content, "Do not claim") {
		t.Fatalf("missing stale-preview notice: %+v", message)
	}
}
