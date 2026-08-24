package handlers

import (
	"errors"

	"github.com/lib/pq"
)

// isUniqueViolation reports whether err is a Postgres unique-constraint
// failure, optionally for one specific constraint name.
func isUniqueViolation(err error, constraint string) bool {
	var pqErr *pq.Error
	if !errors.As(err, &pqErr) {
		return false
	}
	if pqErr.Code != "23505" {
		return false
	}
	return constraint == "" || pqErr.Constraint == constraint
}

// isForeignKeyViolation reports whether err is a Postgres FK failure, which we
// use to turn "referenced a user that does not exist" into a 400 instead of a
// 500.
func isForeignKeyViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "23503"
}
