package model

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRepoSnapshotTimeRange(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	index, err := repo.Latest()
	if err != nil {
		t.Fatal(err)
	}
	store, err := dejavu.NewStore(util.RepoDir, Conf.Repo.Key)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 70; i++ {
		clone := *index
		clone.ID = fmt.Sprintf("%040x", i+19943000)
		clone.Created = 1000 + int64(i)
		if err = store.PutIndex(&clone); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		page, count       int
		start, end, first int64
	}{
		{1, 32, 1010, 1050, 1049}, {2, 8, 1010, 1050, 1017}, {3, 0, 1010, 1050, 0},
	} {
		result, pages, total, err := GetRepoSnapshotsByTime(tc.page, tc.start, tc.end)
		if err != nil || pages != 2 || total != 40 || len(result) != tc.count {
			t.Fatalf("range page %d: %d %d %d %v", tc.page, pages, total, len(result), err)
		}
		if len(result) > 0 && (result[0].Created != tc.first || result[0].Files != nil || len(result[0].TypesCount) == 0) {
			t.Fatalf("range metadata: %+v", result[0])
		}
	}
	result, pages, total, err := GetRepoSnapshotsByTime(1, 0, 1000)
	if err != nil || result == nil || len(result) != 0 || pages != 0 || total != 0 {
		t.Fatalf("empty range: %v %d %d %v", result, pages, total, err)
	}
	_, corruptPath := store.IndexAbsPath(fmt.Sprintf("%040x", 99943000))
	corrupt := []byte("invalid authenticated snapshot")
	if err = os.WriteFile(corruptPath, corrupt, 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = GetRepoSnapshotsByTime(1, 2000, 3000); err == nil {
		t.Fatal("date filtering concealed an unreadable snapshot")
	}
	if current, readErr := os.ReadFile(corruptPath); readErr != nil || !bytes.Equal(current, corrupt) {
		t.Fatal("date filtering modified the corrupt source")
	}
}

func TestCloudRepoSnapshotTimeRange(t *testing.T) {
	var calls []int
	load := func(page int) ([]*dejavu.Log, int, int, error) {
		calls = append(calls, page)
		logs := []*dejavu.Log{}
		for i := 0; i < 32; i++ {
			logs = append(logs, &dejavu.Log{Created: int64(1000 + (page-1)*32 + i)})
		}
		return logs, 3, 96, nil
	}
	result, pages, total, err := cloudRepoSnapshotsByTime(2, 1010, 1050, load)
	if err != nil || len(calls) != 3 || pages != 2 || total != 40 || len(result) != 8 || result[0].Created != 1017 {
		t.Fatalf("cloud range: %v %d %d %v", calls, pages, total, err)
	}
	calls = nil
	_, _, _, err = cloudRepoSnapshotsByTime(2, 0, 0, load)
	if err != nil || len(calls) != 1 || calls[0] != 2 {
		t.Fatalf("unfiltered cloud pagination: %v %v", calls, err)
	}
	failure := errors.New("unavailable page")
	result, _, _, err = cloudRepoSnapshotsByTime(1, 1000, 1100, func(page int) ([]*dejavu.Log, int, int, error) {
		if page == 2 {
			return nil, 0, 0, failure
		}
		return load(page)
	})
	if !errors.Is(err, failure) || len(result) != 0 {
		t.Fatalf("partial cloud result accepted: %v %v", result, err)
	}
}
