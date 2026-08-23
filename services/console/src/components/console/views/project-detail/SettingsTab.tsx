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
import { toast } from "sonner";
import {
    Trash2,
} from "lucide-react";

export function SettingsTab({ project }: { project: Project }) {
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
                    <div className="flex items-center justify-between p-4 rounded-none border border-destructive/30 bg-destructive/5">
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
                                        <Spinner size="inline" className="mr-1.5" />
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

