import { Pause, Play } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import type { ConnStatus } from "../lib/useAssistant";

const CONN: Record<ConnStatus, { dot: string; label: string }> = {
  online: { dot: "bg-emerald-500", label: "Connected" },
  connecting: { dot: "bg-amber-500 animate-pulse", label: "Connecting…" },
  offline: { dot: "bg-red-500", label: "Offline" },
};

export function Header({
  conn,
  extensionId,
  paused,
  callActive,
  onPause,
}: {
  conn: ConnStatus;
  extensionId: string | null;
  paused: boolean;
  callActive: boolean;
  onPause: (v: boolean) => void;
}) {
  const c = CONN[conn];
  return (
    <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-600 text-[11px] font-extrabold tracking-tight text-white">
        RH
      </div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-semibold text-zinc-900">
          Intake Assistant
        </div>
        <div className="truncate text-[11px] text-zinc-500">
          Richard Harris Law Firm
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
          <span>
            {conn === "online" && extensionId ? `Ext ${extensionId}` : c.label}
          </span>
        </div>
        <Button
          variant={paused ? "danger" : "outline"}
          size="sm"
          disabled={!callActive && !paused}
          onClick={() => onPause(!paused)}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
    </header>
  );
}
