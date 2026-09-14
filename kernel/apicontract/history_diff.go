package apicontract

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type DocVersionRef struct {
	Type     string `json:"type" api:"trim"`
	ID       string `json:"id" api:"optional,nullable"`
	Path     string `json:"path" api:"optional,nullable"`
	Snapshot string `json:"snapshot" api:"optional,nullable"`
}

type DiffDocVersionsRequest struct {
	Left  DocVersionRef `json:"left"`
	Right DocVersionRef `json:"right"`
}

type DocVersionDiffContent struct {
	ID      string `json:"id"`
	RootID  string `json:"rootID"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

type DocVersionDifference struct {
	ID       string   `json:"id"`
	Statuses []string `json:"statuses"`
}

type DocVersionDiffResult struct {
	Left          *DocVersionDiffContent  `json:"left"`
	Right         *DocVersionDiffContent  `json:"right"`
	Differences   []*DocVersionDifference `json:"differences"`
	Large         bool                    `json:"large"`
	Fallback      bool                    `json:"fallback"`
	Message       string                  `json:"message"`
	TitleModified bool                    `json:"titleModified"`
}

func init() {
	DiffDocVersions.decodeRequest = func(reader io.Reader) (request DiffDocVersionsRequest, err error) {
		fields, err := blockRequestFields(reader, "/api/history/diffDocVersions")
		if err != nil {
			return request, err
		}
		var left, right map[string]json.RawMessage
		if json.Unmarshal(fields["left"], &left) != nil || left == nil {
			return request, fmt.Errorf("left document version is required")
		}
		if json.Unmarshal(fields["right"], &right) != nil || right == nil {
			return request, fmt.Errorf("right document version is required")
		}
		if request.Left, err = decodeDocVersionRef(left); err != nil {
			return request, err
		}
		request.Right, err = decodeDocVersionRef(right)
		return request, err
	}
}

func decodeDocVersionRef(fields map[string]json.RawMessage) (request DocVersionRef, err error) {
	if request.Type, err = legacyField[string](fields, "type", "String", true); err != nil {
		return request, err
	}
	request.Type = strings.TrimSpace(request.Type)
	if request.Type == "" {
		return request, fmt.Errorf("Field [type] must not be empty")
	}
	if request.ID, err = legacyField[string](fields, "id", "String", false); err != nil {
		return request, err
	}
	if request.Path, err = legacyField[string](fields, "path", "String", false); err != nil {
		return request, err
	}
	request.Snapshot, err = legacyField[string](fields, "snapshot", "String", false)
	return request, err
}
