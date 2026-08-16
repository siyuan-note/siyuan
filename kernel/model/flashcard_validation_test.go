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
	"slices"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestValidateFlashcardBlockIDsReportsSpecificFailure(t *testing.T) {
	oldConf, oldLangs := Conf, util.Langs
	Conf = &AppConf{Lang: "en"}
	util.Langs = map[string]map[int]string{
		"en": {
			180: "block does not exist",
			313: "encrypted notebook is unsupported",
		},
	}
	t.Cleanup(func() {
		Conf, util.Langs = oldConf, oldLangs
	})

	blocks := map[string]*treenode.BlockTree{
		"ordinary":  {ID: "ordinary", BoxID: "ordinary-box"},
		"encrypted": {ID: "encrypted", BoxID: "encrypted-box"},
	}
	getBlockTree := func(id string) *treenode.BlockTree {
		return blocks[id]
	}
	isEncryptedBox := func(boxID string) bool {
		return boxID == "encrypted-box"
	}

	if err := validateFlashcardBlockIDs([]string{"ordinary"}, getBlockTree, isEncryptedBox); err != nil {
		t.Fatalf("ordinary block should be supported: %s", err)
	}
	if err := validateFlashcardBlockIDs([]string{"missing"}, getBlockTree, isEncryptedBox); err == nil || err.Error() != "block does not exist" {
		t.Fatalf("missing block should report the missing-block message, got %v", err)
	}
	if err := validateFlashcardBlockIDs([]string{"encrypted"}, getBlockTree, isEncryptedBox); err == nil || err.Error() != "encrypted notebook is unsupported" {
		t.Fatalf("encrypted block should report the encrypted-notebook message, got %v", err)
	}
}

func TestFlashcardBlockIDsToValidateAllowsEarlierInsert(t *testing.T) {
	const (
		insertedID = "20260814000000-insert1"
		existingID = "20260814000001-exists1"
	)
	transactions := []*Transaction{
		{
			DoOperations: []*Operation{
				{Action: "insert", ID: insertedID},
				{Action: "addFlashcards", BlockIDs: []string{insertedID, existingID}},
			},
		},
	}

	if got := flashcardBlockIDsToValidate(transactions); !slices.Equal(got, []string{existingID}) {
		t.Fatalf("only blocks not inserted earlier should be prevalidated, got %v", got)
	}
	transactions[0].DoOperations[1].BlockIDs = []string{insertedID}
	if err := ValidateFlashcardTransactions(transactions); err != nil {
		t.Fatalf("a flashcard block inserted earlier in the transaction should pass prevalidation: %s", err)
	}
}

func TestFlashcardBlockIDsToValidateReadsIDFromInsertData(t *testing.T) {
	const insertedID = "20260814000000-insert1"
	transactions := []*Transaction{
		{
			DoOperations: []*Operation{
				{
					Action: "insert",
					Data:   `<div data-node-id="20260814000000-insert1" data-type="NodeParagraph" class="p"><div contenteditable="true">content</div><div class="protyle-attr" contenteditable="false"></div></div>`,
				},
				{Action: "addFlashcards", BlockIDs: []string{insertedID}},
			},
		},
	}

	if got := flashcardBlockIDsToValidate(transactions); len(got) != 0 {
		t.Fatalf("a block ID from insert data should not be prevalidated, got %v", got)
	}
	if err := ValidateFlashcardTransactions(transactions); err != nil {
		t.Fatalf("a flashcard block declared in earlier insert data should pass prevalidation: %s", err)
	}
}

func TestFlashcardBlockIDsToValidatePreservesOperationOrder(t *testing.T) {
	const insertedID = "20260814000000-insert1"
	transactions := []*Transaction{
		{
			DoOperations: []*Operation{
				{Action: "addFlashcards", BlockIDs: []string{insertedID}},
				{Action: "insert", ID: insertedID},
			},
		},
	}

	if got := flashcardBlockIDsToValidate(transactions); !slices.Equal(got, []string{insertedID}) {
		t.Fatalf("blocks inserted later should still be prevalidated, got %v", got)
	}
}

func TestFlashcardBlockIDsToValidateScopesInsertsToTransaction(t *testing.T) {
	const insertedID = "20260814000000-insert1"
	transactions := []*Transaction{
		{DoOperations: []*Operation{{Action: "insert", ID: insertedID}}},
		nil,
		{DoOperations: []*Operation{nil, {Action: "addFlashcards", BlockIDs: []string{insertedID}}}},
	}

	if got := flashcardBlockIDsToValidate(transactions); !slices.Equal(got, []string{insertedID}) {
		t.Fatalf("an insert from another transaction should not bypass validation, got %v", got)
	}
}
