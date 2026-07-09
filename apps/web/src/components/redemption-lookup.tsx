"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Redemption id lookup. Navigates to the status route for the entered id. This
 * is a navigation aid only; the status view itself is a later prompt.
 */
export function RedemptionLookup() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (trimmed === "") {
      return;
    }

    router.push(`/status/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Redemption request id"
        aria-label="Redemption request id"
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      />
      <Button type="submit" disabled={trimmed === ""}>
        View status
      </Button>
    </form>
  );
}
