"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAuthClient } from "better-auth/react";
import { Button } from "./ui/button";
import { ArrowRight } from "lucide-react";
const authClient = createAuthClient();
export function AuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    try {
      const result = register
        ? await authClient.signUp.email({
            name: String(data.get("name")).trim(),
            email,
            password,
          })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(
          register
            ? "Unable to create your account. Check your details or try signing in."
            : "Unable to sign in. Check your email and password, or try again later.",
        );
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("We couldn’t reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      {register && (
        <div>
          <label htmlFor="name" className="mb-2 block text-sm font-medium">
            Your name
          </label>
          <input
            id="name"
            name="name"
            autoComplete="name"
            required
            maxLength={100}
          />
        </div>
      )}
      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-2 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={register ? "new-password" : "current-password"}
          required
          minLength={register ? 12 : 1}
          maxLength={128}
        />
        {register && (
          <p className="mt-2 text-xs text-stone-500">
            Use at least 12 characters. A unique passphrase works well.
          </p>
        )}
      </div>
      <p role="alert" aria-live="polite" className="text-sm text-red-700">
        {error}
      </p>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait…" : register ? "Create account" : "Sign in"}
        <ArrowRight size={16} />
      </Button>
    </form>
  );
}
