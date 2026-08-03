export interface HealthCheckResult {
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * A named readiness probe contributed by an infrastructure component
 * (datastore, cache, upstream API). Registered at composition time so the HTTP
 * layer never has to know what it is actually checking.
 */
export interface HealthCheck {
  readonly name: string;
  check(): Promise<HealthCheckResult>;
}

export interface HealthRouterOptions {
  readonly version: string;
  readonly startedAt: number;
  readonly checks?: readonly HealthCheck[];
}
