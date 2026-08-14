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
	"os"
	"path/filepath"
	"testing"

	"github.com/klauspost/compress/zstd"
	"google.golang.org/protobuf/encoding/protowire"
)

func TestPreviewAnkiPackageReadsCollectionAndCompatibility(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(root, "collection.anki2")
	db, err := sql.Open("sqlite3", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	statements := []string{
		`CREATE TABLE col (crt INTEGER, ver INTEGER, models TEXT, decks TEXT)`,
		`CREATE TABLE notes (id INTEGER, mid INTEGER)`,
		`CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER)`,
		`CREATE TABLE revlog (id INTEGER, cid INTEGER)`,
		`INSERT INTO col VALUES (1700000000, 11,
		'{"100":{"id":100,"name":"Basic","type":0,"flds":[{"name":"Front","ord":0},{"name":"Back","ord":1}],"tmpls":[{"name":"Card 1","ord":0,"qfmt":"{{Front}}","afmt":"{{FrontSide}}<hr>{{Back}}"}]},"200":{"id":200,"name":"Unsafe","type":0,"flds":[{"name":"Text","ord":0}],"tmpls":[{"name":"Card 1","ord":0,"qfmt":"<script>alert(1)</script>{{Text}}","afmt":"{{Text}}"}]}}',
		'{"1":{"id":1,"name":"Default"},"2":{"id":2,"name":"Languages"}}')`,
		`INSERT INTO notes VALUES (10, 100), (11, 100), (12, 200)`,
		`INSERT INTO cards VALUES (20, 10, 1), (21, 11, 2), (22, 12, 2)`,
		`INSERT INTO revlog VALUES (1000, 20), (1001, 21)`,
	}
	for _, statement := range statements {
		if _, err = db.Exec(statement); err != nil {
			_ = db.Close()
			t.Fatal(err)
		}
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	packagePath := filepath.Join(root, "fixture.apkg")
	archiveFile, err := os.Create(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(archiveFile)
	collectionWriter, err := writer.Create("collection.anki2")
	if err != nil {
		t.Fatal(err)
	}
	collectionData, err := os.ReadFile(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = collectionWriter.Write(collectionData); err != nil {
		t.Fatal(err)
	}
	mediaWriter, err := writer.Create("media")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = mediaWriter.Write([]byte(`{"0":"image.png","1":"sound.mp3"}`)); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err = archiveFile.Close(); err != nil {
		t.Fatal(err)
	}

	preview, err := PreviewAnkiPackage(context.Background(), packagePath)
	if err != nil {
		t.Fatal(err)
	}
	if preview.CollectionID == "" || preview.PackageDigest == "" || preview.NoteCount != 3 ||
		preview.CardCount != 3 || preview.ReviewCount != 2 || preview.MediaCount != 2 ||
		len(preview.NoteTypes) != 2 || len(preview.Decks) != 2 || len(preview.Unsupported) != 1 {
		t.Fatalf("unexpected Anki package preview: %+v", preview)
	}
	if preview.NoteTypes[0].NoteCount != 2 || preview.Decks[1].CardCount != 2 ||
		preview.NoteTypes[1].Conversion != "safeFallback" {
		t.Fatalf("Anki package counts or compatibility are incorrect: %+v", preview)
	}
	compressedPackagePath := filepath.Join(root, "compressed.apkg")
	compressedPackage, err := os.Create(compressedPackagePath)
	if err != nil {
		t.Fatal(err)
	}
	compressedArchive := zip.NewWriter(compressedPackage)
	compressedEntry, err := compressedArchive.Create("collection.anki21b")
	if err != nil {
		t.Fatal(err)
	}
	encoder, err := zstd.NewWriter(compressedEntry)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = encoder.Write(collectionData); err != nil {
		t.Fatal(err)
	}
	if err = encoder.Close(); err != nil {
		t.Fatal(err)
	}
	if err = compressedArchive.Close(); err != nil {
		t.Fatal(err)
	}
	if err = compressedPackage.Close(); err != nil {
		t.Fatal(err)
	}
	compressedPreview, err := PreviewAnkiPackage(context.Background(), compressedPackagePath)
	if err != nil || compressedPreview.CollectionEntry != "collection.anki21b" ||
		compressedPreview.CardCount != preview.CardCount {
		t.Fatalf("compressed Anki package was not supported: preview=%+v err=%v", compressedPreview, err)
	}
}

func TestValidateAnkiRecordCounts(t *testing.T) {
	tests := []struct {
		name    string
		preview AnkiPackagePreview
		message string
	}{
		{"notes", AnkiPackagePreview{NoteCount: maxAnkiNoteCount + 1}, "Anki package contains too many notes"},
		{"cards", AnkiPackagePreview{CardCount: maxAnkiCardCount + 1}, "Anki package contains too many cards"},
		{"reviews", AnkiPackagePreview{ReviewCount: maxAnkiReviewCount + 1}, "Anki package contains too many reviews"},
		{"total", AnkiPackagePreview{NoteCount: maxAnkiNoteCount, CardCount: maxAnkiCardCount,
			ReviewCount: maxAnkiRecordCount - maxAnkiNoteCount - maxAnkiCardCount + 1},
			"Anki package contains too many records"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateAnkiRecordCounts(test.preview); err == nil || err.Error() != test.message {
				t.Fatalf("unexpected Anki record limit result: %v", err)
			}
		})
	}
	if err := validateAnkiRecordCounts(AnkiPackagePreview{NoteCount: 1, CardCount: 1, ReviewCount: 1}); err != nil {
		t.Fatalf("valid Anki record counts were rejected: %v", err)
	}
}

func TestPreviewModernCompressedAnkiPackage(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(root, "collection.anki21b.sqlite")
	db, err := sql.Open("sqlite3", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	noteTypeConfig := protowire.AppendTag(nil, 1, protowire.VarintType)
	noteTypeConfig = protowire.AppendVarint(noteTypeConfig, 1)
	templateConfig := protowire.AppendTag(nil, 1, protowire.BytesType)
	templateConfig = protowire.AppendString(templateConfig, "{{cloze:Text}}")
	templateConfig = protowire.AppendTag(templateConfig, 2, protowire.BytesType)
	templateConfig = protowire.AppendString(templateConfig, "{{cloze:Text}}<hr>{{Extra}}")
	statements := []string{
		`CREATE TABLE col (crt INTEGER, ver INTEGER)`,
		`CREATE TABLE notetypes (id INTEGER, name TEXT, config BLOB)`,
		`CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT, config BLOB)`,
		`CREATE TABLE templates (ntid INTEGER, ord INTEGER, name TEXT, config BLOB)`,
		`CREATE TABLE decks (id INTEGER, name TEXT)`,
		`CREATE TABLE notes (id INTEGER, mid INTEGER)`,
		`CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER)`,
		`CREATE TABLE revlog (id INTEGER, cid INTEGER)`,
		`INSERT INTO col VALUES (1700000000, 18)`,
		`INSERT INTO notes VALUES (10, 100)`,
		`INSERT INTO cards VALUES (20, 10, 1)`,
		`INSERT INTO revlog VALUES (1000, 20)`,
		`INSERT INTO decks VALUES (1, 'Modern')`,
	}
	for _, statement := range statements {
		if _, err = db.Exec(statement); err != nil {
			_ = db.Close()
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(`INSERT INTO notetypes VALUES (?, ?, ?)`, 100, "Cloze", noteTypeConfig); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO fields VALUES (?, ?, ?, ?), (?, ?, ?, ?)`, 100, 0, "Text", []byte{},
		100, 1, "Extra", []byte{}); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO templates VALUES (?, ?, ?, ?)`, 100, 0, "Cloze", templateConfig); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	databaseData, err := os.ReadFile(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	packagePath := filepath.Join(root, "modern.apkg")
	packageFile, err := os.Create(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(packageFile)
	entry, err := archive.Create("collection.anki21b")
	if err != nil {
		t.Fatal(err)
	}
	encoder, err := zstd.NewWriter(entry)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = encoder.Write(databaseData); err != nil {
		t.Fatal(err)
	}
	if err = encoder.Close(); err != nil {
		t.Fatal(err)
	}
	if err = archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err = packageFile.Close(); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewAnkiPackage(context.Background(), packagePath)
	if err != nil {
		t.Fatal(err)
	}
	if preview.SchemaVersion != 18 || preview.CollectionEntry != "collection.anki21b" ||
		len(preview.NoteTypes) != 1 || preview.NoteTypes[0].Kind != "cloze" ||
		len(preview.NoteTypes[0].Fields) != 2 || len(preview.NoteTypes[0].Templates) != 1 ||
		preview.NoteTypes[0].Templates[0].Conversion != "cloze" || len(preview.Decks) != 1 {
		t.Fatalf("unexpected modern Anki preview: %+v", preview)
	}
}

func TestSafeAnkiTemplateStyleRewritesImportedMedia(t *testing.T) {
	style := safeAnkiTemplateStyle(`.card { background: url("background image.png");
		mask-image: url(background%20image.png); }`, map[string]string{
		"background image.png": "assets/background-image.png",
	})
	if style != `.card { background: url("assets/background-image.png");
		mask-image: url(assets/background-image.png); }` {
		t.Fatalf("Anki template style media was not rewritten: %s", style)
	}
}
