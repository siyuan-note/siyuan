package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

func init() {
	BatchUpdateRecentDocCloseTime.decodeRequest = func(reader io.Reader) (request RecentDocsUpdateRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/storage/batchUpdateRecentDocCloseTime")
		if err != nil {
			return request, err
		}
		raw := fields["rootIDs"]
		if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
			return request, nil
		}
		var entries []json.RawMessage
		if json.Unmarshal(raw, &entries) != nil {
			return request, errors.New("Field [rootIDs] should be of type [Array]")
		}
		for _, entry := range entries {
			var id string
			if json.Unmarshal(entry, &id) == nil && id != "" {
				request.RootIDs = append(request.RootIDs, id)
			}
		}
		return
	}
	plain := PatchViewState
	PatchViewState.decodeRequest = func(reader io.Reader) (ViewStatePatchRequest, error) {
		request, err := plain.Decode(reader)
		if err != nil {
			switch {
			case strings.HasPrefix(err.Error(), "Field [values]"):
				err = errors.New("Field [values]: should be of type [Object]")
			case strings.HasPrefix(err.Error(), "Field [removeKeys]"):
				err = errors.New("Field [removeKeys]: each element should be a non-empty String")
			}
		}
		return request, err
	}
}

type RecentDocUpdateRequest struct {
	RootID string `json:"rootID" api:"optional,nullable"`
}
type RecentDocsUpdateRequest struct {
	RootIDs []string `json:"rootIDs" api:"optional,nullable"`
}

type StorageKeyRequest struct {
	Key string `json:"key" api:"trim"`
}
type StorageKeysRequest struct {
	Keys []string `json:"keys"`
}
type StorageRemoveRequest struct {
	Key string `json:"key" api:"trim"`
	App string `json:"app" api:"optional,nullable"`
}
type StorageRemoveKeysRequest struct {
	Keys []string `json:"keys"`
	App  string   `json:"app" api:"optional,nullable"`
}
type StorageSetRequest struct {
	Key string    `json:"key" api:"trim"`
	App string    `json:"app" api:"optional,nullable"`
	Val JSONValue `json:"val" api:"optional,nullable"`
}
type StorageSetKeysRequest struct {
	KeyVals map[string]JSONValue `json:"keyVals"`
	App     string               `json:"app" api:"optional,nullable"`
}
type OutlineStorageRequest struct {
	DocID string `json:"docID" api:"trim"`
}
type OutlineStorageSetRequest struct {
	DocID string               `json:"docID" api:"trim"`
	Val   map[string]JSONValue `json:"val"`
}
type ViewStatePatchRequest struct {
	Key        string               `json:"key" api:"trim"`
	Values     map[string]JSONValue `json:"values" api:"optional"`
	RemoveKeys []string             `json:"removeKeys" api:"optional,nullable"`
}
type RecentDocsRequest struct {
	SortBy string `json:"sortBy" api:"optional,nullable"`
}
type RecentDoc struct {
	RootID   string `json:"rootID"`
	Icon     string `json:"icon,omitempty"`
	Title    string `json:"title,omitempty"`
	ViewedAt int64  `json:"viewedAt,omitempty"`
	ClosedAt int64  `json:"closedAt,omitempty"`
	OpenAt   int64  `json:"openAt,omitempty"`
}
