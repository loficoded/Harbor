import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Globals are disabled, so React Testing Library's automatic cleanup does not
// register itself; unmount rendered trees between tests explicitly.
afterEach(() => {
  cleanup();
});
