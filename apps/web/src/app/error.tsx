"use client";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useEffect } from "react";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Surface the error for local debugging; production logging is a later concern.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-8">
      <Callout
        tone="danger"
        title="Something went wrong"
        actions={
          <Button size="sm" variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      >
        <p>An unexpected error occurred while rendering this page.</p>
      </Callout>
    </div>
  );
}
