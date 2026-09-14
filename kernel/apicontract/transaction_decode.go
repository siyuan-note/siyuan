package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

func init() {
	UndoState.decodeRequest = func(reader io.Reader) (TransactionUndoStateRequest, error) {
		return avDecodeParsedRequest[TransactionUndoStateRequest](reader, "/api/transactions/undoState")
	}
	ClearHistory.decodeRequest = func(reader io.Reader) (TransactionClearHistoryRequest, error) {
		return avDecodeParsedRequest[TransactionClearHistoryRequest](reader, "/api/transactions/clearHistory")
	}
	PerformUndo.decodeRequest = func(reader io.Reader) (TransactionHistoryRequest, error) {
		return avDecodeParsedRequest[TransactionHistoryRequest](reader, "/api/transactions/undo")
	}
	PerformRedo.decodeRequest = func(reader io.Reader) (TransactionHistoryRequest, error) {
		return avDecodeParsedRequest[TransactionHistoryRequest](reader, "/api/transactions/redo")
	}
	PerformTransactions.decodeRequest = decodePerformTransactions
}

func decodePerformTransactions(reader io.Reader) (request PerformTransactionsRequest, err error) {
	fields, err := blockRequestFields(reader, "/api/transactions")
	if err != nil {
		return request, err
	}
	transactions, err := legacyField[[]json.RawMessage](fields, "transactions", "Array", true)
	if err != nil {
		return request, err
	}
	if len(transactions) == 0 {
		return request, fmt.Errorf("Field [transactions] must not be empty")
	}
	if request.ReqID, err = legacyField[float64](fields, "reqId", "Number", true); err != nil {
		return request, err
	}
	if request.App, err = legacyField[string](fields, "app", "String", false); err != nil {
		return request, err
	}
	if request.Session, err = legacyField[string](fields, "session", "String", false); err != nil {
		return request, err
	}
	request.TransactionJSON, request.DecodeError = normalizeTransactionJSON(fields["transactions"])
	if request.DecodeError == nil {
		request.DecodeError = json.Unmarshal(request.TransactionJSON, &request.Transactions)
	}
	return request, nil
}

// normalizeTransactionJSON 保留入口先按 JSON 数字读取、再绑定事务结构的数值语义。
func normalizeTransactionJSON(data []byte) ([]byte, error) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return nil, fmt.Errorf("empty JSON value")
	}
	switch data[0] {
	case '{':
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return nil, err
		}
		for key, value := range fields {
			normalized, err := normalizeTransactionJSON(value)
			if err != nil {
				return nil, err
			}
			fields[key] = normalized
		}
		return json.Marshal(fields)
	case '[':
		var items []json.RawMessage
		if err := json.Unmarshal(data, &items); err != nil {
			return nil, err
		}
		for index, value := range items {
			normalized, err := normalizeTransactionJSON(value)
			if err != nil {
				return nil, err
			}
			items[index] = normalized
		}
		return json.Marshal(items)
	case '"', 't', 'f', 'n':
		return data, nil
	default:
		var number float64
		if err := json.Unmarshal(data, &number); err != nil {
			return nil, err
		}
		return json.Marshal(number)
	}
}
