package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type DocHistorySnapshot struct {
	ID      string
	FileID  string
	Tags    []string
	Memo    string
	Created int64
}

type DocHistorySnapshotEntry struct {
	Created     string
	HistoryPath string
	Snapshots   []*DocHistorySnapshot
}

// ResolveDocHistorySnapshots 与文件历史预览使用相同的查询和首条记录。
func ResolveDocHistorySnapshots(id string, created []string, op string) ([]*DocHistorySnapshotEntry, error) {
	if !ast.IsNodeIDPattern(id) || len(created) == 0 || len(created) > fileHistoryPageSize {
		return nil, errors.New("invalid document history snapshot query")
	}
	if op == "" {
		op = "all"
	}
	validOp := op == "all"
	for _, item := range validOps {
		validOp = validOp || item == op
	}
	if !validOp {
		return nil, errors.New("invalid history operation")
	}
	ret := make([]*DocHistorySnapshotEntry, 0, len(created))
	for _, timestamp := range created {
		if _, err := strconv.ParseInt(timestamp, 10, 64); err != nil {
			return nil, errors.New("invalid history timestamp")
		}
		items := FullTextSearchHistoryItems(timestamp, id, "%", op, HistoryTypeDocID)
		if len(items) == 0 {
			return nil, errors.New("document history no longer exists")
		}
		ret = append(ret, &DocHistorySnapshotEntry{Created: timestamp, HistoryPath: items[0].Path, Snapshots: []*DocHistorySnapshot{}})
	}
	return ret, nil
}

// GetDocHistorySnapshots 按页匹配本地标记快照，仅在本次请求内复用文件摘要。
// 调用方须持有所有历史所属加密笔记本的请求租约，覆盖响应序列化。
func GetDocHistorySnapshots(ctx context.Context, id string, histories []*DocHistorySnapshotEntry) error {
	type matchKey struct {
		boxID string
		hash  [sha256.Size]byte
	}
	matches := map[matchKey][]*DocHistorySnapshotEntry{}
	allowedBoxes := map[string]bool{}
	for _, history := range histories {
		if err := ctx.Err(); err != nil {
			return err
		}
		version, err := loadHistoryDocVersion(history.HistoryPath)
		if err != nil {
			return err
		}
		hash, err := docHistorySnapshotDigest(version.raw, id)
		clear(version.raw)
		if err != nil {
			return err
		}
		boxID := ""
		if IsEncryptedBox(version.boxID) {
			boxID = version.boxID
		}
		allowedBoxes[boxID] = true
		key := matchKey{boxID, hash}
		matches[key] = append(matches[key], history)
	}
	if len(Conf.Repo.Key) == 0 {
		return nil
	}
	repo, err := newRepository()
	if err != nil {
		return err
	}
	indexes, indexTags, err := localTaggedSnapshotIndexes(ctx, repo)
	if err != nil {
		return err
	}
	fileMatches := map[string][]*DocHistorySnapshotEntry{}
	for indexID, index := range indexes {
		seen := map[*DocHistorySnapshotEntry]bool{}
		for _, fileID := range index.Files {
			if err := ctx.Err(); err != nil {
				return err
			}
			matched, checked := fileMatches[fileID]
			if !checked {
				fileMatches[fileID] = nil
				file, readErr := repo.GetFile(fileID)
				if readErr != nil {
					return readErr
				}
				if path.Base(file.Path) != id+".sy" {
					continue
				}
				boxID := strings.Split(strings.TrimPrefix(file.Path, "/"), "/")[0]
				if !IsEncryptedBox(boxID) {
					boxID = ""
				}
				if !allowedBoxes[boxID] {
					continue
				}
				data, readErr := repo.OpenFile(file)
				if readErr != nil {
					return readErr
				}
				data, readErr = decryptRepoDataIfNeeded(data, file.Path)
				if readErr != nil {
					return readErr
				}
				hash, readErr := docHistorySnapshotDigest(data, id)
				clear(data)
				if readErr != nil {
					return readErr
				}
				matched = matches[matchKey{boxID, hash}]
				fileMatches[fileID] = matched
			}
			for _, history := range matched {
				if seen[history] {
					continue
				}
				seen[history] = true
				history.Snapshots = append(history.Snapshots, &DocHistorySnapshot{
					ID: indexID, FileID: fileID, Tags: indexTags[indexID], Memo: index.Memo, Created: index.Created,
				})
			}
		}
	}
	for _, history := range histories {
		sort.Slice(history.Snapshots, func(i, j int) bool {
			a, b := history.Snapshots[i], history.Snapshots[j]
			if a.Created == b.Created {
				return a.ID < b.ID
			}
			return a.Created > b.Created
		})
	}
	return nil
}

func docHistorySnapshotDigest(data []byte, id string) ([sha256.Size]byte, error) {
	if err := treenode.CheckSpecJSON(data); err != nil {
		return [sha256.Size]byte{}, err
	}
	var root struct {
		ID   string
		Type string
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return [sha256.Size]byte{}, err
	}
	if root.ID != id || root.Type != "NodeDocument" {
		return [sha256.Size]byte{}, fmt.Errorf("history snapshot document ID does not match [%s]", id)
	}
	return sha256.Sum256(data), nil
}

// attachRepoDocHistorySnapshots 按文件版本关联所有标记索引，避免去重列表的单个 IndexID 丢失关联。
func attachRepoDocHistorySnapshots(repo *dejavu.Repo, histories []*RepoDocHistory) error {
	if len(histories) == 0 {
		return nil
	}
	files := map[string]*RepoDocHistory{}
	for _, history := range histories {
		history.Snapshots = []*DocHistorySnapshot{}
		files[history.FileID] = history
	}
	indexes, tags, err := localTaggedSnapshotIndexes(context.Background(), repo)
	if err != nil {
		return err
	}
	for id, index := range indexes {
		seen := map[string]bool{}
		for _, fileID := range index.Files {
			history := files[fileID]
			if history == nil || seen[fileID] {
				continue
			}
			seen[fileID] = true
			history.Snapshots = append(history.Snapshots, &DocHistorySnapshot{
				ID: id, FileID: fileID, Tags: tags[id], Memo: index.Memo, Created: index.Created,
			})
		}
	}
	for _, history := range histories {
		sort.Slice(history.Snapshots, func(i, j int) bool {
			a, b := history.Snapshots[i], history.Snapshots[j]
			if a.Created == b.Created {
				return a.ID < b.ID
			}
			return a.Created > b.Created
		})
	}
	return nil
}

func localTaggedSnapshotIndexes(ctx context.Context, repo *dejavu.Repo) (map[string]*entity.Index, map[string][]string, error) {
	// 只读取标记引用与索引，避免为每个标记重复展开整个快照的文件列表。
	tags, err := os.ReadDir(filepath.Join(repo.Path, "refs", "tags"))
	if os.IsNotExist(err) {
		return map[string]*entity.Index{}, map[string][]string{}, nil
	}
	if err != nil {
		return nil, nil, err
	}
	indexes := map[string]*entity.Index{}
	indexTags := map[string][]string{}
	for _, tag := range tags {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		if tag.IsDir() {
			continue
		}
		indexID, readErr := repo.GetTag(tag.Name())
		if readErr != nil {
			return nil, nil, readErr
		}
		if _, readErr = hex.DecodeString(indexID); len(indexID) != 40 || readErr != nil {
			return nil, nil, errors.New("invalid tagged snapshot ID")
		}
		if indexes[indexID] == nil {
			index, readErr := repo.GetIndex(indexID)
			if readErr != nil {
				return nil, nil, readErr
			}
			if index.ID != indexID || !index.VerifyAESKey(Conf.Repo.Key) {
				return nil, nil, errors.New("invalid tagged snapshot index")
			}
			indexes[indexID] = index
		}
		indexTags[indexID] = append(indexTags[indexID], tag.Name())
	}
	return indexes, indexTags, nil
}
