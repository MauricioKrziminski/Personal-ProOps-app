import { CheckCircle2, CircleDot, EyeOff } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { ISSUE_SEVERITY_LABEL, ISSUE_SOURCE_LABEL, ISSUE_STATUS_LABEL } from "@/lib/labels";
import type { IssueSeverity, IssueStatus } from "@/lib/types";

const SEV: Record<IssueSeverity, { tone: Tone; color: string }> = {
  critical: { tone: "danger", color: "var(--chart-5)" },
  error: { tone: "warning", color: "var(--chart-4)" },
  warning: { tone: "neutral", color: "var(--chart-2)" },
};
export const severityColor = (s: IssueSeverity) => SEV[s].color;

export const SeverityBadge = ({ s }: { s: IssueSeverity }) => (
  <Badge tone={SEV[s].tone}><span className="size-1.5 rounded-full" style={{ background: SEV[s].color }} />{ISSUE_SEVERITY_LABEL[s]}</Badge>
);

export const IssueStatusBadge = ({ s }: { s: IssueStatus }) =>
  s === "open" ? <Badge tone="ink"><CircleDot />{ISSUE_STATUS_LABEL[s]}</Badge>
    : s === "resolved" ? <Badge tone="success"><CheckCircle2 />{ISSUE_STATUS_LABEL[s]}</Badge>
      : <Badge><EyeOff />{ISSUE_STATUS_LABEL[s]}</Badge>;

export const SourceBadge = ({ s }: { s: string }) => <Badge tone="neutral" className="bg-transparent">{ISSUE_SOURCE_LABEL[s] ?? s}</Badge>;
