package main

import (
	_ "time/tzdata"

	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	_ "github.com/caddyserver/caddy/v2/modules/standard"

	// Cloudflare DNS challenge for wildcard SSL
	_ "github.com/caddy-dns/cloudflare"

	// PageX static_s3 plugin (package lives under ./src)
	_ "github.com/Mahadi-rsio/cdx_s3/src"
)

func main() {
	caddycmd.Main()
}
