"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { Header, Spinner } from "@/components/ui";

export interface StaffUser {
  id: number;
  role: "teacher" | "educator";
  name: string;
  email: string;
}

/** Client-side guard for nicer navigation only. Every API call is authorised again on the server. */
export function StaffShell({ role, children, crumbs }: { role: "teacher" | "educator"; children: (u: StaffUser) => ReactNode; crumbs?: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  useEffect(() => {
    api<{ staff: StaffUser | null }>("GET", "/auth/me")
      .then((m) => {
        if (!m.staff) router.replace("/");
        else if (m.staff.role !== role) router.replace(m.staff.role === "teacher" ? "/teacher" : "/educator");
        else setUser(m.staff);
      })
      .catch(() => router.replace("/"));
  }, [role, router]);
  if (!user) return <Spinner />;
  return (
    <div className="min-h-screen">
      <Header
        title="Scientific Investigations"
        sub={`${user.name} · ${role === "teacher" ? "Teacher" : "Teacher Educator"}`}
        right={
          <>
            {crumbs}
            <Link href={role === "teacher" ? "/teacher" : "/educator"} className="btn-ghost btn-sm">
              Dashboard
            </Link>
            <button className="btn-ghost btn-sm" onClick={async () => { await api("POST", "/auth/logout").catch(() => {}); router.push("/"); }}>
              Sign out
            </button>
          </>
        }
      />
      {children(user)}
    </div>
  );
}
