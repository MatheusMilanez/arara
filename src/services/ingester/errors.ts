export class DatasourceError extends Error {
  readonly datasource: string;

  constructor(message: string, datasource: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatasourceError';
    this.datasource = datasource;
  }
}

export class IngestionError extends Error {
  readonly datasource: string;

  constructor(message: string, datasource: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IngestionError';
    this.datasource = datasource;
  }
}

// A timeout is really a specific kind of datasource failure (the source
// never answered in time), so it inherits from DatasourceError instead of
// sitting alongside it.
export class TimeoutError extends DatasourceError {
  constructor(datasource: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`, datasource);
    this.name = 'TimeoutError';
  }
}
