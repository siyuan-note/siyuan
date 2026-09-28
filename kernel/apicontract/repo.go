package apicontract

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type CreateSnapshotRequest struct {
	Memo string `json:"memo" api:"optional"`
}

type CreateSnapshotData struct {
	ID      string `json:"id"`
	Created bool   `json:"created"`
}

type CheckSnapshotData struct {
	Changed bool `json:"changed"`
}

type SetSnapshotMemoRequest struct {
	ID   string `json:"id"`
	Memo string `json:"memo"`
}

type SetRepoIndexRetentionDaysRequest struct {
	Days float64 `json:"days"`
}
type SetRetentionIndexesDailyRequest struct {
	Indexes float64 `json:"indexes"`
}
type GetRepoFileRequest struct {
	ID string `json:"id" api:"trim"`
}
type RollbackRepoSnapshotFileRequest struct {
	ID string `json:"id" api:"trim"`
}
type OpenRepoSnapshotFileRequest struct {
	ID string `json:"id" api:"trim"`
}
type DiffRepoSnapshotsRequest struct {
	Left  string `json:"left" api:"trim"`
	Right string `json:"right" api:"trim"`
}
type CheckoutRepoRequest struct {
	ID        string `json:"id" api:"trim"`
	SessionID string `json:"sessionID" api:"optional,nullable"`
}
type DownloadCloudSnapshotRequest struct {
	ID  string `json:"id" api:"trim"`
	Tag string `json:"tag"`
}
type UploadCloudSnapshotRequest struct {
	ID  string `json:"id" api:"trim"`
	Tag string `json:"tag"`
}
type GetRepoSnapshotsRequest struct {
	Page float64 `json:"page"`
	// ID 可选，去除首尾空白后按 7 至 40 位十六进制快照 ID 前缀查询本地仓库，不区分大小写，忽略分页。
	// 前缀匹配多个快照时全部返回，按创建时间降序排列。
	// 省略或留空时保留分页列表；未找到返回空列表，格式错误及仓库读取失败返回错误。
	ID string `json:"id" api:"optional"`
	// IncludeFiles 默认为 false；为 true 时 ID 必须完整，返回该快照的文件元数据，不读取文件正文。
	IncludeFiles bool `json:"includeFiles" api:"optional"`
}
type SearchRepoFileRequest struct {
	Keyword string  `json:"keyword" api:"trim"`
	Page    float64 `json:"page"`
}
type GetRepoDocHistoryRequest struct {
	ID   string  `json:"id" api:"trim"`
	Page float64 `json:"page"`
}
type ExportRepoFileRequest struct {
	ID string `json:"id" api:"trim"`
}
type GetCloudRepoSnapshotsRequest struct {
	Page float64 `json:"page"`
}
type RemoveCloudRepoTagSnapshotRequest struct {
	Tag string `json:"tag" api:"trim"`
}
type RemoveRepoTagSnapshotRequest struct {
	Tag string `json:"tag" api:"trim"`
}
type TagSnapshotRequest struct {
	ID   string `json:"id" api:"trim"`
	Name string `json:"name"`
}
type ImportRepoKeyRequest struct {
	Key string `json:"key"`
}
type InitRepoKeyFromPassphraseRequest struct {
	Pass string `json:"pass"`
}

type RepoOpenFileData struct {
	Title         string `json:"title"`
	Content       string `json:"content"`
	DisplayInText bool   `json:"displayInText"`
	Updated       int64  `json:"updated"`
}
type RepoDiffData struct {
	AddsLeft     []*RepoDiffFile `json:"addsLeft"`
	UpdatesLeft  []*RepoDiffFile `json:"updatesLeft"`
	UpdatesRight []*RepoDiffFile `json:"updatesRight"`
	RemovesRight []*RepoDiffFile `json:"removesRight"`
	Left         *RepoDiffIndex  `json:"left"`
	Right        *RepoDiffIndex  `json:"right"`
}
type RepoSnapshotsData struct {
	Snapshots  []*RepoSnapshot `json:"snapshots"`
	PageCount  int             `json:"pageCount"`
	TotalCount int             `json:"totalCount"`
}
type RepoCloudSnapshotsData struct {
	Snapshots  []*RepoLog `json:"snapshots"`
	PageCount  int        `json:"pageCount"`
	TotalCount int        `json:"totalCount"`
}
type RepoTagsData struct {
	Snapshots []*RepoSnapshot `json:"snapshots"`
}
type RepoCloudTagsData struct {
	Snapshots []*RepoLog `json:"snapshots"`
}
type RepoSearchData struct {
	Files      []*RepoDiffFile `json:"files"`
	PageCount  int             `json:"pageCount"`
	TotalCount int             `json:"totalCount"`
}
type RepoDocHistoryData struct {
	Files      []*RepoDocHistory `json:"files"`
	PageCount  int               `json:"pageCount"`
	TotalCount int               `json:"totalCount"`
}
type RepoExportData struct {
	Path string `json:"path"`
}
type RepoKeyData struct {
	Key string `json:"key"`
}
type RepoSnapshot struct {
	RepoLog
	// Tags 为该快照的全部本地标记，按名称排序；未标记时为空数组。
	// Tag 保留标记快照视图中当前行的单个标记，供上传、移除等操作使用。
	Tags             []string         `json:"tags"`
	TypesCount       []*RepoTypeCount `json:"typesCount"`
	RequiresDownload bool             `json:"requiresDownload"`
}
type RepoDiffFile struct {
	FileID  string `json:"fileID"`
	IndexID string `json:"indexID"`
	Title   string `json:"title"`
	Path    string `json:"path"`
	HPath   string `json:"hPath,omitempty"`
	HSize   string `json:"hSize"`
	Updated int64  `json:"updated"`
}
type RepoDiffIndex struct {
	ID      string `json:"id"`
	Created int64  `json:"created"`
}
type RepoDocHistory struct {
	FileID  string `json:"fileID"`
	IndexID string `json:"indexID"`
	Title   string `json:"title"`
	HSize   string `json:"hSize"`
	Updated int64  `json:"updated"`
	// Snapshots 包含引用此文件版本的全部本地标记快照，按快照时间倒序排列；同一快照的标记合并。
	// 以仓库文件 ID 匹配，不只查询 IndexID；仅返回标记、备注等元数据，不读取文件正文。
	Snapshots []*DocHistorySnapshot `json:"snapshots"`
}
type RepoTypeCount struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}
type RepoLog struct {
	ID          string      `json:"id"`          // 索引 ID
	Memo        string      `json:"memo"`        // 索引备注
	Created     int64       `json:"created"`     // 索引时间
	HCreated    string      `json:"hCreated"`    // 索引时间 "2006-01-02 15:04:05"
	Files       []*RepoFile `json:"files"`       // 文件列表
	Count       int         `json:"count"`       // 文件总数
	Size        int64       `json:"size"`        // 文件总大小
	HSize       string      `json:"hSize"`       // 格式化好的文件总大小 "10.00 MB"
	SystemID    string      `json:"systemID"`    // 设备 ID
	SystemName  string      `json:"systemName"`  // 设备名称
	SystemOS    string      `json:"systemOS"`    // 设备操作系统
	Tag         string      `json:"tag"`         // 索引标记名称
	HTagUpdated string      `json:"hTagUpdated"` // 标记时间 "2006-01-02 15:04:05"
}
type RepoFile struct {
	ID      string   `json:"id"`      // 文件标识
	Path    string   `json:"path"`    // 文件路径
	Size    int64    `json:"size"`    // 文件大小
	Updated int64    `json:"updated"` // 最后更新时间
	Chunks  []string `json:"chunks"`  // 文件分块列表
}

func repoRequestFields(reader io.Reader, path string) (map[string]json.RawMessage, error) {
	fields, err := blockRequestFields(reader, path)
	if err != nil {
		return nil, errors.New(strings.ReplaceAll(err.Error(), "map[string]json.RawMessage", "map[string]interface {}"))
	}
	return fields, nil
}
func repoRequestString(fields map[string]json.RawMessage, key string, required, trim bool) (string, error) {
	value, err := legacyField[string](fields, key, "String", required)
	if err != nil {
		return "", err
	}
	if trim && len(fields[key]) > 0 && string(fields[key]) != "null" {
		value = strings.TrimSpace(value)
		if value == "" {
			return "", fmt.Errorf("Field [%s] must not be empty", key)
		}
	}
	return value, nil
}
func init() {
	SetRepoIndexRetentionDays.decodeRequest = func(reader io.Reader) (request SetRepoIndexRetentionDaysRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/setRepoIndexRetentionDays")
		if err != nil {
			return request, err
		}
		if request.Days, err = legacyField[float64](fields, "days", "Number", true); err != nil {
			return request, err
		}
		return request, nil
	}
	SetRetentionIndexesDaily.decodeRequest = func(reader io.Reader) (request SetRetentionIndexesDailyRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/setRetentionIndexesDaily")
		if err != nil {
			return request, err
		}
		if request.Indexes, err = legacyField[float64](fields, "indexes", "Number", true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetRepoFile.decodeRequest = func(reader io.Reader) (request GetRepoFileRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/getRepoFile")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	RollbackRepoSnapshotFile.decodeRequest = func(reader io.Reader) (request RollbackRepoSnapshotFileRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/rollbackRepoSnapshotFile")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	OpenRepoSnapshotFile.decodeRequest = func(reader io.Reader) (request OpenRepoSnapshotFileRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/openRepoSnapshotFile")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	DiffRepoSnapshots.decodeRequest = func(reader io.Reader) (request DiffRepoSnapshotsRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/diffRepoSnapshots")
		if err != nil {
			return request, err
		}
		if request.Left, err = repoRequestString(fields, "left", true, true); err != nil {
			return request, err
		}
		if request.Right, err = repoRequestString(fields, "right", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	CheckoutRepo.decodeRequest = func(reader io.Reader) (request CheckoutRepoRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/checkoutRepo")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		if request.SessionID, err = repoRequestString(fields, "sessionID", false, false); err != nil {
			return request, err
		}
		return request, nil
	}
	DownloadCloudSnapshot.decodeRequest = func(reader io.Reader) (request DownloadCloudSnapshotRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/downloadCloudSnapshot")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		if request.Tag, err = repoRequestString(fields, "tag", true, false); err != nil {
			return request, err
		}
		return request, nil
	}
	UploadCloudSnapshot.decodeRequest = func(reader io.Reader) (request UploadCloudSnapshotRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/uploadCloudSnapshot")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		if request.Tag, err = repoRequestString(fields, "tag", true, false); err != nil {
			return request, err
		}
		return request, nil
	}
	GetRepoSnapshots.decodeRequest = func(reader io.Reader) (request GetRepoSnapshotsRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/getRepoSnapshots")
		if err != nil {
			return request, err
		}
		if request.Page, err = legacyField[float64](fields, "page", "Number", true); err != nil {
			return request, err
		}
		if request.ID, err = legacyField[string](fields, "id", "String", false); err != nil {
			return request, err
		}
		request.ID = strings.TrimSpace(request.ID)
		if raw, exists := fields["includeFiles"]; exists {
			if string(raw) == "null" {
				return request, errors.New("includeFiles must be a boolean")
			}
			if err = json.Unmarshal(raw, &request.IncludeFiles); err != nil {
				return request, err
			}
		}
		return request, nil
	}
	SearchRepoFile.decodeRequest = func(reader io.Reader) (request SearchRepoFileRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/searchRepoFile")
		if err != nil {
			return request, err
		}
		if request.Keyword, err = repoRequestString(fields, "keyword", true, true); err != nil {
			return request, err
		}
		if request.Page, err = legacyField[float64](fields, "page", "Number", true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetRepoDocHistory.decodeRequest = func(reader io.Reader) (request GetRepoDocHistoryRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/getRepoDocHistory")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		if request.Page, err = legacyField[float64](fields, "page", "Number", true); err != nil {
			return request, err
		}
		return request, nil
	}
	ExportRepoFile.decodeRequest = func(reader io.Reader) (request ExportRepoFileRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/exportRepoFile")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	GetCloudRepoSnapshots.decodeRequest = func(reader io.Reader) (request GetCloudRepoSnapshotsRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/getCloudRepoSnapshots")
		if err != nil {
			return request, err
		}
		if request.Page, err = legacyField[float64](fields, "page", "Number", true); err != nil {
			return request, err
		}
		return request, nil
	}
	RemoveCloudRepoTagSnapshot.decodeRequest = func(reader io.Reader) (request RemoveCloudRepoTagSnapshotRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/removeCloudRepoTagSnapshot")
		if err != nil {
			return request, err
		}
		if request.Tag, err = repoRequestString(fields, "tag", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	RemoveRepoTagSnapshot.decodeRequest = func(reader io.Reader) (request RemoveRepoTagSnapshotRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/removeRepoTagSnapshot")
		if err != nil {
			return request, err
		}
		if request.Tag, err = repoRequestString(fields, "tag", true, true); err != nil {
			return request, err
		}
		return request, nil
	}
	TagSnapshot.decodeRequest = func(reader io.Reader) (request TagSnapshotRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/tagSnapshot")
		if err != nil {
			return request, err
		}
		if request.ID, err = repoRequestString(fields, "id", true, true); err != nil {
			return request, err
		}
		if request.Name, err = repoRequestString(fields, "name", true, false); err != nil {
			return request, err
		}
		return request, nil
	}
	ImportRepoKey.decodeRequest = func(reader io.Reader) (request ImportRepoKeyRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/importRepoKey")
		if err != nil {
			return request, err
		}
		if request.Key, err = repoRequestString(fields, "key", true, false); err != nil {
			return request, err
		}
		return request, nil
	}
	InitRepoKeyFromPassphrase.decodeRequest = func(reader io.Reader) (request InitRepoKeyFromPassphraseRequest, err error) {
		fields, err := repoRequestFields(reader, "/api/repo/initRepoKeyFromPassphrase")
		if err != nil {
			return request, err
		}
		if request.Pass, err = repoRequestString(fields, "pass", true, false); err != nil {
			return request, err
		}
		return request, nil
	}
}
