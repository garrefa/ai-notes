import { ToneChip } from "@/components/pr-hints"
import { agentStatusInfo, type AgentStatus } from "@/lib/agents"

// An agent's status. "Needs you" gets the animated treatment (see .needs-you-* in index.css);
// the rest use the same quiet tone chips as the PR views.
export function AgentStatusChip({ status }: { status: AgentStatus }) {
  const info = agentStatusInfo(status)
  if (status === "waiting") {
    return (
      <span className="needs-you-chip">
        <span className="needs-you-dot" aria-hidden="true" />
        {info.label}
      </span>
    )
  }
  return <ToneChip tone={info.tone}>{info.label}</ToneChip>
}
