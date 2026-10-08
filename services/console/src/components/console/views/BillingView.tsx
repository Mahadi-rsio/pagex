"use client";

import { Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { useAppStore } from "@/store/useAppStore";

export function BillingView() {
    const { balance } = useAppStore();

    return (
        <div className="p-6 space-y-6 max-w-4xl">
            <div>
                <h1 className="text-xl font-bold text-foreground">
                    Billing & Usage
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Manage your account balance and billing details.
                </p>
            </div>

            <Card>
                <CardContent className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="size-10 rounded-none bg-muted flex items-center justify-center">
                            <Wallet className="size-5 text-foreground" />
                        </div>
                        <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={() =>
                                toast.success("Add funds feature coming soon")
                            }
                        >
                            <Plus className="size-4" /> Add Funds
                        </Button>
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground">
                            Available Credits
                        </p>
                        <p className="text-3xl font-bold text-foreground mt-1">
                            ${balance.toFixed(2)}
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Invoices</CardTitle>
                    <CardDescription>
                        Recent billing history and receipts.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground py-6 text-center">
                        No invoices yet.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
