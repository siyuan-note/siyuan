package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/siyuan-note/siyuan/kernel/ocr"
)

func main() {
	var request ocr.WorkerRequest
	err := json.NewDecoder(io.LimitReader(os.Stdin, 16384)).Decode(&request)
	if err == nil && request.Config.Worker != "" {
		err = fmt.Errorf("recursive OCR worker is forbidden")
	}
	if err == nil {
		provider := &ocr.PaddleProvider{Config: func() ocr.PaddleConfig { return request.Config }}
		defer provider.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		var rows []map[string]string
		if request.Image == "" {
			err = provider.Validate(ctx)
			rows = []map[string]string{}
		} else {
			rows, err = provider.Recognize(ctx, request.Image)
		}
		if err == nil {
			err = json.NewEncoder(os.Stdout).Encode(rows)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
