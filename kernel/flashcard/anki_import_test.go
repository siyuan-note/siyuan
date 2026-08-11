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

package flashcard

import (
	"archive/zip"
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type ankiImportTestWriter struct {
	media map[string][]byte
	notes []AnkiContentNote
}

func (writer *ankiImportTestWriter) StoreMedia(_ context.Context, originalName string,
	data []byte) (string, error) {
	if writer.media == nil {
		writer.media = map[string][]byte{}
	}
	writer.media[originalName] = append([]byte(nil), data...)
	return "assets/imported-" + originalName, nil
}

func (writer *ankiImportTestWriter) WriteNotes(_ context.Context,
	notes []AnkiContentNote) (map[string]AnkiWrittenNote, error) {
	writer.notes = append([]AnkiContentNote(nil), notes...)
	ret := map[string]AnkiWrittenNote{}
	for _, note := range notes {
		written := AnkiWrittenNote{ContainerID: "container-" + note.SourceID, FieldIDs: map[int]string{}}
		for _, field := range note.Fields {
			written.FieldIDs[field.Ord] = "field-" + note.SourceID + "-" + string(rune('0'+field.Ord))
		}
		ret[note.SourceID] = written
	}
	return ret, nil
}

func TestImportAnkiPackageWritesContentRelationsScheduleHistoryTagsAndMedia(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "anki-import-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	packagePath := createAnkiImportPackageForTest(t)
	writer := &ankiImportTestWriter{}
	request := AnkiImportRequest{OperationID: "anki-import", PackagePath: packagePath,
		TargetID: "notebook-a", ImportedAt: 1786431600000, Writer: writer}
	report, err := store.ImportAnkiPackage(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if report.CollectionID == "" || report.PackageDigest == "" || report.Notes != 1 || report.Cards != 1 ||
		report.ReviewEvents != 1 || report.ReviewSets != 2 || report.Tags != 2 || report.Media != 1 {
		t.Fatalf("unexpected Anki import report: %+v", report)
	}
	if len(writer.notes) != 1 || len(writer.notes[0].Fields) != 2 ||
		!strings.Contains(writer.notes[0].Fields[0].Value, "assets/imported-image.png") ||
		string(writer.media["image.png"]) != "image-data" {
		t.Fatalf("Anki content or media was not passed to the writer safely: notes=%+v media=%+v",
			writer.notes, writer.media)
	}
	results, err := store.Projection().SearchCards(ctx, nil, CardSearchOptions{Now: request.ImportedAt,
		IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true})
	if err != nil || len(results) != 1 {
		t.Fatalf("imported Anki card was not projected: results=%+v err=%v", results, err)
	}
	card := results[0]
	if card.Card.Flag != 3 || card.ReviewState.State != "review" || card.ReviewState.Reps != 5 ||
		card.ReviewState.Lapses != 2 || card.ReviewState.ScheduledDays != 12 || len(card.SourceTagIDs) != 1 {
		t.Fatalf("Anki card state, flag or inherited tag is incorrect: %+v", card)
	}
	history, err := store.Projection().CardHistory(ctx, card.Card.ID, 10, 0)
	if err != nil || len(history) != 1 || history[0].EventType != EventReview {
		t.Fatalf("Anki review history was not imported: history=%+v err=%v", history, err)
	}
	cardIDs, err := store.Projection().ReviewSetCardIDs(ctx,
		DeterministicID("anki-review-set", report.CollectionID, "1"), CardSearchOptions{Now: request.ImportedAt,
			IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true})
	if err != nil || len(cardIDs) != 1 || cardIDs[0] != card.Card.ID {
		t.Fatalf("Anki deck membership was not imported: cards=%v err=%v", cardIDs, err)
	}
	countBefore, err := store.Projection().EventCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	retryRequest := request
	retryRequest.ImportedAt++
	retry, err := store.ImportAnkiPackage(ctx, retryRequest)
	if err != nil || retry.Cards != 1 {
		t.Fatalf("Anki import retry failed: report=%+v err=%v", retry, err)
	}
	countAfter, err := store.Projection().EventCount(ctx)
	if err != nil || countAfter != countBefore {
		t.Fatalf("Anki import retry duplicated history: before=%d after=%d err=%v", countBefore, countAfter, err)
	}
	conflictingWriter := &ankiImportTestWriter{}
	conflictingRequest := request
	conflictingRequest.PackagePath = createAnkiImportPackageForTestOptions(t, 2, true)
	conflictingRequest.Writer = conflictingWriter
	if _, err = store.ImportAnkiPackage(ctx, conflictingRequest); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("Anki import operation accepted different package content: %v", err)
	}
	if len(conflictingWriter.notes) != 0 || len(conflictingWriter.media) != 0 {
		t.Fatalf("conflicting Anki import wrote content before rejecting it: %+v", conflictingWriter)
	}
	targetRequest := request
	targetRequest.TargetID = "notebook-b"
	if _, err = store.ImportAnkiPackage(ctx, targetRequest); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("Anki import operation accepted a different target: %v", err)
	}
	movedRequest := request
	movedRequest.OperationID = "anki-import-moved"
	movedRequest.ImportedAt++
	movedRequest.PackagePath = createAnkiImportPackageForTestOptions(t, 2, true)
	moved, err := store.ImportAnkiPackage(ctx, movedRequest)
	if err != nil || moved.Cards != 1 || moved.ReviewEvents != 0 {
		t.Fatalf("Anki card deck move failed: report=%+v err=%v", moved, err)
	}
	oldDeckCards, err := store.Projection().ReviewSetCardIDs(ctx,
		DeterministicID("anki-review-set", report.CollectionID, "1"), CardSearchOptions{Now: movedRequest.ImportedAt,
			IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true})
	if err != nil || len(oldDeckCards) != 0 {
		t.Fatalf("Anki card remained in its previous deck: cards=%v err=%v", oldDeckCards, err)
	}
	newDeckCards, err := store.Projection().ReviewSetCardIDs(ctx,
		DeterministicID("anki-review-set", report.CollectionID, "2"), CardSearchOptions{Now: movedRequest.ImportedAt,
			IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true})
	if err != nil || len(newDeckCards) != 1 || newDeckCards[0] != card.Card.ID {
		t.Fatalf("Anki card was not moved to its new deck: cards=%v err=%v", newDeckCards, err)
	}
	removedRequest := movedRequest
	removedRequest.OperationID = "anki-import-removed"
	removedRequest.ImportedAt++
	removedRequest.PackagePath = createAnkiImportPackageForTestOptions(t, 1, false)
	removed, err := store.ImportAnkiPackage(ctx, removedRequest)
	if err != nil || removed.RetiredSources != 1 {
		t.Fatalf("removed Anki note was not retired: report=%+v err=%v", removed, err)
	}
	sourceRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, card.Card.SourceID)
	if err != nil || !found || sourceRevision.Deleted {
		t.Fatalf("retired Anki source was not retained for history: revision=%+v found=%v err=%v",
			sourceRevision, found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil || source.Status != "deleted" {
		t.Fatalf("removed Anki source status is incorrect: source=%+v err=%v", source, err)
	}
}

func TestAnkiTemplateConversionUsesExactFieldsAndRemovesExecutableMarkup(t *testing.T) {
	models, err := parseAnkiModels([]byte(`{"100":{"id":100,"name":"Basic","type":0,"flds":[` +
		`{"name":"Front","ord":0},{"name":"FrontExtra","ord":1},{"name":"Back","ord":2}],"tmpls":[]}}`))
	if err != nil || len(models) != 1 {
		t.Fatalf("parse test Anki model failed: models=%+v err=%v", models, err)
	}
	fieldIDs := ankiTemplateFieldIDs("collection", models[0], `{{#Front}}{{text:Front}}{{/Front}}{{type:Back}}`)
	expected := []string{ankiFieldID("collection", 100, 0), ankiFieldID("collection", 100, 2)}
	if len(fieldIDs) != len(expected) || fieldIDs[0] != expected[0] || fieldIDs[1] != expected[1] {
		t.Fatalf("Anki template fields were not matched exactly: got=%v expected=%v", fieldIDs, expected)
	}
	markup := safeAnkiTemplateMarkup(`<script>alert(1)</script>{{Front}}<a href="javascript:alert(2)">x</a>`, nil)
	if strings.Contains(strings.ToLower(markup), "script") || strings.Contains(strings.ToLower(markup), "javascript:") ||
		!strings.Contains(markup, "{{Front}}") {
		t.Fatalf("Anki template sanitization failed: %q", markup)
	}
}

func createAnkiImportPackageForTest(t *testing.T) string {
	return createAnkiImportPackageForTestOptions(t, 1, true)
}

func createAnkiImportPackageForTestOptions(t *testing.T, deckID int64, includeNote bool) string {
	t.Helper()
	root := t.TempDir()
	databasePath := filepath.Join(root, "collection.anki2")
	db, err := sql.Open("sqlite3", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	models := `{"100":{"id":100,"name":"Basic","type":0,"flds":[{"name":"Front","ord":0},{"name":"Back","ord":1}],"tmpls":[{"name":"Card 1","ord":0,"qfmt":"{{Front}}","afmt":"{{FrontSide}}<hr>{{Back}}"}]}}`
	decks := `{"1":{"id":1,"name":"Imported"},"2":{"id":2,"name":"Moved"}}`
	statements := []string{
		`CREATE TABLE col (crt INTEGER, ver INTEGER, models TEXT, decks TEXT)`,
		`CREATE TABLE notes (id INTEGER, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT,
			sfld TEXT, csum INTEGER, flags INTEGER, data TEXT)`,
		`CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER,
			type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER,
			left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT)`,
		`CREATE TABLE revlog (id INTEGER, cid INTEGER, usn INTEGER, ease INTEGER, ivl INTEGER, lastIvl INTEGER,
			factor INTEGER, time INTEGER, type INTEGER)`,
	}
	for _, statement := range statements {
		if _, err = db.Exec(statement); err != nil {
			_ = db.Close()
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(`INSERT INTO col VALUES (?, 11, ?, ?)`, 1700000000, models, decks); err != nil {
		t.Fatal(err)
	}
	if includeNote {
		fields := `<img src="image.png">Question` + "\x1f" + "Answer"
		if _, err = db.Exec(`INSERT INTO notes VALUES (10, 'guid-10', 100, 1700000100, -1, ' parent::child ',
			?, '', 0, 0, '')`, fields); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO cards VALUES (20, 10, ?, 0, 1700000100, -1, 2, 2, 30, 12, 2500,
			5, 2, 0, 0, 0, 3, '')`, deckID); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO revlog VALUES (1700000200000, 20, -1, 3, 12, 6, 2500, 1500, 1)`); err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	packagePath := filepath.Join(root, "import.apkg")
	file, err := os.Create(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	databaseData, err := os.ReadFile(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string][]byte{"collection.anki2": databaseData, "media": []byte(`{"0":"image.png"}`),
		"0": []byte("image-data")}
	for name, data := range entries {
		entry, createErr := archive.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, createErr = entry.Write(data); createErr != nil {
			t.Fatal(createErr)
		}
	}
	if err = archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	return packagePath
}
