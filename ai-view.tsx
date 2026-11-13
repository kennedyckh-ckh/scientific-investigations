"use client";

export interface AiItem {
  text: string;
  cites: number[];
}
export interface AiSection {
  kind: string;
  heading: string;
  items: AiItem[];
}
export interface AiContent {
  title: string;
  sections: AiSection[];
  note?: string;
}

const KIND_STYLE: Record<string, { bar: string; chip: string; label: string }> = {
  summary: { bar: "border-blue-400", chip: "bg-blue-100 text-blue-800", label: "Summary" },
  disagreement: { bar: "border-rose-400", chip: "bg-rose-100 text-rose-800", label: "Disagreement" },
  divergent: { bar: "border-amber-400", chip: "bg-amber-100 text-amber-800", label: "Divergent findings" },
  uncontrolled: { bar: "border-orange-400", chip: "bg-orange-100 text-orange-800", label: "Uncontrolled variables" },
  gap: { bar: "border-fuchsia-400", chip: "bg-fuchsia-100 text-fuchsia-800", label: "Evidence-to-claim gap" },
  misconception: { bar: "border-teal-400", chip: "bg-teal-100 text-teal-800", label: "Possible misconception" },
  question: { bar: "border-violet-500", chip: "bg-violet-100 text-violet-800", label: "Discussion question" },
};

export function AiView({ content, big }: { content: AiContent; big?: boolean }) {
  return (
    <div className={big ? "space-y-6" : "space-y-4"}>
      <h3 className={`${big ? "text-[1.4em]" : "text-base"} font-bold text-slate-900`}>{content.title}</h3>
      {content.sections.map((s, i) => {
        const st = KIND_STYLE[s.kind] || KIND_STYLE.summary;
        return (
          <section key={i} className={`border-l-4 pl-4 ${st.bar}`}>
            <div className="mb-1 flex items-center gap-2">
              <span className={`badge ${st.chip}`}>{st.label}</span>
              <h4 className={`${big ? "text-[1.05em]" : "text-sm"} font-semibold text-slate-800`}>{s.heading}</h4>
            </div>
            <ul className="space-y-2">
              {s.items.map((it, j) => (
                <li key={j} className={`${big ? "" : "text-sm"} leading-relaxed text-slate-800`}>
                  {it.text}{" "}
                  {it.cites.map((c) => (
                    <span key={c} className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 align-middle font-mono text-[0.7em] text-slate-600" title={`Source entry #${c}`}>
                      E{c}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {content.note && <p className="text-xs italic text-slate-500">{content.note}</p>}
    </div>
  );
}
