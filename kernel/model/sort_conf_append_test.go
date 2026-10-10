package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const appendSortOldID = "20261010000001-abcdefg"
const appendSortNewID = "20261010000002-abcdefg"

func TestSortConfAppendReadersObserveCompleteJSON(t *testing.T) {
	initial := []byte(`{"` + appendSortOldID + `":7}`)
	confPath := prepareSortConfAppendTest(t, initial)
	stop, done := make(chan struct{}), make(chan struct{})
	failures := make(chan error, 1)
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
			}
			data, err := filelock.ReadFile(confPath)
			if err != nil || !json.Valid(data) {
				failures <- fmt.Errorf("reader observed incomplete JSON: %q, %v", data, err)
				return
			}
		}
	}()
	defer func() { close(stop); <-done }()
	for i := 0; i < 20; i++ {
		_, data, err := readSortConfMapData(confPath)
		if err != nil {
			t.Fatal(err)
		}
		id := fmt.Sprintf("20261010000002-%07d", i)
		if err = appendSortConfMap(confPath, data, map[string]int{id: i + 8}); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case err := <-failures:
		t.Fatal(err)
	default:
	}
}

func prepareSortConfAppendTest(t *testing.T, data []byte) string {
	t.Helper()
	oldDataDir, oldConf := util.DataDir, Conf
	util.DataDir = filepath.Join(t.TempDir(), "data")
	Conf = NewAppConf()
	t.Cleanup(func() { util.DataDir, Conf = oldDataDir, oldConf })
	confPath := filepath.Join(util.DataDir, "20261010000000-sortbox", ".siyuan", "sort.json")
	if err := os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(confPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	return confPath
}

func saveSortConfAppendTestRecord(t *testing.T, confPath string, record *sortConfAppendRecord) string {
	t.Helper()
	recordPath, err := sortConfAppendPath(confPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(recordPath), 0700); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(recordPath, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	return recordPath
}

func TestSortConfAppendPreservesLegacyJSONAndBoundsWrittenBytes(t *testing.T) {
	initial := []byte("{\n\t\"" + appendSortOldID + "\": -20\n}\n")
	confPath := prepareSortConfAppendTest(t, initial)
	originalInfo, err := os.Stat(confPath)
	if err != nil {
		t.Fatal(err)
	}
	totalIncrementalBytes, totalFullBytes := 0, 0
	for i := 1; i <= 120; i++ {
		_, data, err := readSortConfMapData(confPath)
		if err != nil {
			t.Fatal(err)
		}
		id := fmt.Sprintf("20261010000002-%07d", i)
		additions := map[string]int{id: i}
		record, err := newSortConfAppendRecord(data, additions)
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(record)
		written := len(encoded) + len(record.Suffix)
		if written > 512 {
			t.Fatalf("single-document write grew with notebook size: %d bytes", written)
		}
		totalIncrementalBytes += written
		if err = appendSortConfMap(confPath, data, additions); err != nil {
			t.Fatal(err)
		}
		actual, err := os.ReadFile(confPath)
		if err != nil || !json.Valid(actual) {
			t.Fatalf("append did not leave standard JSON: %q, %v", actual, err)
		}
		totalFullBytes += len(actual)
		if !bytes.HasPrefix(actual, initial[:bytes.LastIndexByte(initial, '}')]) {
			t.Fatal("append rewrote the existing JSON prefix")
		}
		sorts, err := readSortConfMap(confPath)
		if err != nil || sorts[appendSortOldID] != -20 || sorts[id] != i || len(sorts) != i+1 {
			t.Fatalf("legacy or added values lost: %v, %v", sorts, err)
		}
	}
	info, err := os.Stat(confPath)
	if err != nil || !os.SameFile(originalInfo, info) {
		t.Fatalf("incremental writes replaced the whole file: %v", err)
	}
	entries, err := os.ReadDir(sortConfAppendDir())
	if err != nil || len(entries) != 0 {
		t.Fatalf("completed appends retained recovery files: %v, %v", entries, err)
	}
	t.Logf("120 creates: incremental data and recovery records %d bytes, whole-file baseline %d bytes", totalIncrementalBytes, totalFullBytes)
}

func TestSortConfAppendRecoveryAtEveryWriteStage(t *testing.T) {
	for _, empty := range []bool{false, true} {
		initial := []byte(`{"` + appendSortOldID + `":-7}`)
		if empty {
			initial = []byte(" { } \n")
		}
		initial = append(initial, bytes.Repeat([]byte(" "), 512)...)
		for _, stage := range []string{"prepared", "partial", "written", "untruncated"} {
			t.Run(fmt.Sprintf("empty=%t/%s", empty, stage), func(t *testing.T) {
				confPath := prepareSortConfAppendTest(t, initial)
				record, err := newSortConfAppendRecord(initial, map[string]int{appendSortNewID: 8})
				if err != nil {
					t.Fatal(err)
				}
				recordPath := saveSortConfAppendTestRecord(t, confPath, record)
				if stage != "prepared" {
					n := len(record.Suffix)
					if stage == "partial" {
						n /= 2
					}
					partial := append(bytes.Clone(initial[:record.Offset]), record.Suffix[:n]...)
					if stage == "untruncated" {
						partial = append(partial, bytes.Repeat([]byte(" "), len(initial)-len(partial))...)
					}
					if err = os.WriteFile(confPath, partial, 0644); err != nil {
						t.Fatal(err)
					}
				}
				if err = recoverSortConfAppends(); err != nil {
					t.Fatal(err)
				}
				actual, err := readSortConfMap(confPath)
				want := map[string]int{appendSortNewID: 8}
				if !empty {
					want[appendSortOldID] = -7
				}
				if err != nil || !reflect.DeepEqual(actual, want) {
					t.Fatalf("interrupted write lost sorting: %v, %v", actual, err)
				}
				if _, err = os.Stat(recordPath); !os.IsNotExist(err) {
					t.Fatalf("recovery record retained: %v", err)
				}
				if err = recoverSortConfAppends(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestSortConfAppendRecoveryRejectsChangedSourceAndUnknownRecords(t *testing.T) {
	for _, mode := range []string{"prefix", "length", "version", "entries", "separator", "replacement"} {
		t.Run(mode, func(t *testing.T) {
			initial := []byte(`{"` + appendSortOldID + `":7}`)
			confPath := prepareSortConfAppendTest(t, initial)
			record, err := newSortConfAppendRecord(initial, map[string]int{appendSortNewID: 8})
			if err != nil {
				t.Fatal(err)
			}
			actual := bytes.Clone(initial)
			switch mode {
			case "prefix":
				actual[len(actual)-2] = '9'
			case "length":
				actual = append(actual, bytes.Repeat([]byte(" "), 200)...)
			case "version":
				record.Version = 2
			case "entries":
				record.Suffix = []byte(`,"invalid":"value"}`)
			case "separator":
				record.Suffix = bytes.TrimPrefix(record.Suffix, []byte{','})
			case "replacement":
				actual = append(bytes.Clone(initial[:record.Offset]), []byte(`,"20261010000003-abcdefg":9}`)...)
			}
			recordPath := saveSortConfAppendTestRecord(t, confPath, record)
			if err = os.WriteFile(confPath, actual, 0644); err != nil {
				t.Fatal(err)
			}
			if _, err = readSortConfMap(confPath); err == nil {
				t.Fatal("invalid recovery was ignored")
			}
			preserved, err := os.ReadFile(confPath)
			if err != nil || !bytes.Equal(preserved, actual) {
				t.Fatalf("rejected recovery changed source: %q, %v", preserved, err)
			}
			if _, err = os.Stat(recordPath); err != nil {
				t.Fatalf("rejected recovery discarded the record: %v", err)
			}
		})
	}
}

func TestNewSiblingSortValuesPreservesRanksAndHandlesOverflow(t *testing.T) {
	maxInt := int(^uint(0) >> 1)
	for _, position := range []string{"before", "after"} {
		current := []string{appendSortOldID, appendSortNewID, "unranked"}
		ranks := map[string]int{appendSortOldID: -4}
		got, ok := newSiblingSortValues(current, []string{appendSortNewID}, ranks, position)
		want := 1
		if position == "before" {
			want = -5
		}
		if !ok || got[appendSortNewID] != want || ranks[appendSortOldID] != -4 {
			t.Fatalf("bad extreme rank: %v, %v", got, ok)
		}
		if position == "after" {
			ranks[appendSortOldID] = maxInt
		} else {
			ranks[appendSortOldID] = -maxInt - 1
		}
		if _, ok = newSiblingSortValues(current, []string{appendSortNewID}, ranks, position); ok {
			t.Fatal("rank overflow did not request complete reordering")
		}
	}
}

func TestSortConfAppendRecoversBeforeRepositoryCreation(t *testing.T) {
	prepareAssetDownloadRepoTest(t)
	confPath := filepath.Join(util.DataDir, "20261010000000-sortbox", ".siyuan", "sort.json")
	initial := []byte(`{"` + appendSortOldID + `":7}`)
	if err := os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(confPath, initial, 0644); err != nil {
		t.Fatal(err)
	}
	record, err := newSortConfAppendRecord(initial, map[string]int{appendSortNewID: 8})
	if err != nil {
		t.Fatal(err)
	}
	saveSortConfAppendTestRecord(t, confPath, record)
	if err = os.WriteFile(confPath, initial[:record.Offset], 0644); err != nil {
		t.Fatal(err)
	}
	repo, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	index, err := repo.Index("recovered sort", true, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range index.Files {
		file, err := repo.GetFile(id)
		if err != nil {
			t.Fatal(err)
		}
		if file.Path == "/20261010000000-sortbox/.siyuan/sort.json" {
			data, err := repo.OpenFile(file)
			var actual map[string]int
			if err != nil || json.Unmarshal(data, &actual) != nil || actual[appendSortNewID] != 8 || actual[appendSortOldID] != 7 {
				t.Fatalf("snapshot did not preserve recovered standard JSON: %q, %v", data, err)
			}
			return
		}
	}
	t.Fatal("sort conf absent from snapshot")
}
