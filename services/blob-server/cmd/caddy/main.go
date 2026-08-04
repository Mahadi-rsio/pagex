// Custom Caddy binary with the static_s3 plugin.
// Built with plain `go build` (no xcaddy) for faster, cacheable Docker builds.
// See: https://github.com/caddyserver/caddy/blob/master/cmd/caddy/main.go
package main

import (
	_ "time/tzdata"

	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	// plug in Caddy modules here
	_ "github.com/caddyserver/caddy/v2/modules/standard"

	// PageX static_s3 plugin (package lives under ./src)
	_ "github.com/Mahadi-rsio/cdx_s3/src"
)

func main() {
	caddycmd.Main()
}
