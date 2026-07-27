import { create } from "zustand";
import { AxiosError } from "axios";

export interface ApiRequestLog {
    id: string;
    method: string;
    url: string;
    status?: number;
    timestamp: string;
    type: "request" | "success" | "error";
    message?: string;
}

interface ApiStore {
    apiError: AxiosError | Error | null;
    requestLogs: ApiRequestLog[];
    setApiError: (error: AxiosError | Error | null) => void;
    clearApiError: () => void;
    addLog: (log: Omit<ApiRequestLog, "id" | "timestamp">) => void;
    clearLogs: () => void;
}

export const useApiStore = create<ApiStore>((set) => ({
    apiError: null,
    requestLogs: [],
    setApiError: (error) => set({ apiError: error }),
    clearApiError: () => set({ apiError: null }),
    addLog: (log) =>
        set((state) => ({
            requestLogs: [
                {
                    ...log,
                    id: Math.random().toString(36).substring(2, 9),
                    timestamp: new Date().toLocaleTimeString(),
                },
                ...state.requestLogs.slice(0, 49),
            ],
        })),
    clearLogs: () => set({ requestLogs: [] }),
}));
