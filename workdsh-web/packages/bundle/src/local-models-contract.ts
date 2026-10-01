/** The local model server's status route, shared by the Host plugin and the Web UI. */

/** Status and control route. */
export const statusPath = '/api/workdsh-local-models';

/** Where the server stands. A router someone else runs counts as running. */
export type ServerState = 'stopped' | 'starting' | 'running' | 'failed';

/** What the status route reports. */
export interface LocalModelsStatus {
  /** `managed` when WorkDSH starts the server, `external` for a router someone else runs. */
  mode: 'managed' | 'external';
  /** The user's choice; null until they choose, while the server runs whenever the folder holds a model. */
  enabled: boolean | null;
  state: ServerState;
  /** Provider route the models join. */
  route: string;
  /** Model ids the route offers. */
  models: string[];
  modelsDir?: string;
  /** Whether new agents start on a local model. */
  isDefault: boolean;
  /** Why the server failed. */
  error?: string;
}

/** A request to the status route. */
export interface LocalModelsRequest {
  /** Start (true) or stop (false) the server, and remember the choice. */
  enabled?: boolean;
  /** Make the first local model the default once one is served. */
  useAsDefault?: boolean;
}
