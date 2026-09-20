package apicontract

import (
	"bytes"
	"encoding/json"
	"io"
)

type BacklinkListRequest struct {
	ID               *string               `json:"id" api:"optional"`
	K                string                `json:"k" api:"optional"`
	MK               string                `json:"mk" api:"optional"`
	KnownRevision    string                `json:"knownRevision" api:"optional,nullable,ignoretype"`
	Notebook         string                `json:"notebook" api:"optional,nullable,ignoretype"`
	IncludeMentions  *bool                 `json:"includeMentions" api:"optional"`
	IncludeBacklinks *bool                 `json:"includeBacklinks" api:"optional"`
	Sort             *string               `json:"sort" api:"optional"`
	MentionSort      *string               `json:"mSort" api:"optional"`
	ContainChildren  *bool                 `json:"containChildren" api:"optional"`
	RefDefCandidates bool                  `json:"refDefCandidates" api:"optional,nullable"`
	SourceFilter     *BacklinkSourceFilter `json:"sourceFilter" api:"optional"`
}

func init() { GetBacklink2.decodeRequest = decodeBacklinkListRequest }

// decodeBacklinkListRequest 保留缺少 ID 时提前返回及可选开关忽略错误类型的规则。
func decodeBacklinkListRequest(reader io.Reader) (request BacklinkListRequest, err error) {
	fields, err := blockRequestFields(reader, "/api/ref/getBacklink2")
	if err != nil {
		return request, err
	}
	if raw := fields["id"]; len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return request, nil
	}
	id, err := legacyField[string](fields, "id", "String", true)
	if err != nil {
		return request, err
	}
	request.ID = &id
	if request.K, err = legacyField[string](fields, "k", "String", true); err != nil {
		return request, err
	}
	if request.MK, err = legacyField[string](fields, "mk", "String", true); err != nil {
		return request, err
	}
	_ = json.Unmarshal(fields["knownRevision"], &request.KnownRevision)
	_ = json.Unmarshal(fields["notebook"], &request.Notebook)
	_ = json.Unmarshal(fields["refDefCandidates"], &request.RefDefCandidates)
	var includeMentions bool
	if raw := fields["includeMentions"]; !bytes.Equal(raw, []byte("null")) && json.Unmarshal(raw, &includeMentions) == nil {
		request.IncludeMentions = &includeMentions
	}
	if _, exists := fields["includeBacklinks"]; exists {
		value, decodeErr := legacyField[bool](fields, "includeBacklinks", "Bool", true)
		if decodeErr != nil {
			return request, decodeErr
		}
		request.IncludeBacklinks = &value
	}
	for _, field := range []struct {
		name   string
		target **string
	}{{"sort", &request.Sort}, {"mSort", &request.MentionSort}} {
		if raw := fields[field.name]; len(raw) > 0 && !bytes.Equal(raw, []byte("null")) {
			value, decodeErr := legacyField[string](fields, field.name, "String", true)
			if decodeErr != nil {
				return request, decodeErr
			}
			*field.target = &value
		}
	}
	if _, exists := fields["containChildren"]; exists {
		value, decodeErr := legacyField[bool](fields, "containChildren", "Bool", true)
		if decodeErr != nil {
			return request, decodeErr
		}
		request.ContainChildren = &value
	}
	request.SourceFilter = decodeBacklinkSourceFilter(fields["sourceFilter"])
	return request, nil
}

type BacklinkPath struct {
	SearchPath
	Revision string `json:"revision"`
}

type BacklinkList struct {
	Unchanged     bool            `json:"unchanged"`
	Revision      string          `json:"revision"`
	Backlinks     []*BacklinkPath `json:"backlinks"`
	LinkRefsCount int             `json:"linkRefsCount"`
	Backmentions  []*BacklinkPath `json:"backmentions"`
	MentionsCount int             `json:"mentionsCount"`
	K             string          `json:"k"`
	MK            string          `json:"mk"`
	Box           string          `json:"box"`
}

type BacklinkRefDef struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Path string `json:"path"`
}

type BacklinkRefDefs struct {
	RefDefs []*BacklinkRefDef `json:"refDefs"`
}

type BacklinkListData struct {
	list        *BacklinkList
	definitions *BacklinkRefDefs
}

func BacklinkListResult(list BacklinkList) BacklinkListData { return BacklinkListData{list: &list} }

func BacklinkDefinitionsResult(definitions []*BacklinkRefDef) BacklinkListData {
	return BacklinkListData{definitions: &BacklinkRefDefs{RefDefs: definitions}}
}

func (value BacklinkListData) MarshalJSON() ([]byte, error) {
	if value.list != nil {
		return json.Marshal(value.list)
	}
	return json.Marshal(value.definitions)
}
