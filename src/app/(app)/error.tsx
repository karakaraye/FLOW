"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">
        We couldn’t load your workspace.
      </h1>
      <p className="my-4 text-stone-500">
        Please try again. If this continues, check the database connection.
      </p>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
