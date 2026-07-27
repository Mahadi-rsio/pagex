"use client";

import { useAppStore } from "@/store/useAppStore";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, Wallet, Plus, ArrowUpRight } from "lucide-react";
import toast from "react-hot-toast";

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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <CardContent className="p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                                <Wallet className="size-5 text-foreground" />
                            </div>
                            <Button
                                size="sm"
                                className="gap-1.5"
                                onClick={() =>
                                    toast.success(
                                        "Add funds feature coming soon",
                                    )
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
                    <CardContent className="p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                                <CreditCard className="size-5 text-foreground" />
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    toast.success(
                                        "Payment method update coming soon",
                                    )
                                }
                            >
                                Update
                            </Button>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">
                                Default Payment Method
                            </p>
                            <p className="text-base font-semibold text-foreground mt-1">
                                Visa ending in •••• 4242
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Invoices</CardTitle>
                    <CardDescription>
                        Recent billing history and receipts.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {[
                            {
                                id: "INV-2026-001",
                                date: "Jul 1, 2026",
                                amount: "$15.00",
                                status: "Paid",
                            },
                            {
                                id: "INV-2026-002",
                                date: "Jun 1, 2026",
                                amount: "$15.00",
                                status: "Paid",
                            },
                        ].map((invoice) => (
                            <div
                                key={invoice.id}
                                className="flex items-center justify-between p-3 rounded-lg border border-border"
                            >
                                <div>
                                    <p className="text-sm font-medium text-foreground">
                                        {invoice.id}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {invoice.date}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold">
                                        {invoice.amount}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                    >
                                        <ArrowUpRight className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
