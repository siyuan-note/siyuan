package model

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAnkiConnectQueries(t *testing.T) {
	notes := []ankiConnectNoteInfo{
		{NoteID: 1, ModelName: "Basic", DeckName: "My Words::English", Tags: []string{"aictionary", "ai"}, Fields: map[string]ankiConnectFieldInfo{"Front": {Value: "<b>hello world</b>", Order: 0}}},
		{NoteID: 2, ModelName: "Cloze", DeckName: "Other", Tags: []string{"language::ja"}, Fields: map[string]ankiConnectFieldInfo{"Text": {Value: "goodbye", Order: 0}}},
	}
	for query, want := range map[string]string{"": "[1,2]", `deck:"My Words" tag:ai`: "[1]", `note:Cloze or (Front:"hello world" -tag:missing)`: "[1,2]", `nid:2,9`: "[2]", `-deck:"My Words"`: "[2]", `tag:language::*`: "[2]", `hello`: "[1]"} {
		got, err := findAnkiConnectNotes(query, notes)
		if err != nil || string(got) != want {
			t.Fatalf("query %s: %s %v", query, got, err)
		}
	}
	for _, query := range []string{`is:due`, `nid:no`, `"unclosed`, `(tag:ai and)`, `or tag:ai`, `tag:ai or`, `(tag:ai`, `-`} {
		if _, err := parseAnkiConnectQuery(query); err == nil {
			t.Fatalf("invalid query accepted: %s", query)
		}
	}
}

func TestAnkiConnectWorkspaceIntegration(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_ANKI_CONNECT") != "1" {
		// 正文缓存与闪卡数据库具有进程级状态，使用独立测试进程隔离工作区。
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAnkiConnectWorkspaceIntegration$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_ANKI_CONNECT=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("AnkiConnect subprocess: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.DataDir, util.TempDir, util.ConfDir, util.QueueDir = filepath.Join(root, "data"), root, root, filepath.Join(root, "queue")
	util.DBPath, util.HistoryDBPath = filepath.Join(root, "siyuan.db"), filepath.Join(root, "history.db")
	util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(root, "asset_content.db"), filepath.Join(root, "blocktree.db")
	Conf = NewAppConf()
	Conf.Lang, Conf.System, Conf.Flashcard = "en", conf.NewSystem(), conf.NewFlashcard()
	util.TimeLangs["en"] = map[string]any{}
	for _, key := range []string{"albl", "blbl", "now", "1s", "xs", "1m", "xm", "1h", "xh", "1d", "xd", "1w", "xw", "1M", "xM", "1y", "2y", "xy", "max"} {
		util.TimeLangs["en"][key] = "time"
	}
	Conf.System.ID = "anki-connect-test-device"
	Conf.FileTree, Conf.Sync, Conf.Search = conf.NewFileTree(), conf.NewSync(), conf.NewSearch()
	Conf.Editor, Conf.Export, Conf.NotebookCrypto = conf.NewEditor(), conf.NewExport(), conf.NewNotebookCrypto()
	const boxID = "20261001000000-ankibox"
	box := &Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name, boxConf.Closed = "AnkiConnect", false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	Conf.Flashcard.AnkiConnectNotebook = boxID
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	defer closeFlashcardV2Store()
	ctx := context.Background()
	preview, err := PreviewLegacyFlashcardMigration(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ActivateLegacyFlashcardMigration(ctx, preview.MigrationID, preview.RecordDigest); err != nil {
		t.Fatal(err)
	}
	call := func(body string, readonly bool, failure string) json.RawMessage {
		t.Helper()
		request, err := apicontract.AnkiConnect.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := ProcessAnkiConnect(ctx, request, readonly)
		if err != nil {
			t.Fatal(err)
		}
		var reply struct {
			Result json.RawMessage
			Error  *string
		}
		if err = json.Unmarshal(encoded, &reply); err != nil {
			t.Fatal(err)
		}
		if failure != "" {
			if reply.Error == nil || !strings.Contains(*reply.Error, failure) {
				t.Fatalf("expected %s: %s", failure, encoded)
			}
		} else if reply.Error != nil {
			t.Fatalf("unexpected error: %s", encoded)
		}
		bundle, err := apicontract.BuildBundle()
		if err != nil {
			t.Fatal(err)
		}
		if err = bundle.ValidateResponse("POST", "/api/flashcard/ankiConnect", encoded); err != nil {
			t.Fatalf("invalid response %s: %v", encoded, err)
		}
		return reply.Result
	}
	call(`{"action":"addNote","version":6,"params":{"note":{"deckName":"Words","modelName":"Basic","fields":{"Front":"hello","Back":"world"}}}}`, false, "deck was not found")
	call(`{"action":"createDeck","version":6,"params":{"deck":"Words"}}`, true, "read-only")
	call(`{"action":"createDeck","version":6,"params":{"deck":"Words"}}`, false, "")
	add := `{"action":"addNote","version":6,"params":{"note":{"deckName":"Words","modelName":"Basic","fields":{"Front":"<style>body{color:red}</style><b>hello</b>","Back":"world<script>alert(1)</script>"},"options":{"allowDuplicate":false},"tags":["aictionary","ai"]}}}`
	id := string(call(add, false, ""))
	if result := string(call(`{"action":"notesInfo","version":6,"params":{"notes":[1]}}`, false, "")); result != "[{}]" {
		t.Fatalf("missing note response: %s", result)
	}
	call(add, false, "duplicate")
	infoRequest := `{"action":"notesInfo","version":6,"params":{"notes":[` + id + `]}}`
	var before []ankiConnectNoteInfo
	if err := json.Unmarshal(call(infoRequest, false, ""), &before); err != nil {
		t.Fatal(err)
	}
	if len(before) != 1 || !strings.Contains(before[0].Fields["Front"].Value, "hello") || strings.Contains(before[0].Fields["Back"].Value, "script") || len(before[0].Cards) != 1 {
		t.Fatalf("unsafe or missing content: %+v", before)
	}
	call(`{"action":"updateNoteFields","version":6,"params":{"note":{"id":`+id+`,"fields":{"Back":"changed"}}}}`, false, "")
	var after []ankiConnectNoteInfo
	if err := json.Unmarshal(call(infoRequest, false, ""), &after); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before[0].Cards, after[0].Cards) || !strings.Contains(after[0].Fields["Back"].Value, "changed") || !reflect.DeepEqual(before[0].Tags, after[0].Tags) {
		t.Fatalf("update changed identity or tags: %+v", after)
	}
	batch := call(`{"action":"addNotes","version":6,"params":{"notes":[{"deckName":"Words","modelName":"Basic","fields":{"Front":"second","Back":"answer"}},{"deckName":"Words","modelName":"Basic","fields":{"Front":"hello","Back":"duplicate"}}]}}`, false, "")
	var batchIDs []*int64
	if err := json.Unmarshal(batch, &batchIDs); err != nil || len(batchIDs) != 2 || batchIDs[0] == nil || batchIDs[1] != nil {
		t.Fatalf("batch results: %s %v", batch, err)
	}
	if result := string(call(`{"action":"canAddNotes","version":6,"params":{"notes":[{"deckName":"Words","modelName":"Basic","fields":{"Front":"hello"}},{"deckName":"Words","modelName":"Cloze","fields":{"Text":"{{c101::invalid}}"}},{"deckName":"Words","modelName":"Basic","fields":{"Front":"new"}}]}}`, false, "")); result != "[false,false,true]" {
		t.Fatalf("preflight mismatch: %s", result)
	}
	if result := string(call(`{"action":"findNotes","version":6,"params":{"query":"tag:aictionary"}}`, false, "")); result != "["+id+"]" {
		t.Fatalf("tag query mismatch: %s", result)
	}
	filename := string(call(`{"action":"storeMediaFile","version":6,"params":{"filename":"image.png","data":"aW1hZ2U="}}`, false, ""))
	if !strings.Contains(filename, "anki-") {
		t.Fatal("media not stored")
	}
	call(`{"action":"updateNoteFields","version":6,"params":{"note":{"id":`+id+`,"audio":[{"filename":"sound.mp3","data":"c291bmQ=","fields":["Back"]}],"video":[{"filename":"clip.mp4","data":"dmlkZW8=","fields":["Back"]}],"picture":[{"filename":"image.png","data":"aW1hZ2U=","fields":["Back"]}]}}}`, false, "")
	if err := json.Unmarshal(call(infoRequest, false, ""), &after); err != nil {
		t.Fatal(err)
	}
	for _, mediaType := range []string{"audio", "video", "img"} {
		if !strings.Contains(after[0].Fields["Back"].Value, "<"+mediaType) {
			t.Fatalf("media missing after conversion: %s", after[0].Fields["Back"].Value)
		}
	}
	call(`{"action":"storeMediaFile","version":6,"params":{"filename":"image.png","path":"secret"}}`, false, "local file paths")
	boxConf.Closed = true
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	call(`{"action":"deckNames","version":6}`, false, "opened notebook")
	boxConf.Closed, boxConf.Encrypted = false, true
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	call(`{"action":"deckNames","version":6}`, false, "encrypted notebooks")
}
