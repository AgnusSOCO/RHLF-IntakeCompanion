/**
 * Standard personal-injury intake fields. The pipeline periodically asks the
 * LLM which of these the call has covered; the UI renders them as a glanceable
 * checklist so the agent knows what still needs collecting before wrap-up.
 */
export const INTAKE_CHECKLIST = [
  { id: "caller_identity", label: "Name & contact" },
  { id: "incident_type", label: "Incident type" },
  { id: "incident_date", label: "When" },
  { id: "location", label: "Where" },
  { id: "how_it_happened", label: "How / fault" },
  { id: "injuries", label: "Injuries" },
  { id: "medical", label: "Medical care" },
  { id: "police_report", label: "Report filed" },
  { id: "insurance", label: "Insurance" },
  { id: "representation", label: "Other attorney" },
  { id: "employment", label: "Employer" },
] as const;

export type ChecklistItemId = (typeof INTAKE_CHECKLIST)[number]["id"];

export interface ChecklistItem {
  id: ChecklistItemId;
  label: string;
  covered: boolean;
  detail?: string;
}
