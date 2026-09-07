"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import type { Project } from "@/store/useAppStore";
import { Spinner } from "@/components/ui/spinner";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
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
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

export function SettingsTab({ project }: { project: Project }) {
    const { deleteProject } = useAppStore();
    const router = useRouter();
    const [isDeleting, setIsDeleting] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [confirmName, setConfirmName] = useState("");

    const nameMatches = confirmName === project.name;

    const handleDrawerOpenChange = (open: boolean) => {
        setDrawerOpen(open);
        if (!open) setConfirmName("");
    };

    const handleDelete = async () => {
        if (!nameMatches || isDeleting) return;
        setIsDeleting(true);
        try {
            await deleteProject(project.id);
            toast.success("Project deleted");
            handleDrawerOpenChange(false);
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

            <Card className="border-destructive">
                <CardHeader>
                    <CardTitle className="text-sm text-destructive">
                        Danger Zone
                    </CardTitle>
                    <CardDescription className="text-xs">
                        These actions are irreversible
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between rounded-none border border-destructive p-4">
                        <div>
                            <p className="text-sm font-medium text-foreground">
                                Delete this project
                            </p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                This will permanently delete the project and all
                                its data
                            </p>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={isDeleting}
                            onClick={() => setDrawerOpen(true)}
                        >
                            {isDeleting ? (
                                <Spinner size="inline" className="mr-1.5" />
                            ) : (
                                <Trash2 className="mr-1.5 size-3.5" />
                            )}
                            Delete
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Sheet open={drawerOpen} onOpenChange={handleDrawerOpenChange}>
                <SheetContent
                    side="bottom"
                    className="mx-auto max-h-[85vh] max-w-lg gap-0 overflow-y-auto rounded-none border border-border p-0"
                >
                    <SheetHeader className="border-b border-border p-4">
                        <SheetTitle>Delete {project.name}?</SheetTitle>
                        <SheetDescription>
                            This will permanently delete the project, its
                            deployments, and all associated data. This action
                            cannot be undone.
                        </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-3 p-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="confirm-project-name">
                                Type{" "}
                                <span className="font-medium text-foreground">
                                    {project.name}
                                </span>{" "}
                                to confirm
                            </Label>
                            <Input
                                id="confirm-project-name"
                                value={confirmName}
                                onChange={(e) => setConfirmName(e.target.value)}
                                placeholder={project.name}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleDelete();
                                }}
                            />
                        </div>
                    </div>

                    <SheetFooter className="border-t border-border p-4 sm:flex-row">
                        <Button
                            variant="ghost"
                            onClick={() => handleDrawerOpenChange(false)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={!nameMatches || isDeleting}
                            onClick={handleDelete}
                        >
                            {isDeleting ? (
                                <Spinner size="inline" className="mr-1.5" />
                            ) : null}
                            Delete project
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </div>
    );
}
