"use client";

import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/control";
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
        className={inputClasses("font-mono")}
      />
      <Button type="submit" disabled={trimmed === ""} className="sm:shrink-0">
        View status
      </Button>
    </form>
  );
}
