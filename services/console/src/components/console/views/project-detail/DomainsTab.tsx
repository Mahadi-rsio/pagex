"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/store/useAppStore";
import { Spinner } from "@/components/ui/spinner";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    apiClient,
} from "@/lib/api-client";
import { toast } from "sonner";
import {
    ExternalLink,
    CheckCircle2,
    Globe,
    Plus,
    Copy,
    RefreshCw,
} from "lucide-react";

import {
    CNAME_TARGET,
} from "./utils";

export function DomainsTab({ project }: { project: Project }) {
    type DomainEntry = {
        domain: string;
        type: "Automatic" | "Custom";
        verified: boolean;
    };

    const [loading, setLoading] = useState(true);
    const [domains, setDomains] = useState<DomainEntry[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [step, setStep] = useState<"name" | "dns">("name");
    const [domainInput, setDomainInput] = useState("");
    const [pendingDomain, setPendingDomain] = useState("");
    const [error, setError] = useState("");
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const loadDomain = useCallback(async () => {
        setLoading(true);
        try {
            const pages = await apiClient.getPages();
            const page = pages.find((p) => p.id === project.id);
            const activeDomain = page?.domain ?? project.domain ?? null;
            setDomains(
                activeDomain
                    ? [
                          {
                              domain: activeDomain,
                              type: "Automatic",
                              verified: true,
                          },
                      ]
                    : [],
            );
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : "Failed to load project domain",
            );
            setDomains(
                project.domain
                    ? [
                          {
                              domain: project.domain,
                              type: "Automatic",
                              verified: true,
                          },
                      ]
                    : [],
            );
        } finally {
            setLoading(false);
        }
    }, [project.domain, project.id]);

    useEffect(() => {
        loadDomain();
    }, [loadDomain]);

    const resetDrawer = () => {
        setStep("name");
        setDomainInput("");
        setPendingDomain("");
        setError("");
        setCopiedKey(null);
    };

    const handleDrawerOpenChange = (open: boolean) => {
        setDrawerOpen(open);
        if (!open) resetDrawer();
    };

    const normalizeDomain = (value: string) =>
        value
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "")
            .replace(/^www\./, "");

    const handleContinue = () => {
        const domain = normalizeDomain(domainInput);

        if (!domain) {
            setError("Domain name is required");
            return;
        }
        if (
            !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
                domain,
            )
        ) {
            setError("Enter a valid domain (e.g. example.com)");
            return;
        }
        if (
            domains.some(
                (d) => d.domain === domain || d.domain === `www.${domain}`,
            )
        ) {
            setError("This domain is already added");
            return;
        }

        setPendingDomain(domain);
        setStep("dns");
        setError("");
    };

    const handleCopy = async (key: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedKey(key);
            window.setTimeout(() => setCopiedKey(null), 1500);
        } catch {
            // ignore clipboard errors
        }
    };

    const handleDone = () => {
        toast.error("Custom domains are not available yet");
        handleDrawerOpenChange(false);
    };

    const dnsRecords = pendingDomain
        ? [
              { host: pendingDomain, type: "CNAME", value: CNAME_TARGET },
              {
                  host: `www.${pendingDomain}`,
                  type: "CNAME",
                  value: CNAME_TARGET,
              },
          ]
        : [];

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">Domains</CardTitle>
                            <CardDescription className="text-xs">
                                Active domain for this project
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={loadDomain}
                                disabled={loading}
                            >
                                <RefreshCw
                                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                                />
                                Refresh
                            </Button>
                            <Button
                                size="sm"
                                className="gap-2"
                                onClick={() => setDrawerOpen(true)}
                            >
                                <Plus className="size-3.5" />
                                Add Domain
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-10">
                            <Spinner size="default" />
                        </div>
                    ) : domains.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                            No domain assigned to this project yet.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {domains.map((d) => (
                                <div
                                    key={d.domain}
                                    className="flex items-center gap-3 rounded-none border border-border p-3"
                                >
                                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                        <a
                                            href={`https://${d.domain}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground hover:underline"
                                        >
                                            {d.domain}
                                            <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                                        </a>
                                        <p className="text-xs text-muted-foreground">
                                            {d.type}
                                        </p>
                                    </div>
                                    {d.verified ? (
                                        <Badge
                                            variant="secondary"
                                            className="text-xs"
                                        >
                                            <CheckCircle2 className="mr-1 size-3" />{" "}
                                            Verified
                                        </Badge>
                                    ) : (
                                        <Badge
                                            variant="outline"
                                            className="text-xs"
                                        >
                                            Pending DNS
                                        </Badge>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Sheet open={drawerOpen} onOpenChange={handleDrawerOpenChange}>
                <SheetContent
                    side="bottom"
                    className="mx-auto max-h-[85vh] max-w-lg gap-0 overflow-y-auto rounded-none p-0"
                >
                    <SheetHeader className="border-b border-border p-4">
                        <SheetTitle>
                            {step === "name" ? "Add Domain" : "Configure DNS"}
                        </SheetTitle>
                        <SheetDescription>
                            {step === "name"
                                ? "Enter the domain you want to connect to this project."
                                : "Point these DNS records to finish connecting your domain."}
                        </SheetDescription>
                    </SheetHeader>

                    {step === "name" ? (
                        <>
                            <div className="space-y-3 p-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="domain-name">
                                        Domain name
                                    </Label>
                                    <Input
                                        id="domain-name"
                                        placeholder="example.com"
                                        value={domainInput}
                                        onChange={(e) => {
                                            setDomainInput(e.target.value);
                                            setError("");
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                                handleContinue();
                                        }}
                                        autoFocus
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        We&apos;ll also configure www for this
                                        domain.
                                    </p>
                                </div>
                                {error && (
                                    <p className="text-xs text-destructive">
                                        {error}
                                    </p>
                                )}
                            </div>
                            <SheetFooter className="border-t border-border p-4 sm:flex-row">
                                <Button
                                    variant="ghost"
                                    onClick={() =>
                                        handleDrawerOpenChange(false)
                                    }
                                >
                                    Cancel
                                </Button>
                                <Button onClick={handleContinue}>
                                    Continue
                                </Button>
                            </SheetFooter>
                        </>
                    ) : (
                        <>
                            <div className="space-y-4 p-4">
                                <div className="rounded-none border border-border bg-muted/30 p-3">
                                    <div className="flex items-center gap-2">
                                        <Spinner size="inline" />
                                        <p className="text-sm font-medium text-foreground">
                                            Waiting for DNS
                                        </p>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Add the CNAME records below at your DNS
                                        provider. Verification usually takes a
                                        few minutes.
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {dnsRecords.map((record) => (
                                        <div
                                            key={record.host}
                                            className="space-y-2 rounded-none border border-border p-3"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="truncate text-sm font-medium text-foreground">
                                                    {record.host}
                                                </p>
                                                <Badge
                                                    variant="outline"
                                                    className="shrink-0 text-xs"
                                                >
                                                    {record.type}
                                                </Badge>
                                            </div>
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground">
                                                        Name / Host
                                                    </p>
                                                    <div className="flex items-center gap-1.5 rounded-none bg-muted/50 px-2.5 py-2">
                                                        <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                                            {record.host}
                                                        </code>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="size-6 shrink-0"
                                                            onClick={() =>
                                                                handleCopy(
                                                                    `${record.host}-host`,
                                                                    record.host,
                                                                )
                                                            }
                                                        >
                                                            {copiedKey ===
                                                            `${record.host}-host` ? (
                                                                <CheckCircle2 className="size-3 text-foreground" />
                                                            ) : (
                                                                <Copy className="size-3 text-muted-foreground" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground">
                                                        Value / Target
                                                    </p>
                                                    <div className="flex items-center gap-1.5 rounded-none bg-muted/50 px-2.5 py-2">
                                                        <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                                            {record.value}
                                                        </code>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="size-6 shrink-0"
                                                            onClick={() =>
                                                                handleCopy(
                                                                    `${record.host}-value`,
                                                                    record.value,
                                                                )
                                                            }
                                                        >
                                                            {copiedKey ===
                                                            `${record.host}-value` ? (
                                                                <CheckCircle2 className="size-3 text-foreground" />
                                                            ) : (
                                                                <Copy className="size-3 text-muted-foreground" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <SheetFooter className="border-t border-border p-4 sm:flex-row">
                                <Button
                                    variant="ghost"
                                    onClick={() => setStep("name")}
                                >
                                    Back
                                </Button>
                                <Button onClick={handleDone}>Done</Button>
                            </SheetFooter>
                        </>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}

