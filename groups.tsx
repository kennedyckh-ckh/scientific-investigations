"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/ui";
import type { SessionDetail } from "./types";

type G = SessionDetail["groups"][number];

export function Groups({ session, onSaved }: { session: SessionDetail; onSaved: () => void }) {
  const toast = useToast();
  const archived = session.status === "archived";
  const [nName, setNName] = useState("");
  const [nPin, setNPin] = useState("");
  const [nCap, setNCap] = useState("");
  async function add() {
    try {
      await api("POST", `/teacher/sessions/${session.id}/groups`, { name: nName, pin: nPin, seatCap: nCap ? Number(nCap) : null });
      setNName("");
      setNPin("");
      setNCap("");
      toast("Group added");
      onSaved();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
        Students pick one of these authorised groups (or are assigned one) when they join. A <b>PIN</b> stops students from joining the wrong group by accident, and a <b>seat cap</b> limits group size. The PIN is also what lets a student continue on a new device.
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Group name</th>
              <th className="p-3">PIN (optional)</th>
              <th className="p-3">Seat cap</th>
              <th className="p-3">Members</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {session.groups.map((g) => (
              <GroupRow key={g.id} g={g} sessionId={session.id} disabled={archived} onSaved={onSaved} />
            ))}
            <tr className="bg-slate-50/60">
              <td className="p-3">
                <input className="input" placeholder="New group name" value={nName} onChange={(e) => setNName(e.target.value)} maxLength={60} disabled={archived} />
              </td>
              <td className="p-3">
                <input className="input font-mono" placeholder="none" value={nPin} onChange={(e) => setNPin(e.target.value)} maxLength={12} disabled={archived} />
              </td>
              <td className="p-3">
                <input className="input" type="number" min={1} max={60} placeholder="no limit" value={nCap} onChange={(e) => setNCap(e.target.value)} disabled={archived} />
              </td>
              <td />
              <td className="p-3 text-right">
                <button className="btn-primary btn-sm" disabled={archived || !nName.trim()} onClick={add}>
                  Add group
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRow({ g, sessionId, disabled, onSaved }: { g: G; sessionId: number; disabled: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(g.name);
  const [pin, setPin] = useState(g.pin);
  const [cap, setCap] = useState(g.seatCap === null ? "" : String(g.seatCap));
  const dirty = name !== g.name || pin !== g.pin || cap !== (g.seatCap === null ? "" : String(g.seatCap));
  async function save() {
    try {
      await api("PATCH", `/teacher/sessions/${sessionId}/groups/${g.id}`, { name, pin, seatCap: cap ? Number(cap) : null });
      toast("Group saved");
      onSaved();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  async function del() {
    if (!confirm(`Remove ${g.name}?`)) return;
    try {
      await api("DELETE", `/teacher/sessions/${sessionId}/groups/${g.id}`);
      onSaved();
    } catch (e) {
      toast((e as ApiError).message, "err");
    }
  }
  return (
    <tr>
      <td className="p-3">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} maxLength={60} aria-label="Group name" />
      </td>
      <td className="p-3">
        <input className="input font-mono" value={pin} onChange={(e) => setPin(e.target.value)} disabled={disabled} maxLength={12} placeholder="none" aria-label="Group PIN" />
      </td>
      <td className="p-3">
        <input className="input" type="number" min={1} max={60} value={cap} onChange={(e) => setCap(e.target.value)} disabled={disabled} placeholder="no limit" aria-label="Seat cap" />
      </td>
      <td className="p-3 font-semibold">{g.members}{g.seatCap ? ` / ${g.seatCap}` : ""}</td>
      <td className="flex justify-end gap-2 p-3">
        <button className="btn-primary btn-sm" disabled={disabled || !dirty || !name.trim()} onClick={save}>
          Save
        </button>
        <button className="btn-ghost btn-sm text-rose-700" disabled={disabled || g.members > 0} title={g.members > 0 ? "Groups with students can't be removed" : "Remove"} onClick={del}>
          Remove
        </button>
      </td>
    </tr>
  );
}
