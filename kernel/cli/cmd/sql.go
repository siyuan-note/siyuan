// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"text/tabwriter"

	"github.com/siyuan-note/siyuan/kernel/sql"

	"github.com/spf13/cobra"
)

var sqlCmd = &cobra.Command{
	Use:   "sql <statement>",
	Short: "Execute SQL query",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		stmt := args[0]
		limit, _ := cmd.Flags().GetInt("limit")
		if limit < 1 {
			limit = 100
		}

		if err := sql.CheckSingleStatement(stmt); err != nil {
			return err
		}
		if err := sql.CheckReadonlyStatement(stmt); err != nil {
			return err
		}
		rows, info, err := sql.QueryWithRowLimitInfo(stmt, limit)
		if err != nil {
			return err
		}

		switch outputFormat {
		case "json":
			data, _ := json.MarshalIndent(rows, "", "  ")
			fmt.Println(string(data))
		default:
			printSQLResult(rows)
		}
		if info.Truncated {
			fmt.Fprintf(cmd.ErrOrStderr(), "Results truncated to %d rows; use LIMIT and OFFSET to paginate.\n", info.Limit)
		}
		return nil
	},
}

func printSQLResult(rows []map[string]any) {
	if len(rows) == 0 {
		fmt.Println("No results.")
		return
	}

	cols := make([]string, 0, len(rows[0]))
	for k := range rows[0] {
		cols = append(cols, k)
	}
	sort.Strings(cols)

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	for _, col := range cols {
		fmt.Fprintf(w, "%s\t", col)
	}
	fmt.Fprintln(w)

	for _, row := range rows {
		for _, col := range cols {
			fmt.Fprintf(w, "%v\t", row[col])
		}
		fmt.Fprintln(w)
	}
	w.Flush()

	fmt.Printf("\n%d row(s)\n", len(rows))
}

func init() {
	sqlCmd.Flags().IntP("limit", "l", 100, "max rows returned")

	rootCmd.AddCommand(sqlCmd)
}
