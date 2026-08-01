"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import type { Project } from "@/store/useAppStore";
import { formatRelativeTime } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tree, Folder, File } from "@/components/ui/file-tree";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    apiClient,
    type ApiBuild,
    type ApiDeployment,
    type BuildDoneEvent,
    type CommitDeployResult,
} from "@/lib/api-client";
import { buildDeployFile, type SelectedDeployFile } from "@/lib/deploy-utils";
import toast from "react-hot-toast";
import {
    ArrowLeft,
    ExternalLink,
    GitBranch,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Clock,
    Globe,
    Settings,
    BarChart3,
    HardDrive,
    Cpu,
    Zap,
    Plus,
    Trash2,
    Copy,
    Eye,
    EyeOff,
    Upload,
    Activity,
    Rocket,
    RefreshCw,
    Play,
    X,
    Terminal,
    RotateCcw,
    FileText,
} from "lucide-react";

const CNAME_TARGET = "cname.console.app";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
    >
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
);

const statusConfig = {
    active: {
        label: "Active",
        icon: CheckCircle2,
        color: "text-emerald-500",
        badgeVariant: "default" as const,
    },
    building: {
        label: "Building",
        icon: Loader2,
        color: "text-blue-500",
        badgeVariant: "secondary" as const,
    },
    error: {
        label: "Error",
        icon: AlertCircle,
        color: "text-destructive",
        badgeVariant: "destructive" as const,
    },
    inactive: {
        label: "Inactive",
        icon: Clock,
        color: "text-muted-foreground",
        badgeVariant: "outline" as const,
    },
};

function OverviewTab({ project }: { project: Project }) {
    const status =
        statusConfig[project.status as keyof typeof statusConfig] ||
        statusConfig.inactive;
    const StatusIcon = status.icon;
    const [deployments, setDeployments] = useState<ApiDeployment[]>([]);
    const [deploymentsLoading, setDeploymentsLoading] = useState(true);

    const loadDeployments = useCallback(async () => {
        try {
            const list = await apiClient.getDeployments(project.id);
            setDeployments(list.slice(0, 5));
        } catch {
            // Non-critical; keep previous state.
        } finally {
            setDeploymentsLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadDeployments();
    }, [loadDeployments]);

    return (
        <div className="space-y-4">
            {/* Status Card */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">
                                Deployment Status
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                                <StatusIcon
                                    className={`size-4 ${status.color} ${project.status === "building" ? "animate-spin" : ""}`}
                                />
                                <span className="text-lg font-semibold text-foreground">
                                    {status.label}
                                </span>
                            </div>
                        </div>
                        {project.domain && (
                            <a
                                href={`https://${project.domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                            >
                                <ExternalLink className="size-3.5" />
                                {project.domain}
                            </a>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Info Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                    {
                        label: "Repository",
                        value: project.repo || "No repo",
                        icon: GitBranch,
                    },
                    {
                        label: "Provider",
                        value: project.provider || "Manual",
                        icon: Globe,
                    },
                    {
                        label: "Created",
                        value: formatRelativeTime(project.createdAt),
                        icon: Clock,
                    },
                    {
                        label: "Last Updated",
                        value: formatRelativeTime(project.updatedAt),
                        icon: Clock,
                    },
                    {
                        label: "Status",
                        value: status.label,
                        icon: CheckCircle2,
                    },
                    {
                        label: "Domain",
                        value: project.domain || "Not set",
                        icon: ExternalLink,
                    },
                ].map(({ label, value, icon: Icon }) => (
                    <Card key={label}>
                        <CardContent className="p-3">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Icon className="size-3.5 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                    {label}
                                </p>
                            </div>
                            <p className="text-sm font-medium text-foreground truncate">
                                {value}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Recent Deploys */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">
                        Recent Deployments
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    {deploymentsLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        </div>
                    ) : deployments.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No deployments yet. Upload files or trigger a cloud
                            build to get started.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {deployments.map((deploy) => (
                                <div
                                    key={deploy.id}
                                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors"
                                >
                                    <div
                                        className={`size-2 rounded-full shrink-0 ${deploy.is_active ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-foreground truncate">
                                            {deploy.source === "build"
                                                ? `Cloud build · v${deploy.version}`
                                                : `Upload · v${deploy.version}`}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {deploy.file_count} files
                                            {deploy.is_active
                                                ? " · Active"
                                                : ""}
                                        </p>
                                    </div>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {formatRelativeTime(deploy.created_at)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function DomainsTab() {
    type DomainEntry = {
        domain: string;
        type: "Automatic" | "Custom";
        verified: boolean;
    };

    const [domains, setDomains] = useState<DomainEntry[]>([
        {
            domain: "my-saas-app.console.app",
            type: "Automatic",
            verified: true,
        },
        { domain: "app.acme.com", type: "Custom", verified: true },
    ]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [step, setStep] = useState<"name" | "dns">("name");
    const [domainInput, setDomainInput] = useState("");
    const [pendingDomain, setPendingDomain] = useState("");
    const [error, setError] = useState("");
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
        if (!pendingDomain) return;

        setDomains((prev) => [
            ...prev,
            { domain: pendingDomain, type: "Custom", verified: false },
            { domain: `www.${pendingDomain}`, type: "Custom", verified: false },
        ]);
        handleDrawerOpenChange(false);
    };

    const handleDelete = (domain: string) => {
        setDomains((prev) => prev.filter((d) => d.domain !== domain));
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
                                Manage custom domains for this project
                            </CardDescription>
                        </div>
                        <Button
                            size="sm"
                            className="gap-2 shrink-0"
                            onClick={() => setDrawerOpen(true)}
                        >
                            <Plus className="size-3.5" />
                            Add Domain
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {domains.map((d) => (
                            <div
                                key={d.domain}
                                className="flex items-center gap-3 rounded-xl border border-border p-3"
                            >
                                <Globe className="size-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-foreground">
                                        {d.domain}
                                    </p>
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
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 shrink-0"
                                    onClick={() => handleDelete(d.domain)}
                                >
                                    <Trash2 className="size-3.5 text-muted-foreground" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Sheet open={drawerOpen} onOpenChange={handleDrawerOpenChange}>
                <SheetContent
                    side="bottom"
                    className="mx-auto max-h-[85vh] max-w-lg gap-0 overflow-y-auto rounded-t-2xl p-0"
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
                                <div className="rounded-xl border border-border bg-muted/30 p-3">
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="size-3.5 animate-spin text-blue-500" />
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
                                            className="space-y-2 rounded-xl border border-border p-3"
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
                                                    <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2">
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
                                                                <CheckCircle2 className="size-3 text-emerald-500" />
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
                                                    <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2">
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
                                                                <CheckCircle2 className="size-3 text-emerald-500" />
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

function EnvTab() {
    type EnvVar = {
        id: string;
        key: string;
        value: string;
        environment: "All" | "Production" | "Preview" | "Development";
    };

    const [envVars, setEnvVars] = useState<EnvVar[]>([
        {
            id: "1",
            key: "DATABASE_URL",
            value: "postgresql://user:pass@host:5432/db",
            environment: "Production",
        },
        {
            id: "2",
            key: "NEXTAUTH_SECRET",
            value: "super-secret-key-here",
            environment: "All",
        },
        {
            id: "3",
            key: "STRIPE_SECRET_KEY",
            value: "sk_live_xxxxxxxxxxxxxxxx",
            environment: "Production",
        },
        {
            id: "4",
            key: "REDIS_URL",
            value: "redis://localhost:6379",
            environment: "All",
        },
    ]);
    const [showValues, setShowValues] = useState<Record<string, boolean>>({});
    const [isAdding, setIsAdding] = useState(false);
    const [newKey, setNewKey] = useState("");
    const [newValue, setNewValue] = useState("");
    const [newEnvironment, setNewEnvironment] =
        useState<EnvVar["environment"]>("All");
    const [error, setError] = useState("");

    const resetForm = () => {
        setNewKey("");
        setNewValue("");
        setNewEnvironment("All");
        setError("");
        setIsAdding(false);
    };

    const handleAdd = () => {
        const key = newKey.trim();
        const value = newValue.trim();

        if (!key) {
            setError("Key is required");
            return;
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            setError(
                "Key must be a valid identifier (letters, numbers, underscore)",
            );
            return;
        }
        if (
            envVars.some(
                (env) => env.key === key && env.environment === newEnvironment,
            )
        ) {
            setError(`"${key}" already exists for ${newEnvironment}`);
            return;
        }
        if (!value) {
            setError("Value is required");
            return;
        }

        setEnvVars((prev) => [
            {
                id: Math.random().toString(36).substring(2, 9),
                key,
                value,
                environment: newEnvironment,
            },
            ...prev,
        ]);
        resetForm();
    };

    const handleDelete = (id: string) => {
        setEnvVars((prev) => prev.filter((env) => env.id !== id));
    };

    const handleCopy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            // ignore clipboard errors
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Environment Variables
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Manage environment variables for your
                                deployments
                            </CardDescription>
                        </div>
                        {!isAdding && (
                            <Button
                                size="sm"
                                className="gap-2 shrink-0"
                                onClick={() => setIsAdding(true)}
                            >
                                <Plus className="size-3.5" />
                                Add Variable
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {isAdding && (
                        <div className="space-y-3 border border-border p-3 bg-muted/20 rounded-lg">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="env-key">Key</Label>
                                    <Input
                                        id="env-key"
                                        placeholder="API_KEY"
                                        value={newKey}
                                        onChange={(e) => {
                                            setNewKey(
                                                e.target.value.toUpperCase(),
                                            );
                                            setError("");
                                        }}
                                        className="font-mono"
                                        autoFocus
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="env-value">Value</Label>
                                    <Input
                                        id="env-value"
                                        placeholder="secret-value"
                                        value={newValue}
                                        onChange={(e) => {
                                            setNewValue(e.target.value);
                                            setError("");
                                        }}
                                        className="font-mono"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="env-environment">
                                        Environment
                                    </Label>
                                    <select
                                        id="env-environment"
                                        value={newEnvironment}
                                        onChange={(e) =>
                                            setNewEnvironment(
                                                e.target
                                                    .value as EnvVar["environment"],
                                            )
                                        }
                                        className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <option value="All">All</option>
                                        <option value="Production">
                                            Production
                                        </option>
                                        <option value="Preview">Preview</option>
                                        <option value="Development">
                                            Development
                                        </option>
                                    </select>
                                </div>
                            </div>
                            {error && (
                                <p className="text-xs text-destructive">
                                    {error}
                                </p>
                            )}
                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={resetForm}
                                >
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={handleAdd}>
                                    Save Variable
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        {envVars.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                                No environment variables yet. Add one to get
                                started.
                            </p>
                        ) : (
                            envVars.map((env) => (
                                <div
                                    key={env.id}
                                    className="flex items-center gap-3 p-3 border border-border rounded-lg"
                                >
                                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <p className="text-sm font-mono font-medium text-foreground truncate">
                                            {env.key}
                                        </p>
                                        <p className="text-sm font-mono text-muted-foreground truncate">
                                            {showValues[env.id]
                                                ? env.value
                                                : "••••••••••••"}
                                        </p>
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className="text-xs shrink-0"
                                    >
                                        {env.environment}
                                    </Badge>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 shrink-0"
                                        onClick={() =>
                                            setShowValues((prev) => ({
                                                ...prev,
                                                [env.id]: !prev[env.id],
                                            }))
                                        }
                                    >
                                        {showValues[env.id] ? (
                                            <EyeOff className="size-3.5" />
                                        ) : (
                                            <Eye className="size-3.5" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 shrink-0"
                                        onClick={() => handleCopy(env.value)}
                                    >
                                        <Copy className="size-3.5 text-muted-foreground" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 shrink-0"
                                        onClick={() => handleDelete(env.id)}
                                    >
                                        <Trash2 className="size-3.5 text-muted-foreground" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function FilesTab() {
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-sm">Files</CardTitle>
                            <CardDescription className="text-xs">
                                Browse project files from latest deployment
                            </CardDescription>
                        </div>
                        <Button size="sm" variant="outline" className="gap-2">
                            <Upload className="size-3.5" />
                            Upload
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="h-80 rounded-xl border border-border bg-muted/20 p-2">
                        <Tree
                            initialExpandedItems={["src", "src-components"]}
                            initialSelectedId="src-app"
                            className="h-full"
                        >
                            <Folder element="src" value="src">
                                <Folder
                                    element="components"
                                    value="src-components"
                                >
                                    <File value="src-components-button">
                                        <span>button.tsx</span>
                                    </File>
                                    <File value="src-components-card">
                                        <span>card.tsx</span>
                                    </File>
                                    <File value="src-components-header">
                                        <span>header.tsx</span>
                                    </File>
                                </Folder>
                                <Folder element="lib" value="src-lib">
                                    <File value="src-lib-utils">
                                        <span>utils.ts</span>
                                    </File>
                                    <File value="src-lib-api">
                                        <span>api.ts</span>
                                    </File>
                                </Folder>
                                <File value="src-app">
                                    <span>app.tsx</span>
                                </File>
                                <File value="src-main">
                                    <span>main.tsx</span>
                                </File>
                                <File value="src-index-css">
                                    <span>index.css</span>
                                </File>
                            </Folder>
                            <Folder element="public" value="public">
                                <File value="public-favicon">
                                    <span>favicon.ico</span>
                                </File>
                                <File value="public-robots">
                                    <span>robots.txt</span>
                                </File>
                            </Folder>
                            <File value="package-json">
                                <span>package.json</span>
                            </File>
                            <File value="tsconfig">
                                <span>tsconfig.json</span>
                            </File>
                            <File value="next-config">
                                <span>next.config.js</span>
                            </File>
                            <File value="readme">
                                <span>README.md</span>
                            </File>
                        </Tree>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function DeployTab({ project }: { project: Project }) {
    const [files, setFiles] = useState<SelectedDeployFile[]>([]);
    const [isDeploying, setIsDeploying] = useState(false);
    const [deployStep, setDeployStep] = useState("");
    const [deployResult, setDeployResult] = useState<CommitDeployResult | null>(
        null,
    );
    const [deployError, setDeployError] = useState("");
    const [deployments, setDeployments] = useState<ApiDeployment[]>([]);
    const [deploymentsLoading, setDeploymentsLoading] = useState(true);
    const [rollingBack, setRollingBack] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadDeployments = useCallback(async () => {
        try {
            const list = await apiClient.getDeployments(project.id);
            setDeployments(list);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to load deployments",
            );
        } finally {
            setDeploymentsLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadDeployments();
    }, [loadDeployments]);

    const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = Array.from(e.target.files ?? []);
        const entries: SelectedDeployFile[] = selected.map((file) => ({
            path: file.name,
            file,
        }));
        setFiles(entries);
        setDeployResult(null);
        setDeployError("");
        e.target.value = "";
    };

    const removeFile = (path: string) => {
        setFiles((prev) => prev.filter((f) => f.path !== path));
        setDeployResult(null);
        setDeployError("");
    };

    const handleDeploy = async () => {
        if (files.length === 0 || isDeploying) return;
        setIsDeploying(true);
        setDeployError("");
        setDeployResult(null);
        try {
            // 1. Build the file manifest (hash + magic bytes)
            setDeployStep("Hashing files…");
            const manifest = await Promise.all(
                files.map((f) => buildDeployFile(f.file)),
            );

            // 2. Prepare: validate manifest, get token + missing blobs
            setDeployStep("Preparing deployment…");
            const prepared = await apiClient.prepareDeploy({
                pageId: project.id,
                files: manifest,
            });

            // 3. Upload any missing blobs to presigned URLs
            if (prepared.uploadRequired.length > 0) {
                setDeployStep(
                    `Uploading ${prepared.uploadRequired.length} blob(s)…`,
                );
                const hashes = [
                    ...new Set(prepared.uploadRequired.map((u) => u.hash)),
                ];
                const presigned = await apiClient.presignDeploy({
                    deploymentToken: prepared.deploymentToken,
                    hashes,
                });
                const urlMap = new Map(
                    presigned.urls.map((u) => [u.hash, u.url]),
                );
                const fileByHash = new Map(manifest.map((m) => [m.hash, m]));
                for (const hash of hashes) {
                    const url = urlMap.get(hash);
                    const entry = fileByHash.get(hash);
                    if (url && entry) {
                        const source = files.find((f) => f.path === entry.path);
                        if (source) {
                            await apiClient.uploadBlob(
                                url,
                                await source.file.arrayBuffer(),
                            );
                        }
                    }
                }
            }

            // 4. Commit: activate the deployment
            setDeployStep("Finalizing deployment…");
            const committed = await apiClient.commitDeploy({
                deploymentToken: prepared.deploymentToken,
            });
            setDeployResult(committed);
            toast.success(
                `Deployed ${committed.summary.deployedFiles} file${committed.summary.deployedFiles === 1 ? "" : "s"} (v${committed.deployment.version})`,
            );
            setFiles([]);
            loadDeployments();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Deployment failed";
            setDeployError(message);
            toast.error(message);
        } finally {
            setIsDeploying(false);
            setDeployStep("");
        }
    };

    const handleRollback = async (deployment: ApiDeployment) => {
        if (rollingBack) return;
        if (
            !window.confirm(
                `Roll back to deployment v${deployment.version}? This will make it the live version.`,
            )
        ) {
            return;
        }
        setRollingBack(deployment.id);
        try {
            await apiClient.rollback(deployment.id);
            toast.success(`Rolled back to v${deployment.version}`);
            loadDeployments();
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Rollback failed",
            );
        } finally {
            setRollingBack(null);
        }
    };

    return (
        <div className="space-y-4">
            {/* Upload & deploy */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Upload &amp; Deploy
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Deploy static files directly from your browser.
                                Files are content-addressed, compressed, and
                                image-optimized automatically.
                            </CardDescription>
                        </div>
                        {!isDeploying && (
                            <Button
                                size="sm"
                                className="gap-2 shrink-0"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload className="size-3.5" />
                                Select Files
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleSelectFiles}
                    />

                    {files.length === 0 && !deployResult && (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full rounded-xl border border-dashed border-border p-8 text-center hover:border-primary/40 hover:bg-accent/40 transition-colors"
                        >
                            <Upload className="mx-auto mb-2 size-5 text-muted-foreground" />
                            <p className="text-sm font-medium text-foreground">
                                Choose files to deploy
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                HTML, JS, CSS, images… up to 50 MB per file
                            </p>
                        </button>
                    )}

                    {files.length > 0 && (
                        <div className="space-y-2">
                            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                                {files.map((f) => (
                                    <div
                                        key={f.path}
                                        className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                                    >
                                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                            {f.path}
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {(f.file.size / 1024).toFixed(1)} KB
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="size-6 shrink-0"
                                            onClick={() => removeFile(f.path)}
                                            disabled={isDeploying}
                                        >
                                            <X className="size-3.5 text-muted-foreground" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            <Button
                                onClick={handleDeploy}
                                disabled={isDeploying}
                                className="w-full gap-2"
                            >
                                {isDeploying ? (
                                    <>
                                        <Loader2 className="size-4 animate-spin" />
                                        {deployStep || "Deploying…"}
                                    </>
                                ) : (
                                    <>
                                        <Rocket className="size-4" />
                                        Deploy {files.length} file
                                        {files.length === 1 ? "" : "s"}
                                    </>
                                )}
                            </Button>
                        </div>
                    )}

                    {deployError && (
                        <p className="text-xs text-destructive">
                            {deployError}
                        </p>
                    )}

                    {deployResult && (
                        <div className="rounded-xl border border-border bg-muted/30 p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle2 className="size-4 text-emerald-500" />
                                <p className="text-sm font-medium text-foreground">
                                    Deployed v{deployResult.deployment.version}
                                </p>
                                <Badge
                                    variant="secondary"
                                    className="ml-auto text-xs"
                                >
                                    {deployResult.deployment.source}
                                </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <p>
                                    Files deployed:{" "}
                                    {deployResult.summary.deployedFiles}
                                </p>
                                <p>
                                    Total size:{" "}
                                    {deployResult.summary.totalSizeHuman}
                                </p>
                                <p>
                                    Compressed:{" "}
                                    {deployResult.summary.filesCompressed}
                                </p>
                                <p>
                                    Size reduced:{" "}
                                    {deployResult.summary.sizeReducedPercent}%
                                </p>
                                <p>
                                    Images optimized:{" "}
                                    {deployResult.summary.imagesOptimized}
                                </p>
                                <p>
                                    WebP variants:{" "}
                                    {deployResult.summary.webpVariants}
                                </p>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Deployment history */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Deployment History
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Roll back to any previous deployment
                            </CardDescription>
                        </div>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 shrink-0"
                            onClick={loadDeployments}
                        >
                            <RefreshCw className="size-3.5" />
                            Refresh
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {deploymentsLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        </div>
                    ) : deployments.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No deployments yet.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {deployments.map((deployment) => (
                                <div
                                    key={deployment.id}
                                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                                >
                                    <div
                                        className={`size-2 rounded-full shrink-0 ${deployment.is_active ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-foreground">
                                                v{deployment.version}
                                            </p>
                                            <Badge
                                                variant={
                                                    deployment.is_active
                                                        ? "default"
                                                        : "outline"
                                                }
                                                className="text-xs"
                                            >
                                                {deployment.is_active
                                                    ? "Live"
                                                    : deployment.source}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {deployment.file_count} files ·{" "}
                                            {deployment.filesDeployed ?? 0}{" "}
                                            deployed /{" "}
                                            {deployment.filesReused ?? 0} reused
                                            ·{" "}
                                            {formatRelativeTime(
                                                deployment.created_at,
                                            )}
                                        </p>
                                    </div>
                                    {!deployment.is_active && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="shrink-0 gap-1.5"
                                            onClick={() =>
                                                handleRollback(deployment)
                                            }
                                            disabled={
                                                rollingBack === deployment.id
                                            }
                                        >
                                            {rollingBack === deployment.id ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : (
                                                <RotateCcw className="size-3.5" />
                                            )}
                                            Rollback
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

const buildStatusConfig: Record<
    ApiBuild["status"],
    {
        label: string;
        variant: "default" | "secondary" | "destructive" | "outline";
    }
> = {
    queued: { label: "Queued", variant: "secondary" },
    active: { label: "Building", variant: "secondary" },
    completed: { label: "Completed", variant: "default" },
    failed: { label: "Failed", variant: "destructive" },
};

function parseEnvVars(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

function BuildsTab({ project }: { project: Project }) {
    const [builds, setBuilds] = useState<ApiBuild[]>([]);
    const [loading, setLoading] = useState(true);
    const [showTrigger, setShowTrigger] = useState(false);
    const [isTriggering, setIsTriggering] = useState(false);
    const [error, setError] = useState("");

    const [repoUrl, setRepoUrl] = useState("");
    const [gitToken, setGitToken] = useState("");
    const [framework, setFramework] = useState("vite");
    const [buildCommand, setBuildCommand] = useState("pnpm build");
    const [outputDir, setOutputDir] = useState("dist");
    const [envVarsText, setEnvVarsText] = useState("");

    const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    const [logDone, setLogDone] = useState(false);
    const logBoxRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    const loadBuilds = useCallback(async () => {
        try {
            const list = await apiClient.getBuilds(project.id);
            setBuilds(list);
        } catch (loadError) {
            toast.error(
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to load builds",
            );
        } finally {
            setLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadBuilds();
    }, [loadBuilds]);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    useEffect(() => {
        logBoxRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const startLogs = useCallback(
        async (buildId: string) => {
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setActiveBuildId(buildId);
            setLogs([]);
            setProgress(0);
            setLogDone(false);

            try {
                const done = await apiClient.streamBuildLogs(
                    buildId,
                    {
                        onLog: (message) =>
                            setLogs((prev) => [...prev, message]),
                        onProgress: (value) => setProgress(value),
                        onStatus: () => {
                            /* status is implied by build rows */
                        },
                        onDone: (event: BuildDoneEvent) => {
                            setLogDone(true);
                            if (event.error) {
                                setLogs((prev) => [
                                    ...prev,
                                    `[error] ${event.error}`,
                                ]);
                            }
                            loadBuilds();
                        },
                        onError: (event) => {
                            setLogDone(true);
                            setLogs((prev) => [
                                ...prev,
                                `[error] ${event.message}`,
                            ]);
                        },
                    },
                    controller.signal,
                );

                if (done) {
                    setLogDone(true);
                }
            } catch {
                setLogDone(true);
                setLogs((prev) => [
                    ...prev,
                    "[error] Failed to connect to build log stream",
                ]);
            }
        },
        [loadBuilds],
    );

    const resetForm = () => {
        setRepoUrl("");
        setGitToken("");
        setFramework("vite");
        setBuildCommand("pnpm build");
        setOutputDir("dist");
        setEnvVarsText("");
        setError("");
    };

    const handleTrigger = async () => {
        const url = repoUrl.trim();
        if (!url) {
            setError("Enter a GitHub repository URL");
            return;
        }
        if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url)) {
            setError("Enter a valid public GitHub repository URL");
            return;
        }
        setIsTriggering(true);
        setError("");
        try {
            const envVars = parseEnvVars(envVarsText);
            const build = await apiClient.triggerBuild({
                pageId: project.id,
                repoUrl: url,
                gitProvider: "github",
                ...(gitToken.trim() ? { gitToken: gitToken.trim() } : {}),
                framework: framework.trim() || "vite",
                ...(buildCommand.trim()
                    ? { buildCommand: buildCommand.trim() }
                    : {}),
                ...(outputDir.trim() ? { outputDir: outputDir.trim() } : {}),
                ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
            });
            toast.success("Build queued");
            setShowTrigger(false);
            resetForm();
            loadBuilds();
            startLogs(build.id);
        } catch (triggerError) {
            const message =
                triggerError instanceof Error
                    ? triggerError.message
                    : "Failed to trigger build";
            setError(message);
            toast.error(message);
        } finally {
            setIsTriggering(false);
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Cloud Builds
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Build your git repository and deploy the output
                                to production
                            </CardDescription>
                        </div>
                        {!showTrigger && (
                            <Button
                                size="sm"
                                className="gap-2 shrink-0"
                                onClick={() => setShowTrigger(true)}
                            >
                                <Plus className="size-3.5" />
                                New Build
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {showTrigger && (
                        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-foreground">
                                    Trigger a build
                                </p>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => {
                                        setShowTrigger(false);
                                        setError("");
                                    }}
                                >
                                    <X className="size-3.5" />
                                </Button>
                            </div>

                            <div className="flex items-center gap-2">
                                <GithubIcon className="size-5 shrink-0 text-muted-foreground" />
                                <div className="relative flex-1">
                                    <Input
                                        id="build-repo"
                                        placeholder="https://github.com/user/repo"
                                        value={repoUrl}
                                        onChange={(e) => {
                                            setRepoUrl(e.target.value);
                                            setError("");
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                                handleTrigger();
                                        }}
                                        className="h-10 pr-24 font-mono text-sm"
                                    />
                                    <Button
                                        size="sm"
                                        className="absolute right-1 top-1/2 h-8 -translate-y-1/2 gap-1.5 px-3"
                                        onClick={handleTrigger}
                                        disabled={isTriggering}
                                    >
                                        {isTriggering ? (
                                            <Loader2 className="size-3.5 animate-spin" />
                                        ) : (
                                            <Play className="size-3.5" />
                                        )}
                                        Build
                                    </Button>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Deploy a public GitHub repository. Paste a repo
                                URL and click Build — the output will be
                                deployed automatically.
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="build-framework">
                                        Framework
                                    </Label>
                                    <Input
                                        id="build-framework"
                                        placeholder="vite"
                                        value={framework}
                                        onChange={(e) =>
                                            setFramework(e.target.value)
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="build-command">
                                        Build command
                                    </Label>
                                    <Input
                                        id="build-command"
                                        placeholder="pnpm build"
                                        value={buildCommand}
                                        onChange={(e) =>
                                            setBuildCommand(e.target.value)
                                        }
                                        className="font-mono text-xs"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="build-output">
                                        Output directory
                                    </Label>
                                    <Input
                                        id="build-output"
                                        placeholder="dist"
                                        value={outputDir}
                                        onChange={(e) =>
                                            setOutputDir(e.target.value)
                                        }
                                        className="font-mono text-xs"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="build-token">
                                    Git token (for private repos)
                                </Label>
                                <Input
                                    id="build-token"
                                    type="password"
                                    placeholder="ghp_…"
                                    value={gitToken}
                                    onChange={(e) =>
                                        setGitToken(e.target.value)
                                    }
                                    className="font-mono text-xs"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="build-env">
                                    Environment variables (KEY=VALUE per line)
                                </Label>
                                <Textarea
                                    id="build-env"
                                    rows={3}
                                    placeholder={
                                        "VITE_API_URL=https://api.example.com\nNODE_ENV=production"
                                    }
                                    value={envVarsText}
                                    onChange={(e) =>
                                        setEnvVarsText(e.target.value)
                                    }
                                    className="font-mono text-xs"
                                />
                            </div>

                            {error && (
                                <p className="text-xs text-destructive">
                                    {error}
                                </p>
                            )}

                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setShowTrigger(false);
                                        setError("");
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        </div>
                    ) : builds.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No builds yet. Trigger a cloud build from your git
                            repository.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {builds.map((build) => {
                                const config =
                                    buildStatusConfig[build.status] ??
                                    buildStatusConfig.queued;
                                const isActive = activeBuildId === build.id;
                                return (
                                    <div
                                        key={build.id}
                                        className="rounded-lg border border-border p-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                                                {build.status === "active" ? (
                                                    <Loader2 className="size-4 animate-spin text-blue-500" />
                                                ) : build.status ===
                                                  "completed" ? (
                                                    <CheckCircle2 className="size-4 text-emerald-500" />
                                                ) : build.status ===
                                                  "failed" ? (
                                                    <AlertCircle className="size-4 text-destructive" />
                                                ) : (
                                                    <Clock className="size-4 text-muted-foreground" />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate text-sm font-medium text-foreground">
                                                        {build.framework}
                                                    </span>
                                                    <Badge
                                                        variant={config.variant}
                                                        className="text-xs"
                                                    >
                                                        {config.label}
                                                    </Badge>
                                                </div>
                                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                    {build.repo_url} ·{" "}
                                                    {build.build_command ??
                                                        "pnpm build"}
                                                </p>
                                            </div>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {formatRelativeTime(
                                                    build.created_at,
                                                )}
                                            </span>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="shrink-0 gap-1.5"
                                                onClick={() =>
                                                    isActive
                                                        ? abortRef.current?.abort()
                                                        : startLogs(build.id)
                                                }
                                            >
                                                <Terminal className="size-3.5" />
                                                {isActive ? "Stop" : "Logs"}
                                            </Button>
                                        </div>

                                        {isActive && (
                                            <div className="mt-3">
                                                {progress > 0 && (
                                                    <Progress
                                                        value={progress}
                                                        className="h-1.5 mb-2"
                                                    />
                                                )}
                                                <div className="overflow-hidden rounded-lg border border-[#2d3139] bg-[#0d1117] font-mono text-xs text-slate-300">
                                                    <div className="h-56 space-y-1 overflow-y-auto p-3">
                                                        {logs.length === 0 ? (
                                                            <p className="text-slate-500">
                                                                Waiting for log
                                                                output…
                                                            </p>
                                                        ) : (
                                                            logs.map(
                                                                (line, i) => (
                                                                    <p
                                                                        key={`${i}-${line}`}
                                                                        className="text-slate-400"
                                                                    >
                                                                        {line}
                                                                    </p>
                                                                ),
                                                            )
                                                        )}
                                                        {!logDone && (
                                                            <span className="inline-block h-3 w-1.5 animate-pulse bg-slate-300" />
                                                        )}
                                                        <div ref={logBoxRef} />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function AnalyticsTab() {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
                {[
                    {
                        label: "Page Views",
                        value: "12,450",
                        change: "+12%",
                        icon: Activity,
                    },
                    {
                        label: "Unique Visitors",
                        value: "3,280",
                        change: "+8%",
                        icon: BarChart3,
                    },
                    {
                        label: "Avg. Response",
                        value: "145ms",
                        change: "-3ms",
                        icon: Zap,
                    },
                ].map(({ label, value, change, icon: Icon }) => (
                    <Card key={label}>
                        <CardContent className="p-4">
                            <Icon className="size-4 text-muted-foreground mb-2" />
                            <p className="text-2xl font-bold text-foreground">
                                {value}
                            </p>
                            <p className="text-sm text-muted-foreground">
                                {label}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1 font-medium">
                                {change} this week
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Traffic Overview</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-32 flex items-end gap-2">
                        {[
                            40, 65, 35, 80, 55, 90, 70, 45, 85, 60, 75, 95, 50,
                            88,
                        ].map((h, i) => (
                            <div
                                key={i}
                                className="flex-1 rounded-sm bg-foreground/70"
                                style={{ height: `${h}%` }}
                            />
                        ))}
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                        <span>14 days ago</span>
                        <span>Today</span>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function UsageTab() {
    return (
        <div className="space-y-4">
            {[
                {
                    label: "Bandwidth",
                    used: 45.2,
                    limit: 100,
                    unit: "GB",
                    icon: Activity,
                },
                {
                    label: "Build Minutes",
                    used: 320,
                    limit: 500,
                    unit: "min",
                    icon: Cpu,
                },
                {
                    label: "Storage",
                    used: 2.4,
                    limit: 10,
                    unit: "GB",
                    icon: HardDrive,
                },
                {
                    label: "Function Calls",
                    used: 12500,
                    limit: 100000,
                    unit: "calls",
                    icon: Zap,
                },
            ].map(({ label, used, limit, unit, icon: Icon }) => (
                <Card key={label}>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Icon className="size-4 text-muted-foreground" />
                                <span className="text-sm font-medium text-foreground">
                                    {label}
                                </span>
                            </div>
                            <span className="text-sm text-muted-foreground font-medium">
                                {used.toLocaleString()} /{" "}
                                {limit.toLocaleString()} {unit}
                            </span>
                        </div>
                        <Progress
                            value={(used / limit) * 100}
                            className="h-2"
                        />
                        <p className="text-sm text-muted-foreground mt-1.5">
                            {((used / limit) * 100).toFixed(1)}% used
                        </p>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function SettingsTab({ project }: { project: Project }) {
    const { deleteProject } = useAppStore();
    const router = useRouter();
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            await deleteProject(project.id);
            toast.success("Project deleted");
            router.push("/projects");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to delete project",
            );
            setIsDeleting(false);
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Project Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Project Name</Label>
                        <Input defaultValue={project.name} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Description</Label>
                        <Input
                            defaultValue={project.description || ""}
                            placeholder="Project description"
                        />
                    </div>
                    <Button>Save Changes</Button>
                </CardContent>
            </Card>

            <Card className="border-destructive/40">
                <CardHeader>
                    <CardTitle className="text-sm text-destructive">
                        Danger Zone
                    </CardTitle>
                    <CardDescription className="text-xs">
                        These actions are irreversible
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between p-4 rounded-xl border border-destructive/30 bg-destructive/5">
                        <div>
                            <p className="text-sm font-medium text-foreground">
                                Delete this project
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                This will permanently delete the project and all
                                its data
                            </p>
                        </div>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={isDeleting}
                                >
                                    {isDeleting ? (
                                        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                                    ) : (
                                        <Trash2 className="size-3.5 mr-1.5" />
                                    )}
                                    Delete
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>
                                        Delete {project.name}?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will permanently delete the
                                        project, its deployments, and all
                                        associated data. This action cannot be
                                        undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>
                                        Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                        className="bg-destructive text-white hover:bg-destructive/90"
                                        onClick={handleDelete}
                                    >
                                        Delete project
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export function ProjectDetailView({ projectId }: { projectId: string }) {
    const router = useRouter();
    const project = useAppStore((s) =>
        s.projects.find((p) => p.id === projectId),
    );
    const isLoading = useAppStore((s) => s.isLoading);
    const fetchProjects = useAppStore((s) => s.fetchProjects);
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (!project && !fetchedRef.current) {
            fetchedRef.current = true;
            fetchProjects();
        }
    }, [project, fetchProjects]);

    if (!project) {
        if (isLoading || !fetchedRef.current) {
            return (
                <div className="flex h-svh items-center justify-center bg-background">
                    <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                </div>
            );
        }
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <AlertCircle className="size-12 text-muted-foreground/40 mb-4" />
                <h2 className="text-lg font-semibold text-foreground mb-2">
                    Project not found
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                    This project doesn't exist or you don't have access to it.
                </p>
                <Button onClick={() => router.push("/projects")}>
                    <ArrowLeft className="size-4 mr-2" />
                    Back to Projects
                </Button>
            </div>
        );
    }

    const status = statusConfig[project.status];
    const StatusIcon = status.icon;

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => router.push("/projects")}
                    className="size-9"
                >
                    <ArrowLeft className="size-4" />
                </Button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-foreground truncate">
                            {project.name}
                        </h1>
                        <div className="flex items-center gap-1.5">
                            <StatusIcon
                                className={`size-4 ${status.color} ${project.status === "building" ? "animate-spin" : ""}`}
                            />
                            <Badge
                                variant={status.badgeVariant}
                                className="text-xs"
                            >
                                {status.label}
                            </Badge>
                        </div>
                    </div>
                    {project.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">
                            {project.description}
                        </p>
                    )}
                </div>
                {project.domain && (
                    <a
                        href={`https://${project.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg px-3 py-2"
                    >
                        <ExternalLink className="size-3.5" />
                        {project.domain}
                    </a>
                )}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="overview" className="space-y-4">
                <div className="-mx-6 px-6 overflow-x-auto scrollbar-none overscroll-x-contain touch-pan-x">
                    <TabsList className="h-9 w-max min-w-full sm:min-w-0 p-1 bg-muted/50 border border-border justify-start">
                        {[
                            { value: "overview", label: "Overview" },
                            { value: "domains", label: "Domains" },
                            { value: "deploys", label: "Deploys" },
                            { value: "builds", label: "Builds" },
                            { value: "files", label: "Files" },
                            { value: "environment", label: "Environment" },
                            { value: "analytics", label: "Analytics" },
                            { value: "usage", label: "Usage" },
                            { value: "settings", label: "Settings" },
                        ].map(({ value, label }) => (
                            <TabsTrigger
                                key={value}
                                value={value}
                                className="text-xs h-7 px-3 shrink-0 snap-start"
                            >
                                {label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                <TabsContent value="overview">
                    <OverviewTab project={project} />
                </TabsContent>
                <TabsContent value="domains">
                    <DomainsTab />
                </TabsContent>
                <TabsContent value="deploys">
                    <DeployTab project={project} />
                </TabsContent>
                <TabsContent value="builds">
                    <BuildsTab project={project} />
                </TabsContent>
                <TabsContent value="files">
                    <FilesTab />
                </TabsContent>
                <TabsContent value="environment">
                    <EnvTab />
                </TabsContent>
                <TabsContent value="analytics">
                    <AnalyticsTab />
                </TabsContent>
                <TabsContent value="usage">
                    <UsageTab />
                </TabsContent>
                <TabsContent value="settings">
                    <SettingsTab project={project} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
