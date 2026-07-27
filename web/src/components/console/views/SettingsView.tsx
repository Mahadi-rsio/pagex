"use client";

import { useAppStore } from "@/store/useAppStore";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import toast from "react-hot-toast";

export function SettingsView() {
    const { user } = useAppStore();

    if (!user) return null;

    return (
        <div className="p-6 space-y-6 max-w-4xl">
            <div>
                <h1 className="text-xl font-bold text-foreground">
                    Account Settings
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Manage your account profile and preferences.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        Profile Information
                    </CardTitle>
                    <CardDescription>
                        Update your account details and profile picture.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                        <Avatar className="size-16">
                            <AvatarImage src={user.avatarUrl} alt={user.name} />
                            <AvatarFallback className="text-lg font-bold">
                                {getInitials(user.name)}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="text-sm font-medium text-foreground">
                                {user.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {user.email}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="name">Full Name</Label>
                            <Input id="name" defaultValue={user.name} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="email">Email Address</Label>
                            <Input
                                id="email"
                                defaultValue={user.email}
                                disabled
                                className="bg-muted/50"
                            />
                        </div>
                    </div>

                    <Button
                        onClick={() =>
                            toast.success("Settings saved successfully")
                        }
                    >
                        Save Changes
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
