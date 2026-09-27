// Command worker consumes PageX background cleanup jobs from a Cloudflare Queue
// over the HTTP pull API.
//
//	go run ./cmd/worker            # consume (default)
//	go run ./cmd/worker provision  # create/update queue, DLQ and consumer
//	go run ./cmd/worker version
//
// Only cleanup work is queued. Deployments themselves stay synchronous in the
// console: upload → Brotli/Gzip → commit → manifest → activation → Redis.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Mahadi-rsio/pagex-worker/internal/cleanup"
	"github.com/Mahadi-rsio/pagex-worker/internal/cloudflare"
	"github.com/Mahadi-rsio/pagex-worker/internal/config"
	"github.com/Mahadi-rsio/pagex-worker/internal/jobs"
	"github.com/Mahadi-rsio/pagex-worker/internal/storage"
	"github.com/Mahadi-rsio/pagex-worker/internal/worker"
)

// version is overridable at build time with -ldflags "-X main.version=…".
var version = "dev"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "worker: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	command := "run"
	if len(args) > 0 {
		command = args[0]
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch command {
	case "run":
		return runConsumer(ctx)
	case "provision":
		return runProvision(ctx)
	case "version", "-version", "--version":
		fmt.Printf("pagex-worker %s\n", version)
		return nil
	default:
		return fmt.Errorf("unknown command %q (expected run, provision or version)", command)
	}
}

func runProvision(ctx context.Context) error {
	// Provisioning runs before the queue exists, so it must not demand the
	// runtime-only variables.
	cfg, err := config.LoadForProvision()
	if err != nil {
		return err
	}

	provisioner := cloudflare.NewProvisioner(cloudflare.ProvisionOptions{
		AccountID:      cfg.AccountID,
		Token:          cfg.QueueToken,
		QueueName:      cfg.QueueName,
		DLQName:        cfg.DLQName,
		BatchSize:      cfg.BatchSize,
		Visibility:     cfg.VisibilityTimeout,
		MaxRetries:     cfg.QueueMaxRetr,
		RetryDelay:     10 * time.Second,
		QueueRetention: cfg.QueueRetain,
	})

	result, err := provisioner.Provision(ctx)
	if err != nil {
		return err
	}

	// Emit the resolved IDs as JSON so a deploy pipeline can capture them
	// straight into the secret store instead of scraping logs.
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Errorf("encode result: %w", err)
	}
	fmt.Println(string(encoded))
	return nil
}

func runConsumer(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	store, err := storage.New(ctx, cfg)
	if err != nil {
		return err
	}
	defer store.Close()

	queue := cloudflare.NewClient(cloudflare.Options{
		AccountID:      cfg.AccountID,
		QueueID:        cfg.QueueID,
		Token:          cfg.QueueToken,
		DLQID:          cfg.DLQID,
		RequestTimeout: cfg.RequestTimeout,
	})

	dispatcher := jobs.NewDispatcher(map[string]jobs.Handler{
		jobs.TypeDeploymentGC: cleanup.NewDeploymentGC(store, cfg.DeploymentRetention),
		jobs.TypePageDelete:   cleanup.NewPageDelete(store),
	})

	consumer := worker.New(worker.Options{
		Queue:             queue,
		Dispatcher:        dispatcher,
		Concurrency:       cfg.Concurrency,
		BatchSize:         cfg.BatchSize,
		VisibilityTimeout: cfg.VisibilityTimeout,
		PollInterval:      cfg.PollInterval,
		MaxAttempts:       cfg.MaxLocalAttempts,
	})

	// Run only returns on cancellation; a queue outage must not kill the process.
	return consumer.Run(ctx)
}
