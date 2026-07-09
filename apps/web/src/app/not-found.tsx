import { EmptyState } from "@/components/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-8">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist."
      >
        <Link
          href="/"
          className="text-sm font-medium text-accent hover:underline"
        >
          Back to overview
        </Link>
      </EmptyState>
    </div>
  );
}
