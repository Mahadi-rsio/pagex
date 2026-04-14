import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const pages = pgTable("pages", {
    id: uuid("id").primaryKey().notNull().defaultRandom(),

    tenant_name: text("tenant_name").notNull(),
    plan: text("plan").notNull().default("free"),
    domain: text("domain").notNull(),
    project_name: text('project_name').notNull(),

    request: integer("request").notNull().default(0),
    request_limit: integer("request_limit").notNull().default(100000),

    bandwidth_usage: integer("bandwidth_usage").notNull().default(0),

    // 2 GB limit (in bytes)
    bandwidth_limit: integer("bandwidth_limit")
        .notNull()
        .default(2147483648),

    createdAt: timestamp("createdAt").defaultNow().notNull()
});
