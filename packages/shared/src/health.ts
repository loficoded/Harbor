export type ServiceHealthStatus = "ok";

export type ServiceHealth = Readonly<{
  service: string;
  status: ServiceHealthStatus;
  checkedAt: string;
}>;

export function createHealthStatus(
  service: string,
  checkedAt = new Date().toISOString(),
): ServiceHealth {
  return {
    service,
    status: "ok",
    checkedAt,
  };
}
