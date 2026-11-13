import type { TableData } from "@/components/ui";

export interface PartCfg {
  part: number;
  instructions: string;
  webLink: string;
  visibility: "hidden" | "visible" | "open";
  questions: { id: number; text: string }[];
}
export interface SessionDetail {
  id: number;
  title: string;
  joinCode: string;
  status: "active" | "archived";
  anonymiseSharing: boolean;
  critiquePrompts: { key: string; label: string; enabled: boolean }[];
  aiCriteria: string;
  pedagogyNotes: string;
  source: { templateId: number; title: string; importedVersion: number; currentVersion: number | null } | null;
  parts: PartCfg[];
  groups: { id: number; name: string; pin: string; seatCap: number | null; members: number }[];
}
export interface TEntry {
  id: number;
  part: number;
  groupId: number;
  groupName: string;
  author: { name: string; class: string; classNo: string };
  tag: string | null;
  body: string;
  hasImage: boolean;
  table: TableData | null;
  createdAt: number;
  updatedAt: number;
  shared: boolean;
}
export interface StatusResp {
  status: string;
  parts: { part: number; title: string; visibility: "hidden" | "visible" | "open" }[];
  groups: {
    id: number;
    name: string;
    members: { id: number; name: string; class: string; classNo: string; online: boolean }[];
    parts: { part: number; submission: { status: "draft" | "submitted" | "revising"; revision: number; submittedAt: number | null }; entryCount: number; editing: number }[];
  }[];
  summary: { part: number; activeGroups: number; submitted: number; missing: string[] }[];
  recovery: { id: number; name: string; class: string; classNo: string; group: string; createdAt: number }[];
  overrides: { part: number; reason: string; at: number; missing: { name: string }[] }[];
}
