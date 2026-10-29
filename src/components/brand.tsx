import Link from "next/link";
import { Workflow } from "lucide-react";
export function Brand() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 font-bold text-lg tracking-tight"
    >
      <span className="rounded-xl bg-teal-800 p-2 text-white">
        <Workflow size={21} />
      </span>
      FlowPilot <span className="font-normal text-teal-700">AI</span>
    </Link>
  );
}
