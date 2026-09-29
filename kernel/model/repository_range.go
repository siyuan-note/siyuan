package model

import (
	"errors"
	"math"
	"sort"
	"time"

	"github.com/88250/go-humanize"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
)

func SnapshotCreatedInRange(created, startTime, endTime int64) bool {
	return (startTime == 0 || created >= startTime) && (endTime == 0 || created < endTime)
}

// repoSnapshotPage 先按创建时间排序再分页，日期范围使用包含起点、不包含终点的毫秒时间戳。
func repoSnapshotPage[T any](items []T, page int, created func(T) int64) ([]T, int, int) {
	sort.SliceStable(items, func(i, j int) bool { return created(items[i]) > created(items[j]) })
	total := len(items)
	pages := (total + 31) / 32
	if page < 1 {
		page = 1
	}
	if page > pages {
		return []T{}, pages, total
	}
	start := (page - 1) * 32
	return items[start:min(start+32, total)], pages, total
}

func GetRepoSnapshotsByTime(page int, startTime, endTime int64) (ret []*Snapshot, pageCount, totalCount int, err error) {
	if startTime == 0 && endTime == 0 {
		return GetRepoSnapshots(page)
	}
	ret = []*Snapshot{}
	if len(Conf.Repo.Key) == 0 {
		return ret, 0, 0, errors.New(Conf.Language(26))
	}
	repo, err := newRepository()
	if err != nil {
		return
	}
	var indexes []*entity.Index
	_, _, err = repo.GetIndexesIter(1, math.MaxInt, func(index *entity.Index) error {
		if SnapshotCreatedInRange(index.Created, startTime, endTime) {
			indexes = append(indexes, index)
		}
		return nil
	})
	if err != nil {
		return
	}
	indexes, pageCount, totalCount = repoSnapshotPage(indexes, page, func(index *entity.Index) int64 { return index.Created })
	var logs []*dejavu.Log
	for _, index := range indexes {
		files, readErr := repo.GetFiles(index)
		if readErr != nil {
			return ret, 0, 0, readErr
		}
		logs = append(logs, &dejavu.Log{
			ID: index.ID, Memo: index.Memo, Created: index.Created,
			HCreated: time.UnixMilli(index.Created).Format("2006-01-02 15:04:05"),
			Files:    files, Count: index.Count, Size: index.Size,
			HSize:    humanize.BytesCustomCeil(uint64(index.Size), 2),
			SystemID: index.SystemID, SystemName: index.SystemName, SystemOS: index.SystemOS,
		})
	}
	if len(logs) > 0 {
		ret = buildSnapshots(logs, false)
		err = attachSnapshotTags(repo, ret)
	}
	return
}

// 云端接口按页返回索引；遍历各页后筛选，避免仅筛选当前页造成漏项和错误页数。
func cloudRepoSnapshotsByTime(page int, startTime, endTime int64,
	load func(int) ([]*dejavu.Log, int, int, error)) ([]*dejavu.Log, int, int, error) {
	if startTime == 0 && endTime == 0 {
		return load(page)
	}
	var matches []*dejavu.Log
	for current, pages := 1, 1; current <= pages; current++ {
		logs, count, _, err := load(current)
		if err != nil {
			return nil, 0, 0, err
		}
		pages = count
		for _, log := range logs {
			if SnapshotCreatedInRange(log.Created, startTime, endTime) {
				matches = append(matches, log)
			}
		}
	}
	ret, pages, total := repoSnapshotPage(matches, page, func(log *dejavu.Log) int64 { return log.Created })
	return ret, pages, total, nil
}
