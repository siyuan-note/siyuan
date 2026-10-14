package chatgpt

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
)

type activeRequest struct{ cancel context.CancelFunc }
type accountResponseBody struct {
	io.ReadCloser
	once    sync.Once
	release func()
}

func (b *accountResponseBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.release)
	return err
}

func (s *Service) stopRequests(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blocked[id] = true
	for request := range s.requests[id] {
		request.cancel()
	}
}

func (s *Service) resumeRequests(id string) { s.mu.Lock(); delete(s.blocked, id); s.mu.Unlock() }

// Do 只向公开套餐接口发送凭证，鉴权失败最多刷新一次，额度错误不切换计费方式。
func (s *Service) Do(request *http.Request, accountID string) (*http.Response, error) {
	endpoint := request.URL.String()
	if (request.Method != "POST" || endpoint != s.resource+"/responses") &&
		(request.Method != "GET" || endpoint != s.resource+"/models") {
		return nil, errors.New("unsupported ChatGPT plan route")
	}
	ctx, cancel := context.WithCancel(request.Context())
	active := &activeRequest{cancel: cancel}
	s.mu.Lock()
	if s.blocked[accountID] {
		s.mu.Unlock()
		cancel()
		return nil, errors.New("sign in to ChatGPT again")
	}
	if s.requests[accountID] == nil {
		s.requests[accountID] = map[*activeRequest]bool{}
	}
	s.requests[accountID][active] = true
	s.mu.Unlock()
	release := func() {
		cancel()
		s.mu.Lock()
		delete(s.requests[accountID], active)
		s.mu.Unlock()
	}
	returned := false
	defer func() {
		if !returned {
			release()
		}
	}()
	for attempt := 0; attempt < 2; attempt++ {
		token, err := s.Token(ctx, accountID, attempt != 0)
		if err != nil {
			return nil, err
		}
		clone := request.Clone(ctx)
		clone.Header.Set("Authorization", "Bearer "+token)
		if attempt > 0 && request.Body != nil {
			if request.GetBody == nil {
				return nil, errors.New("ChatGPT request cannot be replayed after token renewal")
			}
			clone.Body, err = request.GetBody()
			if err != nil {
				return nil, err
			}
		}
		response, err := s.http.Do(clone)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, errors.New("ChatGPT connection failed")
		}
		if response.StatusCode != 401 || attempt != 0 {
			response.Body = &accountResponseBody{ReadCloser: response.Body, release: release}
			returned = true
			return response, nil
		}
		response.Body.Close()
	}
	return nil, errors.New("sign in to ChatGPT again")
}

type Model struct {
	ID          string
	DisplayName string
}

func (s *Service) Models(ctx context.Context, id string) ([]Model, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", s.resource+"/models", nil)
	if err != nil {
		return nil, err
	}
	response, err := s.Do(req, id)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if err != nil || len(data) > 4*1024*1024 {
		return nil, errors.New("invalid ChatGPT model catalog")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, responseError(response, data)
	}
	var payload struct {
		Models []struct {
			Slug        string `json:"slug"`
			DisplayName string `json:"display_name"`
			Visibility  string `json:"visibility"`
		} `json:"models"`
	}
	if err = json.Unmarshal(data, &payload); err != nil || payload.Models == nil {
		return nil, errors.New("invalid ChatGPT model catalog")
	}
	models := []Model{}
	seen := map[string]bool{}
	for _, m := range payload.Models {
		if m.Visibility != "list" || m.Slug == "" || seen[m.Slug] {
			continue
		}
		seen[m.Slug] = true
		models = append(models, Model{ID: m.Slug, DisplayName: m.DisplayName})
	}
	return models, nil
}
