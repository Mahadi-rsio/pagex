"use client";

import { AuthGuard } from "@/components/console/AuthGuard";
import DeviceAuthorizationPage from "./DeviceAuth";

export default function DevicePage() {
    return (
        <AuthGuard>
            <DeviceAuthorizationPage />
        </AuthGuard>
    );
}
