package cdx_s3

import "database/sql"

// errSQLNoRows returns sql.ErrNoRows so that handler.go can use it without
// importing "database/sql" itself.
func errSQLNoRows() error {
	return sql.ErrNoRows
}
