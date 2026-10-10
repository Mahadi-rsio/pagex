import { test } from "node:test";
import assert from "node:assert/strict";
import {
    formatJobToken,
    generateJobSecret,
    hashJobSecret,
    isBuildJobToken,
    isJobTokenActive,
    parseJobToken,
    verifyJobSecret,
    verifyJobTokenAgainstRecord,
} from "../src/features/builds/job-token.service";

const BUILD_ID = "123e4567-e89b-12d3-a456-426614174000";

test("generateJobSecret is hex and long enough", () => {
    const s = generateJobSecret();
    assert.match(s, /^[a-f0-9]{48}$/);
});

test("formatJobToken + parseJobToken round-trip", () => {
    const secret = generateJobSecret();
    const token = formatJobToken(BUILD_ID, secret);
    assert.ok(isBuildJobToken(token));
    const parts = parseJobToken(token);
    assert.equal(parts?.buildId, BUILD_ID);
    assert.equal(parts?.secret, secret);
});

test("parseJobToken rejects malformed tokens", () => {
    assert.equal(parseJobToken("not-a-token"), null);
    assert.equal(parseJobToken("pxb.not-a-uuid.deadbeef"), null);
    assert.equal(parseJobToken(`pxb.${BUILD_ID}.short`), null);
});

test("verifyJobSecret is true only for the right secret", () => {
    const secret = generateJobSecret();
    const hash = hashJobSecret(secret);
    assert.equal(verifyJobSecret(secret, hash), true);
    assert.equal(verifyJobSecret(generateJobSecret(), hash), false);
});

test("isJobTokenActive requires active status + unexpired", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const base = {
        token_hash: "a".repeat(64),
        token_expires_at: new Date("2024-01-01T01:00:00Z"),
        status: "active",
    };
    assert.equal(isJobTokenActive(base, now), true);
    assert.equal(
        isJobTokenActive({ ...base, status: "completed" }, now),
        false,
    );
    assert.equal(
        isJobTokenActive(
            { ...base, token_expires_at: new Date("2023-12-31T23:00:00Z") },
            now,
        ),
        false,
    );
    assert.equal(isJobTokenActive({ ...base, token_hash: null }, now), false);
});

test("verifyJobTokenAgainstRecord end-to-end", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const secret = generateJobSecret();
    const token = formatJobToken(BUILD_ID, secret);
    const record = {
        token_hash: hashJobSecret(secret),
        token_expires_at: new Date("2024-01-01T01:00:00Z"),
        status: "active",
    };
    assert.equal(verifyJobTokenAgainstRecord(token, record, now), BUILD_ID);
    // wrong secret
    const other = formatJobToken(BUILD_ID, generateJobSecret());
    assert.equal(verifyJobTokenAgainstRecord(other, record, now), null);
    // expired
    assert.equal(
        verifyJobTokenAgainstRecord(
            token,
            { ...record, token_expires_at: new Date("2023-01-01T00:00:00Z") },
            now,
        ),
        null,
    );
    // no record
    assert.equal(verifyJobTokenAgainstRecord(token, null, now), null);
});
