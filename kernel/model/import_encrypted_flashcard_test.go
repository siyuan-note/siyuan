// SiYuan - From thought to insight, with agents
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
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/riff"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// newImportFlashcardTestTree 构造一棵含段落的文档树，rootTitle 写入文档标题，带闪卡属性的块 ID 由 flashcardBlockID 指定。
func newImportFlashcardTestTree(rootID, path, rootTitle, flashcardBlockID string) *parse.Tree {
	root := &ast.Node{Type: ast.NodeDocument, ID: rootID}
	if "" != rootTitle {
		root.SetIALAttr("title", rootTitle)
	}

	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: ast.NewNodeID()}
	if "" != flashcardBlockID {
		paragraph.ID = flashcardBlockID
		paragraph.SetIALAttr(NodeAttrRiffDecks, "20230218211946-2kw8jgx")
	}
	root.AppendChild(paragraph)
	return &parse.Tree{ID: rootID, Root: root, Path: path}
}

func TestCheckEncryptedImportFlashcards(t *testing.T) {
	oldConf, oldLangs := Conf, util.Langs
	Conf = &AppConf{Lang: "en"}
	util.Langs = map[string]map[int]string{
		"en": {
			386: "Document [%s] contains flashcard content, which encrypted notebooks do not support, so it cannot be imported",
		},
	}
	t.Cleanup(func() {
		Conf, util.Langs = oldConf, oldLangs
	})

	flashcardID := "20260901000000-card001"
	withCards := newImportFlashcardTestTree("20260901000001-doc0001", "/20260901000001-doc0001.sy", "Working notes", flashcardID)
	withoutCards := newImportFlashcardTestTree("20260901000002-doc0002", "/20260901000002-doc0002.sy", "Plain notes", "")

	if err := checkEncryptedImportFlashcards(withCards, withCards.Path, false); nil != err {
		t.Fatalf("ordinary notebooks may import flashcard documents: %s", err)
	}
	if err := checkEncryptedImportFlashcards(withoutCards, withoutCards.Path, true); nil != err {
		t.Fatalf("documents without flashcard attrs may be imported: %s", err)
	}

	err := checkEncryptedImportFlashcards(withCards, withCards.Path, true)
	if nil == err {
		t.Fatal("flashcard document should be rejected for an encrypted notebook")
	}
	if !strings.Contains(err.Error(), "Working notes") {
		t.Fatalf("rejection should name the document, got %q", err.Error())
	}

	// 文档标题缺失时回退到文件名，保证用户仍能定位
	untitled := newImportFlashcardTestTree("20260901000003-doc0003", "", "", flashcardID)
	err = checkEncryptedImportFlashcards(untitled, filepath.Join(t.TempDir(), "20260901000003-doc0003.sy"), true)
	if nil == err || !strings.Contains(err.Error(), "20260901000003-doc0003.sy") {
		t.Fatalf("rejection should fall back to the file name, got %v", err)
	}

	withCards.Root.SetIALAttr("title", `<img src=x onerror="alert(1)"> & notes`)
	err = checkEncryptedImportFlashcards(withCards, withCards.Path, true)
	if nil == err || !strings.Contains(err.Error(), "&lt;img src=x onerror=&#34;alert(1)&#34;&gt; &amp; notes") || strings.Contains(err.Error(), "<img") {
		t.Fatalf("rejection should HTML-escape the document title, got %v", err)
	}
	err = checkEncryptedImportFlashcards(untitled, filepath.Join(t.TempDir(), "notes&draft.sy"), true)
	if nil == err || !strings.Contains(err.Error(), "notes&amp;draft.sy") {
		t.Fatalf("rejection should HTML-escape the source file name, got %v", err)
	}
}

func TestImportedBlockDocTitles(t *testing.T) {
	first := newImportFlashcardTestTree("20260901000001-doc0001", "/20260901000001-doc0001.sy", "First", "")
	second := newImportFlashcardTestTree("20260901000002-doc0002", "/20260901000002-doc0002.sy", "Second", "")

	titles := importedBlockDocTitles(map[string]*parse.Tree{first.ID: first, second.ID: second})
	if titles[first.ID] != "First" || titles[first.Root.FirstChild.ID] != "First" {
		t.Fatalf("root and child blocks should resolve to the document title, got %v", titles)
	}
	if titles[second.ID] != "Second" {
		t.Fatalf("second document title is missing, got %v", titles)
	}
	if title, ok := titles["20260901000009-missing"]; ok {
		t.Fatalf("unknown block should not resolve, got %q", title)
	}
}

// newImportDeckFixture 在临时目录下构造 storage/riff 牌组，卡片指向 cards 中的块 ID。
func newImportDeckFixture(t *testing.T, cards map[string]string) (root string) {
	t.Helper()

	root = t.TempDir()
	riffDir := filepath.Join(root, "storage", "riff")
	if err := os.MkdirAll(riffDir, 0755); err != nil {
		t.Fatal(err)
	}

	flashcardConf := conf.NewFlashcard()
	deck, err := riff.LoadDeck(riffDir, builtinDeckID, flashcardConf.RequestRetention, flashcardConf.MaximumInterval, flashcardConf.Weights)
	if err != nil {
		t.Fatal(err)
	}
	for cardID, blockID := range cards {
		deck.AddCard(cardID, blockID)
	}
	if err = deck.Save(); err != nil {
		t.Fatal(err)
	}
	return
}

func TestCheckEncryptedImportDeckReportsAffectedDocuments(t *testing.T) {
	oldConf, oldLangs := Conf, util.Langs
	Conf = &AppConf{Lang: "en"}
	Conf.Flashcard = conf.NewFlashcard()
	util.Langs = map[string]map[int]string{
		"en": {
			385: "Encrypted notebooks do not support flashcards, so a .sy.zip containing flashcard deck data cannot be imported (documents: %s)",
		},
	}
	t.Cleanup(func() {
		Conf, util.Langs = oldConf, oldLangs
	})

	// 导入时的块 ID 会被重建：牌组记录旧 ID，导入后需按映射换算回文档
	oldBlockID := "20260901000000-card001"
	newBlockID := "20260902000000-card002"
	docID := "20260902000001-doc0001"
	tree := newImportFlashcardTestTree(docID, "/"+docID+".sy", "Working notes", "")
	tree.Root.FirstChild.ID = newBlockID

	root := newImportDeckFixture(t, map[string]string{"20260901000001-card01": oldBlockID})
	err := checkEncryptedImportDeck(root, map[string]*parse.Tree{docID: tree}, map[string]string{oldBlockID: newBlockID})
	if nil == err {
		t.Fatal("deck data should be rejected for an encrypted notebook")
	}
	if !strings.Contains(err.Error(), "Working notes") {
		t.Fatalf("rejection should name the document holding the card, got %q", err.Error())
	}
	if strings.Contains(err.Error(), oldBlockID) {
		t.Fatalf("a card whose block is part of this import should be reported by its document, not by the old block ID, got %q", err.Error())
	}

	tree.Root.SetIALAttr("title", "<img src=x onerror=alert(1)> & notes")
	err = checkEncryptedImportDeck(root, map[string]*parse.Tree{docID: tree}, map[string]string{oldBlockID: newBlockID})
	if nil == err || !strings.Contains(err.Error(), "&lt;img src=x onerror=alert(1)&gt; &amp; notes") || strings.Contains(err.Error(), "<img") {
		t.Fatalf("deck rejection should HTML-escape document titles, got %v", err)
	}

	maliciousBlockID := "<img src=x onerror=alert(1)>"
	maliciousRoot := newImportDeckFixture(t, map[string]string{"20260901000002-card002": maliciousBlockID})
	err = checkEncryptedImportDeck(maliciousRoot, nil, nil)
	if nil == err || !strings.Contains(err.Error(), "&lt;img src=x onerror=alert(1)&gt;") || strings.Contains(err.Error(), maliciousBlockID) {
		t.Fatalf("deck rejection should HTML-escape unknown block IDs, got %v", err)
	}

	// 没有牌组数据时不拦截
	empty := t.TempDir()
	if err = checkEncryptedImportDeck(empty, nil, nil); nil != err {
		t.Fatalf("import without deck data should pass, got %v", err)
	}

	// 牌组目录存在但没有任何可定位的卡片时，退回报告包内牌组路径
	emptyDeckRoot := t.TempDir()
	if err = os.MkdirAll(filepath.Join(emptyDeckRoot, "storage", "riff"), 0755); err != nil {
		t.Fatal(err)
	}
	err = checkEncryptedImportDeck(emptyDeckRoot, nil, nil)
	if nil == err || !strings.Contains(err.Error(), "storage/riff") {
		t.Fatalf("deck without cards should still be rejected with the deck path, got %v", err)
	}
}
