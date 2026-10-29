import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-lg px-6 py-32 text-center">
      <p className="text-sm text-teal-700">404 · A little off course</p>
      <h1 className="mt-4 text-4xl font-semibold">
        Let’s get you back in flow.
      </h1>
      <p className="mt-4 text-stone-500">
        The page you’re looking for isn’t here.
      </p>
      <Button asChild className="mt-8">
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
