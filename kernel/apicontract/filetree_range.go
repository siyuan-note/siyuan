package apicontract

import (
	"bytes"
	"fmt"
	"io"
)

type FileTreeRangeRequest struct {
	Notebook string `json:"notebook"`
	ParentID string `json:"parentID"`
	Offset   int    `json:"offset"`
	Limit    *int   `json:"limit,omitempty" api:"optional,nonnullable"`
	Revision string `json:"revision" api:"optional"`
}

type FileTreeRangeData struct {
	Box               string          `json:"box"`
	ParentID          string          `json:"parentID"`
	Path              string          `json:"path"`
	Files             []*FileTreeFile `json:"files"`
	Total             int             `json:"total"`
	Offset            int             `json:"offset"`
	Limit             int             `json:"limit"`
	EffectiveSortMode int             `json:"effectiveSortMode"`
	Revision          string          `json:"revision"`
	Stale             bool            `json:"stale"`
}

type FileTreeLocateRequest struct {
	Notebook string `json:"notebook"`
	ID       string `json:"id"`
}

type FileTreeLocateStep struct {
	ParentID          string `json:"parentID"`
	Path              string `json:"path"`
	ID                string `json:"id"`
	Index             int    `json:"index"`
	Total             int    `json:"total"`
	EffectiveSortMode int    `json:"effectiveSortMode"`
	Revision          string `json:"revision"`
}

type FileTreeLocateData struct {
	Box   string               `json:"box"`
	ID    string               `json:"id"`
	Steps []FileTreeLocateStep `json:"steps"`
}

func init() {
	ListDocTreeRange.decodeRequest = func(reader io.Reader) (request FileTreeRangeRequest, err error) {
		fields, err := fileTreeRequestFields(reader, ListDocTreeRange.definition.Path)
		if err != nil {
			return request, err
		}
		if bytes.Equal(bytes.TrimSpace(fields["limit"]), []byte("null")) {
			return request, fmt.Errorf("Field [limit] must not be null")
		}
		return fileTreeBind[FileTreeRangeRequest](fields)
	}
}
