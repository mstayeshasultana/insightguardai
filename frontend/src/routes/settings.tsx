import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Moon, PlugZap, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Surface } from "@/components/app/shared";
import { useTheme } from "@/components/app/theme";
import { api, API_BASE_URL, describeApiError, isHealthy, isLiveEndpoint } from "@/services/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — InsightGuard AI" },
      { name: "description", content: "API connection status, appearance and app information." },
      { property: "og:title", content: "Settings — InsightGuard AI" },
      { property: "og:description", content: "API connection status, appearance and app information." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

type TestResult = { ok: boolean; message: string };

function SettingsPage() {
  const { theme, toggle } = useTheme();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const backend = health.data?.data;

  const state = !isLiveEndpoint("/health")
    ? { label: "Demo mode — no backend configured", dot: "bg-warning" }
    : health.isLoading
      ? { label: "Checking…", dot: "bg-muted-foreground" }
      : health.isError || !isHealthy(backend)
        ? { label: "Not connected", dot: "bg-destructive" }
        : { label: "Connected", dot: "bg-success" };

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.health();
      if (isHealthy(res.data)) {
        const service = res.data.service ?? "Backend";
        const version = res.data.version ?? "unknown version";
        setTestResult({ ok: true, message: `Connected — ${service} v${version}` });
      } else {
        setTestResult({
          ok: false,
          message: `The backend answered, but reported status "${backend?.status ?? "unknown"}".`,
        });
      }
      void health.refetch();
    } catch (error) {
      setTestResult({ ok: false, message: describeApiError(error) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <Surface>
        <h2 className="mb-3 font-semibold text-foreground">API connection</h2>
        <div className="flex items-center gap-2.5 text-sm">
          <span className={cn("h-2.5 w-2.5 rounded-full", state.dot)} />
          <span className="text-foreground">{state.label}</span>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
          {API_BASE_URL ?? "Set VITE_API_BASE_URL to connect your backend"}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 gap-1.5"
          onClick={testConnection}
          disabled={testing}
        >
          {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
          {testing ? "Testing…" : "Test Connection"}
        </Button>
        {testResult && (
          <p
            role="status"
            className={cn(
              "mt-3 text-sm",
              testResult.ok ? "text-success" : "text-destructive",
            )}
          >
            {testResult.message}
          </p>
        )}
      </Surface>
      <Surface className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Moon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">Dark mode</span>
        </div>
        <Switch checked={theme === "dark"} onCheckedChange={toggle} />
      </Surface>
      <Surface>
        <h2 className="mb-2 font-semibold text-foreground">About</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">App</dt><dd className="text-foreground">InsightGuard AI</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Version</dt><dd className="text-foreground">0.1.0</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Backend service</dt><dd className="text-foreground">{backend?.service ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Backend version</dt><dd className="text-foreground">{backend?.version ?? "—"}</dd></div>
        </dl>
      </Surface>
    </div>
  );
}
