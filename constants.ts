// Shared between server and client.
export const TAGS = [
  "Hypothesis",
  "Aim",
  "Independent variable",
  "Dependent variable",
  "Control variable",
  "Assumption",
  "Control",
  "Observation",
  "Reasoning",
  "Evidence",
  "Limitation",
  "Improvement",
] as const;
export type Tag = (typeof TAGS)[number];

export const PART_TITLES: Record<number, string> = {
  1: "Part 1: Designing the Investigation",
  2: "Part 2: Enacting the Investigation",
  3: "Part 3: Reflecting on the Investigation",
};

export const DEFAULT_CRITIQUE_PROMPTS = [
  { key: "alt_explanation", label: "Propose an alternative explanation", enabled: true },
  { key: "confounding", label: "Identify a confounding variable", enabled: true },
  { key: "clarify", label: "Ask a clarifying question", enabled: true },
  { key: "evidence_gap", label: "Point out a gap between the evidence and the claim", enabled: false },
  { key: "improve", label: "Suggest an improvement to the method", enabled: false },
];

export type PartVisibility = "hidden" | "visible" | "open";

export const LIMITS = {
  bodyMax: 4000,
  imageMaxBytes: 3 * 1024 * 1024,
  tableMaxRows: 30,
  tableMaxCols: 8,
  cellMax: 80,
  nameMax: 60,
  classMax: 20,
  critiqueMax: 1000,
};

export const ONLINE_WINDOW_MS = 15000;
