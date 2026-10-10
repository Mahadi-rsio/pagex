import { test } from "node:test";
import assert from "node:assert/strict";
import {
    boundedLogAppend,
    canRetry,
    decideControllerAction,
    decideStaleReclaim,
    isLeaseExpired,
    isTerminalStatus,
    normalizeMachineState,
    redactSecrets,
    sanitizeError,
} from "../src/features/builds/build-policy";

test("terminal statuses are recognised", () => {
    assert.equal(isTerminalStatus("completed"), true);
    assert.equal(isTerminalStatus("failed"), true);
    assert.equal(isTerminalStatus("cancelled"), true);
    assert.equal(isTerminalStatus("queued"), false);
    assert.equal(isTerminalStatus("active"), false);
});

test("canRetry respects the attempt budget", () => {
    assert.equal(canRetry(0, 2), true);
    assert.equal(canRetry(1, 2), true);
    assert.equal(canRetry(2, 2), false);
});

test("isLeaseExpired treats a missing lease as expired", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    assert.equal(isLeaseExpired(null, now), true);
    assert.equal(isLeaseExpired(new Date("2024-01-01T00:01:00Z"), now), false);
    assert.equal(isLeaseExpired(new Date("2023-12-31T23:59:00Z"), now), true);
});

test("decideStaleReclaim requeues only while attempts remain", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const expired = new Date("2023-12-31T23:00:00Z");
    assert.equal(
        decideStaleReclaim({ attempts: 0, max_attempts: 2 }, expired, now),
        "requeue",
    );
    assert.equal(
        decideStaleReclaim({ attempts: 2, max_attempts: 2 }, expired, now),
        "fail",
    );
    assert.equal(
        decideStaleReclaim(
            { attempts: 0, max_attempts: 2 },
            new Date("2024-01-01T01:00:00Z"),
            now,
        ),
        "none",
    );
});

test("boundedLogAppend appends within the cap", () => {
    const r = boundedLogAppend("", 0, "hello\n", 100);
    assert.equal(r.log, "hello\n");
    assert.equal(r.logBytes, 6);
    assert.equal(r.truncated, false);
});

test("boundedLogAppend truncates and freezes past the cap", () => {
    const r = boundedLogAppend("abc", 3, "0123456789", 5);
    assert.ok(r.logBytes <= 5);
    assert.equal(r.truncated, true);
    assert.equal(r.appended, 2);

    const frozen = boundedLogAppend(r.log, r.logBytes, "more", 5, true);
    assert.equal(frozen.appended, 0);
    assert.equal(frozen.log, r.log);
    assert.equal(frozen.truncated, true);
});

test("boundedLogAppend does not split a multibyte rune", () => {
    // "é" is 2 bytes; a cap of 1 should yield 0 bytes, not a broken rune.
    const r = boundedLogAppend("", 0, "é", 1);
    assert.equal(r.logBytes, 0);
    assert.equal(r.log, "");
    assert.equal(r.truncated, true);
});

test("redactSecrets strips job tokens and credentials", () => {
    const token = "pxb.123e4567-e89b-12d3-a456-426614174000.deadbeefdeadbeef";
    const out = redactSecrets(`tok=${token} Authorization: Bearer abc123`);
    assert.ok(!out.includes("deadbeef"));
    assert.ok(!out.includes("abc123"));
});

test("sanitizeError collapses whitespace and redacts", () => {
    const out = sanitizeError(new Error("boom\n\n   secret=abc123"));
    assert.equal(out.includes("\n"), false);
    assert.ok(!out.includes("abc123"));
});

test("decideControllerAction starts on work, stops when idle", () => {
    assert.equal(
        decideControllerAction({
            machineState: "stopped",
            hasQueued: true,
            hasActive: false,
        }),
        "start",
    );
    assert.equal(
        decideControllerAction({
            machineState: "started",
            hasQueued: false,
            hasActive: true,
        }),
        "none",
    );
    assert.equal(
        decideControllerAction({
            machineState: "started",
            hasQueued: false,
            hasActive: false,
        }),
        "stop",
    );
    assert.equal(
        decideControllerAction({
            machineState: "stopped",
            hasQueued: false,
            hasActive: false,
        }),
        "none",
    );
});

test("normalizeMachineState maps unknown states", () => {
    assert.equal(normalizeMachineState("started"), "started");
    assert.equal(normalizeMachineState("suspended"), "suspended");
    assert.equal(normalizeMachineState("wat"), "unknown");
});
