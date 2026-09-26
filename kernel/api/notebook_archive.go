package api

import (
	"errors"
	"io"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func notebookArchiveFailure[Data any](err error) apicontract.Response[Data] {
	logging.LogErrorf("encrypted notebook archive failed: %s", err)
	key := 406
	switch {
	case errors.Is(err, model.ErrNotebookArchiveInvalid):
		key = 401
	case errors.Is(err, model.ErrNotebookArchiveChanged):
		key = 402
	case errors.Is(err, model.ErrNotebookArchiveBusy):
		key = 403
	case errors.Is(err, model.ErrNotebookArchiveConfigured):
		key = 404
	case errors.Is(err, model.ErrNotebookArchiveAuthentication):
		key = 405
	}
	return apicontract.FailureWithTimeout[Data](-1, model.Conf.Language(key), 7000)
}

var getNotebookArchiveCandidates = contractHandler(apicontract.GetNotebookArchiveCandidates, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.NotebookArchiveCandidatesData] {
	candidates, err := model.ListNotebookArchiveCandidates()
	if err != nil {
		return notebookArchiveFailure[apicontract.NotebookArchiveCandidatesData](err)
	}
	notebooks := make([]apicontract.NotebookArchiveCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		notebooks = append(notebooks, apicontract.NotebookArchiveCandidate{ID: candidate.ID, Current: candidate.Current})
	}
	return apicontract.Success(apicontract.NotebookArchiveCandidatesData{Notebooks: notebooks})
})

var prepareNotebookArchive = contractHandler(apicontract.PrepareNotebookArchive, func(c *gin.Context, request apicontract.PrepareNotebookArchiveRequest) apicontract.Response[apicontract.NotebookArchiveData] {
	id, file, err := model.PrepareNotebookArchive(request.Notebooks)
	if err != nil {
		return notebookArchiveFailure[apicontract.NotebookArchiveData](err)
	}
	return apicontract.Success(apicontract.NotebookArchiveData{ID: id, File: file})
})

var commitNotebookArchive = contractHandler(apicontract.CommitNotebookArchive, func(c *gin.Context, request apicontract.CommitNotebookArchiveRequest) apicontract.Response[apicontract.Null] {
	if err := model.CommitNotebookArchive(request.ID, request.Saved); err != nil {
		return notebookArchiveFailure[apicontract.Null](err)
	}
	return apicontract.Success(apicontract.Null{})
})

var importNotebookArchive = contractHandler(apicontract.ImportNotebookArchive, func(c *gin.Context, request apicontract.ImportNotebookArchiveRequest) apicontract.Response[apicontract.Null] {
	input, err := request.File.Open()
	if err != nil {
		return notebookArchiveFailure[apicontract.Null](err)
	}
	defer input.Close()
	file, err := os.CreateTemp(util.TempDir, "notebook-archive-upload-*.zip")
	if err != nil {
		return notebookArchiveFailure[apicontract.Null](err)
	}
	defer os.Remove(file.Name())
	_, err = io.Copy(file, input)
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return notebookArchiveFailure[apicontract.Null](err)
	}
	var keyData []byte
	if request.Key != nil {
		key, openErr := request.Key.Open()
		if openErr != nil {
			return notebookArchiveFailure[apicontract.Null](openErr)
		}
		keyData, err = io.ReadAll(io.LimitReader(key, 4*1024*1024+1))
		key.Close()
		if err != nil || len(keyData) > 4*1024*1024 {
			return notebookArchiveFailure[apicontract.Null](model.ErrNotebookArchiveInvalid)
		}
	}
	if err = model.ImportNotebookArchive(file.Name(), strings.TrimSpace(request.Password), keyData); err != nil {
		return notebookArchiveFailure[apicontract.Null](err)
	}
	return apicontract.Success(apicontract.Null{})
})
