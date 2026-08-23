"use client";

import { useState } from "react";
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
    Plus,
    Trash2,
    Copy,
    Eye,
    EyeOff,
} from "lucide-react";

export function EnvTab() {
    type EnvVar = {
        id: string;
        key: string;
        value: string;
        environment: "All" | "Production" | "Preview" | "Development";
    };

    const [envVars, setEnvVars] = useState<EnvVar[]>([]);
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
                        <div className="space-y-3 border border-border p-3 bg-muted/20 rounded-none">
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
                                        className="h-9 w-full rounded-none border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                                    className="flex items-center gap-3 p-3 border border-border rounded-none"
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

