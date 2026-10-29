import Link from "next/link";
import { Brand } from "./brand";
import { AuthForm } from "./auth-form";
export function AuthPage({ register = false }: { register?: boolean }) {
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-teal-900 p-14 text-white lg:flex">
        <Link href="/" className="text-xl font-bold">
          FlowPilot AI
        </Link>
        <div>
          <p className="mb-6 text-xs tracking-widest text-teal-200 uppercase">
            Make room for possibility
          </p>
          <h2 className="max-w-lg text-6xl leading-tight tracking-tight">
            Your next chapter.
            <br />
            <span className="font-serif italic text-lime-200">
              A little more flow.
            </span>
          </h2>
          <p className="mt-7 max-w-sm leading-7 text-teal-100">
            A private workspace today. A world of thoughtful automations ahead.
          </p>
        </div>
        <p className="text-xs text-teal-200">
          Early access · Manual workflows available. Integrations coming soon.
        </p>
      </div>
      <div className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm">
          <Brand />
          <h1 className="mt-12 text-3xl font-semibold tracking-tight">
            {register ? "A fresh start awaits." : "Welcome back."}
          </h1>
          <p className="mt-3 text-sm leading-6 text-stone-500">
            {register
              ? "Create your account and your own private workspace."
              : "Sign in to your FlowPilot AI workspace."}
          </p>
          <AuthForm register={register} />
          <p className="mt-7 text-center text-sm text-stone-500">
            {register ? "Already have an account? " : "New to FlowPilot AI? "}
            <Link
              href={register ? "/login" : "/register"}
              className="font-semibold text-teal-800 underline underline-offset-4"
            >
              {register ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <p className="mt-10 text-center text-xs leading-6 text-stone-500">
            Real accounts, secure sessions. No payment required.
            <br />
            Email verification and password recovery are not available yet.
          </p>
        </div>
      </div>
    </main>
  );
}
