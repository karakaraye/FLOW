"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createAuthClient } from "better-auth/react";
import {
  Sparkles,
  LayoutDashboard,
  Workflow,
  LayoutTemplate,
  Plug,
  History,
  Settings,
  LogOut,
  Menu,
  X,
  ArrowUpRight,
} from "lucide-react";
import { Brand } from "./brand";
import { Button } from "./ui/button";
const links = [
  { href: "/dashboard", title: "Overview", icon: LayoutDashboard },
  { href: "/workflows", title: "Workflows", icon: Workflow },
  { href: "/templates", title: "Templates", icon: LayoutTemplate },
  { href: "/integrations", title: "Integrations", icon: Plug },
  { href: "/ai", title: "AI workspace", icon: Sparkles },
  { href: "/history", title: "Execution history", icon: History },
  { href: "/billing", title: "Billing and usage", icon: Settings },
  { href: "/settings", title: "Settings", icon: Settings },
];
export function AppSidebar({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    setError("");
    try {
      const result = await createAuthClient().signOut();
      if (result.error) {
        setError("Sign out failed. Try again.");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError("Sign out failed. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-white p-4 lg:hidden">
        <Brand />
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls="app-navigation"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </Button>
      </div>
      <aside
        id="app-navigation"
        className={`${open ? "flex" : "hidden"} flex-col border-r border-border bg-white p-5 lg:fixed lg:inset-y-0 lg:flex lg:w-64`}
      >
        <div className="hidden px-2 py-3 lg:block">
          <Brand />
        </div>
        <div className="mt-5 rounded-xl border border-border bg-stone-50 p-3">
          <p className="text-[10px] font-bold tracking-widest text-stone-500 uppercase">
            Your workspace
          </p>
          <p
            className="mt-2 truncate text-sm font-semibold"
            title={workspaceName}
          >
            {workspaceName}
          </p>
        </div>
        <nav aria-label="Application navigation" className="mt-7 space-y-1">
          {links.map(({ href, title, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              aria-current={path === href ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm ${path === href ? "bg-teal-50 font-semibold text-teal-800" : "text-stone-500 hover:bg-stone-50"}`}
            >
              <Icon size={18} />
              {title}
            </Link>
          ))}
        </nav>
        <div className="mt-10 rounded-xl bg-[#eff4e9] p-4 lg:mt-auto">
          <p className="text-sm font-semibold">Good things take shape.</p>
          <p className="mt-2 text-xs leading-5 text-stone-600">
            Manual runs, signed webhooks, and approved HTTPS actions are
            available. Other provider integrations and scheduling are coming
            soon.
          </p>
          <Link
            href="/#features"
            className="mt-3 inline-flex items-center gap-2 text-xs font-semibold"
          >
            Explore the vision <ArrowUpRight size={13} />
          </Link>
        </div>
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
        <Button
          variant="ghost"
          className="mt-3 justify-start text-stone-500"
          onClick={logout}
          disabled={pending}
        >
          <LogOut size={17} />
          {pending ? "Signing out…" : "Sign out"}
        </Button>
      </aside>
    </>
  );
}
