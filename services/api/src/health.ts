import { createHealthStatus } from "@harbor/shared";

const healthStatus = createHealthStatus("@harbor/api");

console.log(JSON.stringify(healthStatus, null, 2));
