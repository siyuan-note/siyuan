package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

func decodeCopyFiles(reader io.Reader, path string, trim bool) (request CopyFilesRequest, err error) {
	fields, err := blockRequestFields(reader, path)
	if err != nil {
		return request, err
	}
	srcs, err := legacyField[[]json.RawMessage](fields, "srcs", "Array", true)
	if err != nil {
		return request, err
	}
	if len(srcs) == 0 {
		return request, fmt.Errorf("Field [srcs] must not be empty")
	}
	request.DestDir, err = legacyField[string](fields, "destDir", "String", true)
	if err != nil {
		return request, err
	}
	for _, raw := range srcs {
		var src string
		if bytes.Equal(raw, []byte("null")) || json.Unmarshal(raw, &src) != nil {
			return request, fmt.Errorf("Field [srcs]: each element should be of type [String]")
		}
		if trim {
			src = strings.TrimSpace(src)
			if src == "" {
				return request, fmt.Errorf("Field [srcs]: path must not be empty")
			}
		}
		request.Srcs = append(request.Srcs, src)
	}
	return
}

func init() {
	GlobalCopyFiles.decodeRequest = func(reader io.Reader) (CopyFilesRequest, error) {
		return decodeCopyFiles(reader, "/api/file/globalCopyFiles", false)
	}
	WorkspaceCopyFiles.decodeRequest = func(reader io.Reader) (CopyFilesRequest, error) {
		return decodeCopyFiles(reader, "/api/file/workspaceCopyFiles", true)
	}
}
