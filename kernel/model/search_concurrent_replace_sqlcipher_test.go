//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFindReplaceConcurrentEdits(t *testing.T) {
	const variable = "SIYUAN_TEST_FIND_REPLACE_CONCURRENT_MODE"
	mode := os.Getenv(variable)
	if mode == "" {
		for _, mode := range []string{"plain", "encrypted"} {
			t.Run(mode, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
				defer cancel()
				command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestFindReplaceConcurrentEdits$", "-test.v")
				command.Env = append(os.Environ(), variable+"="+mode)
				if output, err := command.CombinedOutput(); err != nil {
					t.Fatalf("concurrent replacement subprocess: %v\n%s", err, output)
				}
			})
		}
		return
	}
	prepareHPathRefreshTest(t)
	var boxID string
	var err error
	if mode == "encrypted" {
		const password = "replacement-regression-password"
		if err = EnableEncryptedNotebook(password); err != nil {
			t.Fatal(err)
		}
		boxID, err = CreateEncryptedBox("Replacement", password)
	} else {
		boxID, err = CreateBox("Replacement")
	}
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	tree := newHPathTestDoc(t, boxID, "/", "FOO", 2)
	tree.Root.SetIALAttr("tags", "FOO")
	first, second := tree.Root.FirstChild, tree.Root.LastChild
	for _, node := range []*ast.Node{first, second} {
		node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("FOO")})
	}
	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	filename := filepath.Join(util.DataDir, boxID, tree.Path)
	var edited []byte
	ids := []string{tree.ID, first.ID, second.ID}
	replaceTypes := map[string]bool{"docTitle": true, "text": true}
	err = findReplaceInBox("FOO", "BAR", replaceTypes, ids, nil, nil, nil, nil, 0, boxID, func() {
		dom := func(text string) string {
			return fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, first.ID, text)
		}
		tx := &Transaction{fromAPI: true,
			DoOperations:   []*Operation{{Action: "update", ID: first.ID, Data: dom("USER FOO")}},
			UndoOperations: []*Operation{{Action: "update", ID: first.ID, Data: dom("FOO")}}}
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		edited, err = os.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
	})
	if !errors.Is(err, util.ErrFileChanged) {
		t.Fatal("replacement did not reject the changed document", err)
	}
	current, _ := os.ReadFile(filename)
	if !bytes.Equal(current, edited) || util.IsCiphertext(current) != (mode == "encrypted") {
		t.Fatal("replacement overwrote the committed edit or changed its storage format")
	}
	if GlobalUndoLog.Peek(tree.ID) == nil {
		t.Fatal("rejected replacement cleared the new edit's undo record")
	}
	sql.FlushQueue()
	if block := sql.GetBlockInBox(first.ID, boxID); block == nil || !strings.Contains(block.Content, "USER FOO") {
		t.Fatal("rejected replacement indexed stale content", block)
	}
	if err = FindReplaceInBox("FOO", "BAR", replaceTypes, ids, nil, nil, nil, nil, 0, boxID); err != nil {
		t.Fatal("retry could not replace multiple blocks in one document", err)
	}
	stored, _, err := filesys.LoadTreeSnapshot(boxID, tree.Path, util.NewLute())
	if err != nil || stored.Root.IALAttr("title") != "BAR" || stored.Root.IALAttr("tags") != "BAR" {
		t.Fatal("retry did not commit title and tags together", err)
	}
	body := util.NewLute().Tree2BlockDOM(stored, util.NewLute().RenderOptions, util.NewLute().ParseOptions)
	if !strings.Contains(body, "USER BAR") || strings.Contains(body, "FOO") {
		t.Fatal("retry lost the user's text or skipped a matching block", body)
	}
	if GlobalUndoLog.Peek(tree.ID) != nil {
		t.Fatal("successful replacement retained stale undo history")
	}
}
