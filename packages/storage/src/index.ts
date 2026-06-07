import type {
  ApiReplayReport,
  ApiSnapshotRecord,
  AssetRecord,
  AssetStatus,
  BlobRecord,
  GeneratedOutputRecord,
  HtmlSnapshotRecord,
  JobRecord,
  JobStats,
  JobStatus,
  PipelineRunRecord,
  ThreeDPreparationReport
} from "@clone3d/shared";

export type JobPatch = Partial<Omit<JobRecord, "id">>;
export type AssetPatch = Partial<Omit<AssetRecord, "id" | "jobId">>;

export interface JobStore {
  get(jobId: string): Promise<JobRecord | undefined>;
  getJob(jobId: string): Promise<JobRecord | undefined>;
  put(job: JobRecord): Promise<void>;
  putJob(job: JobRecord): Promise<void>;
  updateJob(jobId: string, patch: JobPatch): Promise<JobRecord | undefined>;
  list(): Promise<JobRecord[]>;
  getLatestJob(): Promise<JobRecord | undefined>;
  delete(jobId: string): Promise<void>;
  setJobStatus(jobId: string, status: JobStatus): Promise<JobRecord | undefined>;
  updateJobStats(jobId: string): Promise<JobRecord | undefined>;
  recomputeJobStats(jobId: string): Promise<JobStats>;
  putAssets(jobId: string, assets: AssetRecord[]): Promise<void>;
  listAssets(jobId: string): Promise<AssetRecord[]>;
  getAssetsByJob(jobId: string): Promise<AssetRecord[]>;
  getAsset(assetId: string): Promise<AssetRecord | undefined>;
  updateAsset(assetId: string, patch: AssetPatch): Promise<AssetRecord | undefined>;
  bulkUpdateAssets(assetIds: string[], patch: AssetPatch): Promise<void>;
  getAssetsByStatus(jobId: string, statuses: AssetStatus[]): Promise<AssetRecord[]>;
  clearAssets(jobId: string): Promise<void>;
  putHtmlSnapshot(snapshot: HtmlSnapshotRecord): Promise<void>;
  getHtmlSnapshot(jobId: string): Promise<HtmlSnapshotRecord | undefined>;
  putGeneratedOutput(output: GeneratedOutputRecord): Promise<void>;
  getLatestGeneratedOutput(jobId: string): Promise<GeneratedOutputRecord | undefined>;
  saveThreeDPreparationReport(report: ThreeDPreparationReport): Promise<void>;
  getThreeDPreparationReport(jobId: string): Promise<ThreeDPreparationReport | undefined>;
  updateThreeDPreparationReport(
    jobId: string,
    patch: Partial<Omit<ThreeDPreparationReport, "jobId">>
  ): Promise<ThreeDPreparationReport | undefined>;
  putApiSnapshot(record: ApiSnapshotRecord): Promise<void>;
  getApiSnapshot(id: string): Promise<ApiSnapshotRecord | undefined>;
  getApiSnapshotsByJob(jobId: string): Promise<ApiSnapshotRecord[]>;
  getApiSnapshotByMethodAndUrl(
    jobId: string,
    method: string,
    normalizedUrl: string
  ): Promise<ApiSnapshotRecord | undefined>;
  updateApiSnapshot(id: string, patch: Partial<ApiSnapshotRecord>): Promise<void>;
  deleteApiSnapshot(id: string): Promise<void>;
  saveApiReplayReport(report: ApiReplayReport): Promise<void>;
  getApiReplayReport(jobId: string): Promise<ApiReplayReport | undefined>;
  updateApiReplayReport(jobId: string, patch: Partial<ApiReplayReport>): Promise<void>;
  createPipelineRun(record: PipelineRunRecord): Promise<void>;
  updatePipelineRun(id: string, patch: Partial<PipelineRunRecord>): Promise<void>;
  getPipelineRun(id: string): Promise<PipelineRunRecord | undefined>;
  getLatestPipelineRun(): Promise<PipelineRunRecord | undefined>;
  getPipelineRunByJob(jobId: string): Promise<PipelineRunRecord | undefined>;
}

export interface BlobStoreLike {
  putBlob(params: {
    blob: Blob;
    sha256: string;
    contentType: string;
    originalUrl?: string;
    normalizedUrl?: string;
    derivedFromAssetId?: string;
    derivedKind?: BlobRecord["derivedKind"];
    filename?: string;
  }): Promise<BlobRecord>;
  getBlob(blobId: string): Promise<Blob | undefined>;
  getBlobRecord(blobId: string): Promise<BlobRecord | undefined>;
  getBlobRecordByHash(sha256: string): Promise<BlobRecord | undefined>;
  hasHash(sha256: string): Promise<boolean>;
  deleteBlob(blobId: string): Promise<void>;
}

type StoredBlobRecord = BlobRecord & { blob: Blob };

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly assets = new Map<string, AssetRecord>();
  private readonly htmlSnapshots = new Map<string, HtmlSnapshotRecord>();
  private readonly outputs = new Map<string, GeneratedOutputRecord>();
  private readonly threeDReports = new Map<string, ThreeDPreparationReport>();
  private readonly apiSnapshots = new Map<string, ApiSnapshotRecord>();
  private readonly apiReplayReports = new Map<string, ApiReplayReport>();
  private readonly pipelineRuns = new Map<string, PipelineRunRecord>();

  async get(jobId: string): Promise<JobRecord | undefined> {
    return this.getJob(jobId);
  }

  async getJob(jobId: string): Promise<JobRecord | undefined> {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : undefined;
  }

  async put(job: JobRecord): Promise<void> {
    await this.putJob(job);
  }

  async putJob(job: JobRecord): Promise<void> {
    this.jobs.set(job.id, cloneJob(job));
  }

  async updateJob(jobId: string, patch: JobPatch): Promise<JobRecord | undefined> {
    const current = await this.getJob(jobId);
    if (!current) {
      return undefined;
    }

    const updated = { ...current, ...patch, id: current.id, updatedAt: patch.updatedAt ?? Date.now() };
    await this.putJob(updated);
    return updated;
  }

  async list(): Promise<JobRecord[]> {
    return [...this.jobs.values()].map(cloneJob);
  }

  async getLatestJob(): Promise<JobRecord | undefined> {
    return (await this.list()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async delete(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
    await this.clearAssets(jobId);
    this.htmlSnapshots.delete(jobId);
    this.threeDReports.delete(jobId);
    this.apiReplayReports.delete(jobId);
    for (const snapshot of [...this.apiSnapshots.values()]) {
      if (snapshot.jobId === jobId) {
        this.apiSnapshots.delete(snapshot.id);
      }
    }
    for (const pipelineRun of [...this.pipelineRuns.values()]) {
      if (pipelineRun.jobId === jobId) {
        this.pipelineRuns.delete(pipelineRun.id);
      }
    }
    for (const output of [...this.outputs.values()]) {
      if (output.jobId === jobId) {
        this.outputs.delete(output.id);
      }
    }
  }

  async setJobStatus(jobId: string, status: JobStatus): Promise<JobRecord | undefined> {
    return this.updateJob(jobId, { status });
  }

  async updateJobStats(jobId: string): Promise<JobRecord | undefined> {
    const stats = await this.recomputeJobStats(jobId);
    return this.updateJob(jobId, { stats });
  }

  async recomputeJobStats(jobId: string): Promise<JobStats> {
    return computeJobStats(await this.listAssets(jobId));
  }

  async putAssets(_jobId: string, assets: AssetRecord[]): Promise<void> {
    for (const asset of assets) {
      this.assets.set(asset.id, cloneAsset(asset));
    }
  }

  async listAssets(jobId: string): Promise<AssetRecord[]> {
    return [...this.assets.values()].filter((asset) => asset.jobId === jobId).map(cloneAsset);
  }

  async getAssetsByJob(jobId: string): Promise<AssetRecord[]> {
    return this.listAssets(jobId);
  }

  async getAsset(assetId: string): Promise<AssetRecord | undefined> {
    const asset = this.assets.get(assetId);
    return asset ? cloneAsset(asset) : undefined;
  }

  async updateAsset(assetId: string, patch: AssetPatch): Promise<AssetRecord | undefined> {
    const current = await this.getAsset(assetId);
    if (!current) {
      return undefined;
    }

    const updated = { ...current, ...patch, id: current.id, jobId: current.jobId, updatedAt: patch.updatedAt ?? Date.now() };
    this.assets.set(assetId, cloneAsset(updated));
    return updated;
  }

  async bulkUpdateAssets(assetIds: string[], patch: AssetPatch): Promise<void> {
    for (const assetId of assetIds) {
      await this.updateAsset(assetId, patch);
    }
  }

  async getAssetsByStatus(jobId: string, statuses: AssetStatus[]): Promise<AssetRecord[]> {
    const statusSet = new Set(statuses);
    return (await this.listAssets(jobId)).filter((asset) => statusSet.has(asset.status));
  }

  async clearAssets(jobId: string): Promise<void> {
    for (const asset of [...this.assets.values()]) {
      if (asset.jobId === jobId) {
        this.assets.delete(asset.id);
      }
    }
  }

  async putHtmlSnapshot(snapshot: HtmlSnapshotRecord): Promise<void> {
    this.htmlSnapshots.set(snapshot.jobId, cloneHtmlSnapshot(snapshot));
  }

  async getHtmlSnapshot(jobId: string): Promise<HtmlSnapshotRecord | undefined> {
    const snapshot = this.htmlSnapshots.get(jobId);
    return snapshot ? cloneHtmlSnapshot(snapshot) : undefined;
  }

  async putGeneratedOutput(output: GeneratedOutputRecord): Promise<void> {
    this.outputs.set(output.id, cloneGeneratedOutput(output));
  }

  async getLatestGeneratedOutput(jobId: string): Promise<GeneratedOutputRecord | undefined> {
    return [...this.outputs.values()]
      .filter((output) => output.jobId === jobId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(cloneGeneratedOutput)[0];
  }

  async saveThreeDPreparationReport(report: ThreeDPreparationReport): Promise<void> {
    this.threeDReports.set(report.jobId, cloneThreeDReport(report));
    await this.updateJob(report.jobId, { threeDPreparationReport: report });
  }

  async getThreeDPreparationReport(jobId: string): Promise<ThreeDPreparationReport | undefined> {
    const report = this.threeDReports.get(jobId);
    if (report) {
      return cloneThreeDReport(report);
    }

    const job = await this.getJob(jobId);
    return job?.threeDPreparationReport ? cloneThreeDReport(job.threeDPreparationReport) : undefined;
  }

  async updateThreeDPreparationReport(
    jobId: string,
    patch: Partial<Omit<ThreeDPreparationReport, "jobId">>
  ): Promise<ThreeDPreparationReport | undefined> {
    const current =
      (await this.getThreeDPreparationReport(jobId)) ??
      ({
        jobId,
        startedAt: Date.now(),
        detected3dAssets: 0,
        gltfFilesAnalyzed: 0,
        gltfFilesRewritten: 0,
        derivedAssetsCreated: 0,
        derivedAssetsUploaded: 0,
        decoderAssetsDetected: 0,
        workerAssetsDetected: 0,
        wasmAssetsDetected: 0,
        textureAssetsDetected: 0,
        unresolvedGltfUris: [],
        unresolvedDecoderUrls: [],
        unresolvedWorkerUrls: [],
        warnings: [],
        errors: []
      } satisfies ThreeDPreparationReport);
    const updated = mergeThreeDReport(current, patch);
    await this.saveThreeDPreparationReport(updated);
    return updated;
  }

  async putApiSnapshot(record: ApiSnapshotRecord): Promise<void> {
    this.apiSnapshots.set(record.id, cloneApiSnapshot(record));
  }

  async getApiSnapshot(id: string): Promise<ApiSnapshotRecord | undefined> {
    const record = this.apiSnapshots.get(id);
    return record ? cloneApiSnapshot(record) : undefined;
  }

  async getApiSnapshotsByJob(jobId: string): Promise<ApiSnapshotRecord[]> {
    return [...this.apiSnapshots.values()]
      .filter((record) => record.jobId === jobId)
      .sort((a, b) => a.capturedAt - b.capturedAt)
      .map(cloneApiSnapshot);
  }

  async getApiSnapshotByMethodAndUrl(
    jobId: string,
    method: string,
    normalizedUrl: string
  ): Promise<ApiSnapshotRecord | undefined> {
    const methodAndUrl = buildMethodAndUrl(method, normalizedUrl);
    return (await this.getApiSnapshotsByJob(jobId))
      .filter((record) => record.methodAndUrl === methodAndUrl || buildMethodAndUrl(record.method, record.normalizedUrl) === methodAndUrl)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async updateApiSnapshot(id: string, patch: Partial<ApiSnapshotRecord>): Promise<void> {
    const current = await this.getApiSnapshot(id);
    if (!current) {
      return;
    }

    this.apiSnapshots.set(id, cloneApiSnapshot({ ...current, ...patch, id: current.id, updatedAt: patch.updatedAt ?? Date.now() }));
  }

  async deleteApiSnapshot(id: string): Promise<void> {
    this.apiSnapshots.delete(id);
  }

  async saveApiReplayReport(report: ApiReplayReport): Promise<void> {
    this.apiReplayReports.set(report.jobId, cloneApiReplayReport(report));
    await this.updateJob(report.jobId, { apiReplayReport: report });
  }

  async getApiReplayReport(jobId: string): Promise<ApiReplayReport | undefined> {
    const report = this.apiReplayReports.get(jobId);
    if (report) {
      return cloneApiReplayReport(report);
    }

    const job = await this.getJob(jobId);
    return job?.apiReplayReport ? cloneApiReplayReport(job.apiReplayReport) : undefined;
  }

  async updateApiReplayReport(jobId: string, patch: Partial<ApiReplayReport>): Promise<void> {
    const current = (await this.getApiReplayReport(jobId)) ?? createEmptyApiReplayReport(jobId);
    await this.saveApiReplayReport(mergeApiReplayReport(current, patch));
  }

  async createPipelineRun(record: PipelineRunRecord): Promise<void> {
    this.pipelineRuns.set(record.id, clonePipelineRun(record));
    if (record.jobId) {
      await this.updateJob(record.jobId, { pipelineRun: record });
    }
  }

  async updatePipelineRun(id: string, patch: Partial<PipelineRunRecord>): Promise<void> {
    const current = await this.getPipelineRun(id);
    if (!current) {
      return;
    }

    const updated = clonePipelineRun({ ...current, ...patch, id: current.id, updatedAt: patch.updatedAt ?? Date.now() });
    this.pipelineRuns.set(id, updated);
    if (updated.jobId) {
      await this.updateJob(updated.jobId, { pipelineRun: updated });
    }
  }

  async getPipelineRun(id: string): Promise<PipelineRunRecord | undefined> {
    const record = this.pipelineRuns.get(id);
    return record ? clonePipelineRun(record) : undefined;
  }

  async getLatestPipelineRun(): Promise<PipelineRunRecord | undefined> {
    return [...this.pipelineRuns.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(clonePipelineRun)[0];
  }

  async getPipelineRunByJob(jobId: string): Promise<PipelineRunRecord | undefined> {
    return [...this.pipelineRuns.values()]
      .filter((record) => record.jobId === jobId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(clonePipelineRun)[0];
  }
}

export class MemoryBlobStore implements BlobStoreLike {
  private readonly records = new Map<string, StoredBlobRecord>();
  private readonly byHash = new Map<string, string>();

  async putBlob(params: {
    blob: Blob;
    sha256: string;
    contentType: string;
    originalUrl?: string;
    normalizedUrl?: string;
    derivedFromAssetId?: string;
    derivedKind?: BlobRecord["derivedKind"];
    filename?: string;
  }): Promise<BlobRecord> {
    const existingId = this.byHash.get(params.sha256);
    if (existingId) {
      const existing = this.records.get(existingId);
      if (existing) {
        return stripBlob(existing);
      }
    }

    const now = Date.now();
    const blobId = `blob_${params.sha256}`;
    const record: StoredBlobRecord = {
      blobId,
      sha256: params.sha256,
      size: params.blob.size,
      contentType: params.contentType,
      originalUrl: params.originalUrl,
      normalizedUrl: params.normalizedUrl,
      derivedFromAssetId: params.derivedFromAssetId,
      derivedKind: params.derivedKind,
      filename: params.filename,
      createdAt: now,
      updatedAt: now,
      blob: params.blob
    };

    this.records.set(blobId, record);
    this.byHash.set(params.sha256, blobId);
    return stripBlob(record);
  }

  async getBlob(blobId: string): Promise<Blob | undefined> {
    return this.records.get(blobId)?.blob;
  }

  async getBlobRecord(blobId: string): Promise<BlobRecord | undefined> {
    const record = this.records.get(blobId);
    return record ? stripBlob(record) : undefined;
  }

  async getBlobRecordByHash(sha256: string): Promise<BlobRecord | undefined> {
    const blobId = this.byHash.get(sha256);
    return blobId ? this.getBlobRecord(blobId) : undefined;
  }

  async hasHash(sha256: string): Promise<boolean> {
    return this.byHash.has(sha256);
  }

  async deleteBlob(blobId: string): Promise<void> {
    const record = this.records.get(blobId);
    if (record) {
      this.byHash.delete(record.sha256);
      this.records.delete(blobId);
    }
  }
}

const DB_NAME = "clone3d-snapshot";
const DB_VERSION = 5;
const JOBS_STORE = "jobs";
const ASSETS_STORE = "assets";
const BLOBS_STORE = "blobs";
const HTML_SNAPSHOTS_STORE = "htmlSnapshots";
const OUTPUTS_STORE = "outputs";
const THREE_D_REPORTS_STORE = "threeDReports";
const API_SNAPSHOTS_STORE = "apiSnapshots";
const API_REPLAY_REPORTS_STORE = "apiReplayReports";
const PIPELINE_RUNS_STORE = "pipelineRuns";
const JOB_ID_INDEX = "jobId";
const SHA256_INDEX = "sha256";
const NORMALIZED_URL_INDEX = "normalizedUrl";
const METHOD_AND_URL_INDEX = "methodAndUrl";
const REPLAYABLE_INDEX = "replayable";
const STATUS_INDEX = "status";
const UPDATED_AT_INDEX = "updatedAt";

export class IndexedDbJobStore implements JobStore {
  async get(jobId: string): Promise<JobRecord | undefined> {
    return this.getJob(jobId);
  }

  async getJob(jobId: string): Promise<JobRecord | undefined> {
    const db = await openCloneDb();
    return requestToPromise<JobRecord | undefined>(
      db.transaction(JOBS_STORE, "readonly").objectStore(JOBS_STORE).get(jobId)
    );
  }

  async put(job: JobRecord): Promise<void> {
    await this.putJob(job);
  }

  async putJob(job: JobRecord): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(JOBS_STORE, "readwrite");
    tx.objectStore(JOBS_STORE).put(job);
    await transactionDone(tx);
  }

  async updateJob(jobId: string, patch: JobPatch): Promise<JobRecord | undefined> {
    const db = await openCloneDb();
    const tx = db.transaction(JOBS_STORE, "readwrite");
    const store = tx.objectStore(JOBS_STORE);
    const current = await requestToPromise<JobRecord | undefined>(store.get(jobId));
    if (!current) {
      return undefined;
    }

    const updated = { ...current, ...patch, id: current.id, updatedAt: patch.updatedAt ?? Date.now() };
    store.put(updated);
    await transactionDone(tx);
    return updated;
  }

  async list(): Promise<JobRecord[]> {
    const db = await openCloneDb();
    return requestToPromise<JobRecord[]>(
      db.transaction(JOBS_STORE, "readonly").objectStore(JOBS_STORE).getAll()
    );
  }

  async getLatestJob(): Promise<JobRecord | undefined> {
    return (await this.list()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async delete(jobId: string): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(
      [
        JOBS_STORE,
        ASSETS_STORE,
        HTML_SNAPSHOTS_STORE,
        OUTPUTS_STORE,
        THREE_D_REPORTS_STORE,
        API_SNAPSHOTS_STORE,
        API_REPLAY_REPORTS_STORE,
        PIPELINE_RUNS_STORE
      ],
      "readwrite"
    );
    tx.objectStore(JOBS_STORE).delete(jobId);
    await deleteAssetsForJob(tx.objectStore(ASSETS_STORE), jobId);
    tx.objectStore(HTML_SNAPSHOTS_STORE).delete(jobId);
    await deleteRecordsForJob(tx.objectStore(OUTPUTS_STORE), jobId);
    tx.objectStore(THREE_D_REPORTS_STORE).delete(jobId);
    await deleteRecordsForJob(tx.objectStore(API_SNAPSHOTS_STORE), jobId);
    tx.objectStore(API_REPLAY_REPORTS_STORE).delete(jobId);
    await deleteRecordsForJob(tx.objectStore(PIPELINE_RUNS_STORE), jobId);
    await transactionDone(tx);
  }

  async setJobStatus(jobId: string, status: JobStatus): Promise<JobRecord | undefined> {
    return this.updateJob(jobId, { status });
  }

  async updateJobStats(jobId: string): Promise<JobRecord | undefined> {
    const stats = await this.recomputeJobStats(jobId);
    return this.updateJob(jobId, { stats });
  }

  async recomputeJobStats(jobId: string): Promise<JobStats> {
    return computeJobStats(await this.listAssets(jobId));
  }

  async putAssets(jobId: string, assets: AssetRecord[]): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(ASSETS_STORE, "readwrite");
    const store = tx.objectStore(ASSETS_STORE);
    await deleteAssetsForJob(store, jobId);

    for (const asset of assets) {
      store.put(asset);
    }

    await transactionDone(tx);
  }

  async listAssets(jobId: string): Promise<AssetRecord[]> {
    const db = await openCloneDb();
    const tx = db.transaction(ASSETS_STORE, "readonly");
    const index = tx.objectStore(ASSETS_STORE).index(JOB_ID_INDEX);
    return requestToPromise<AssetRecord[]>(index.getAll(jobId));
  }

  async getAssetsByJob(jobId: string): Promise<AssetRecord[]> {
    return this.listAssets(jobId);
  }

  async getAsset(assetId: string): Promise<AssetRecord | undefined> {
    const db = await openCloneDb();
    return requestToPromise<AssetRecord | undefined>(
      db.transaction(ASSETS_STORE, "readonly").objectStore(ASSETS_STORE).get(assetId)
    );
  }

  async updateAsset(assetId: string, patch: AssetPatch): Promise<AssetRecord | undefined> {
    const db = await openCloneDb();
    const tx = db.transaction(ASSETS_STORE, "readwrite");
    const store = tx.objectStore(ASSETS_STORE);
    const current = await requestToPromise<AssetRecord | undefined>(store.get(assetId));
    if (!current) {
      return undefined;
    }

    const updated = { ...current, ...patch, id: current.id, jobId: current.jobId, updatedAt: patch.updatedAt ?? Date.now() };
    store.put(updated);
    await transactionDone(tx);
    return updated;
  }

  async bulkUpdateAssets(assetIds: string[], patch: AssetPatch): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(ASSETS_STORE, "readwrite");
    const store = tx.objectStore(ASSETS_STORE);

    for (const assetId of assetIds) {
      const current = await requestToPromise<AssetRecord | undefined>(store.get(assetId));
      if (current) {
        store.put({ ...current, ...patch, id: current.id, jobId: current.jobId, updatedAt: patch.updatedAt ?? Date.now() });
      }
    }

    await transactionDone(tx);
  }

  async getAssetsByStatus(jobId: string, statuses: AssetStatus[]): Promise<AssetRecord[]> {
    const statusSet = new Set(statuses);
    return (await this.listAssets(jobId)).filter((asset) => statusSet.has(asset.status));
  }

  async clearAssets(jobId: string): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(ASSETS_STORE, "readwrite");
    await deleteAssetsForJob(tx.objectStore(ASSETS_STORE), jobId);
    await transactionDone(tx);
  }

  async putHtmlSnapshot(snapshot: HtmlSnapshotRecord): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(HTML_SNAPSHOTS_STORE, "readwrite");
    tx.objectStore(HTML_SNAPSHOTS_STORE).put(snapshot);
    await transactionDone(tx);
  }

  async getHtmlSnapshot(jobId: string): Promise<HtmlSnapshotRecord | undefined> {
    const db = await openCloneDb();
    return requestToPromise<HtmlSnapshotRecord | undefined>(
      db.transaction(HTML_SNAPSHOTS_STORE, "readonly").objectStore(HTML_SNAPSHOTS_STORE).get(jobId)
    );
  }

  async putGeneratedOutput(output: GeneratedOutputRecord): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(OUTPUTS_STORE, "readwrite");
    tx.objectStore(OUTPUTS_STORE).put(output);
    await transactionDone(tx);
  }

  async getLatestGeneratedOutput(jobId: string): Promise<GeneratedOutputRecord | undefined> {
    const db = await openCloneDb();
    const tx = db.transaction(OUTPUTS_STORE, "readonly");
    const index = tx.objectStore(OUTPUTS_STORE).index(JOB_ID_INDEX);
    const outputs = await requestToPromise<GeneratedOutputRecord[]>(index.getAll(jobId));
    return outputs.sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  async saveThreeDPreparationReport(report: ThreeDPreparationReport): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction([THREE_D_REPORTS_STORE, JOBS_STORE], "readwrite");
    tx.objectStore(THREE_D_REPORTS_STORE).put(report);

    const jobStore = tx.objectStore(JOBS_STORE);
    const job = await requestToPromise<JobRecord | undefined>(jobStore.get(report.jobId));
    if (job) {
      jobStore.put({
        ...job,
        threeDPreparationReport: report,
        updatedAt: Date.now()
      });
    }

    await transactionDone(tx);
  }

  async getThreeDPreparationReport(jobId: string): Promise<ThreeDPreparationReport | undefined> {
    const db = await openCloneDb();
    const stored = await requestToPromise<ThreeDPreparationReport | undefined>(
      db.transaction(THREE_D_REPORTS_STORE, "readonly").objectStore(THREE_D_REPORTS_STORE).get(jobId)
    );
    if (stored) {
      return stored;
    }

    const job = await this.getJob(jobId);
    return job?.threeDPreparationReport;
  }

  async updateThreeDPreparationReport(
    jobId: string,
    patch: Partial<Omit<ThreeDPreparationReport, "jobId">>
  ): Promise<ThreeDPreparationReport | undefined> {
    const current =
      (await this.getThreeDPreparationReport(jobId)) ??
      ({
        jobId,
        startedAt: Date.now(),
        detected3dAssets: 0,
        gltfFilesAnalyzed: 0,
        gltfFilesRewritten: 0,
        derivedAssetsCreated: 0,
        derivedAssetsUploaded: 0,
        decoderAssetsDetected: 0,
        workerAssetsDetected: 0,
        wasmAssetsDetected: 0,
        textureAssetsDetected: 0,
        unresolvedGltfUris: [],
        unresolvedDecoderUrls: [],
        unresolvedWorkerUrls: [],
        warnings: [],
        errors: []
      } satisfies ThreeDPreparationReport);
    const updated = mergeThreeDReport(current, patch);
    await this.saveThreeDPreparationReport(updated);
    return updated;
  }

  async putApiSnapshot(record: ApiSnapshotRecord): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(API_SNAPSHOTS_STORE, "readwrite");
    tx.objectStore(API_SNAPSHOTS_STORE).put({
      ...record,
      methodAndUrl: record.methodAndUrl ?? buildMethodAndUrl(record.method, record.normalizedUrl)
    });
    await transactionDone(tx);
  }

  async getApiSnapshot(id: string): Promise<ApiSnapshotRecord | undefined> {
    const db = await openCloneDb();
    return requestToPromise<ApiSnapshotRecord | undefined>(
      db.transaction(API_SNAPSHOTS_STORE, "readonly").objectStore(API_SNAPSHOTS_STORE).get(id)
    );
  }

  async getApiSnapshotsByJob(jobId: string): Promise<ApiSnapshotRecord[]> {
    const db = await openCloneDb();
    const tx = db.transaction(API_SNAPSHOTS_STORE, "readonly");
    const records = await requestToPromise<ApiSnapshotRecord[]>(
      tx.objectStore(API_SNAPSHOTS_STORE).index(JOB_ID_INDEX).getAll(jobId)
    );
    return records.sort((a, b) => a.capturedAt - b.capturedAt);
  }

  async getApiSnapshotByMethodAndUrl(
    jobId: string,
    method: string,
    normalizedUrl: string
  ): Promise<ApiSnapshotRecord | undefined> {
    const db = await openCloneDb();
    const tx = db.transaction(API_SNAPSHOTS_STORE, "readonly");
    const records = await requestToPromise<ApiSnapshotRecord[]>(
      tx.objectStore(API_SNAPSHOTS_STORE).index(METHOD_AND_URL_INDEX).getAll(buildMethodAndUrl(method, normalizedUrl))
    );
    return records.filter((record) => record.jobId === jobId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async updateApiSnapshot(id: string, patch: Partial<ApiSnapshotRecord>): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(API_SNAPSHOTS_STORE, "readwrite");
    const store = tx.objectStore(API_SNAPSHOTS_STORE);
    const current = await requestToPromise<ApiSnapshotRecord | undefined>(store.get(id));
    if (current) {
      store.put({
        ...current,
        ...patch,
        id: current.id,
        methodAndUrl: patch.methodAndUrl ?? current.methodAndUrl ?? buildMethodAndUrl(current.method, current.normalizedUrl),
        updatedAt: patch.updatedAt ?? Date.now()
      });
    }
    await transactionDone(tx);
  }

  async deleteApiSnapshot(id: string): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(API_SNAPSHOTS_STORE, "readwrite");
    tx.objectStore(API_SNAPSHOTS_STORE).delete(id);
    await transactionDone(tx);
  }

  async saveApiReplayReport(report: ApiReplayReport): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction([API_REPLAY_REPORTS_STORE, JOBS_STORE], "readwrite");
    tx.objectStore(API_REPLAY_REPORTS_STORE).put(report);

    const jobStore = tx.objectStore(JOBS_STORE);
    const job = await requestToPromise<JobRecord | undefined>(jobStore.get(report.jobId));
    if (job) {
      jobStore.put({
        ...job,
        apiReplayReport: report,
        updatedAt: Date.now()
      });
    }

    await transactionDone(tx);
  }

  async getApiReplayReport(jobId: string): Promise<ApiReplayReport | undefined> {
    const db = await openCloneDb();
    const stored = await requestToPromise<ApiReplayReport | undefined>(
      db.transaction(API_REPLAY_REPORTS_STORE, "readonly").objectStore(API_REPLAY_REPORTS_STORE).get(jobId)
    );
    if (stored) {
      return stored;
    }

    return (await this.getJob(jobId))?.apiReplayReport;
  }

  async updateApiReplayReport(jobId: string, patch: Partial<ApiReplayReport>): Promise<void> {
    const current = (await this.getApiReplayReport(jobId)) ?? createEmptyApiReplayReport(jobId);
    await this.saveApiReplayReport(mergeApiReplayReport(current, patch));
  }

  async createPipelineRun(record: PipelineRunRecord): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction([PIPELINE_RUNS_STORE, JOBS_STORE], "readwrite");
    tx.objectStore(PIPELINE_RUNS_STORE).put(record);
    if (record.jobId) {
      const jobStore = tx.objectStore(JOBS_STORE);
      const job = await requestToPromise<JobRecord | undefined>(jobStore.get(record.jobId));
      if (job) {
        jobStore.put({
          ...job,
          pipelineRun: record,
          updatedAt: Date.now()
        });
      }
    }
    await transactionDone(tx);
  }

  async updatePipelineRun(id: string, patch: Partial<PipelineRunRecord>): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction([PIPELINE_RUNS_STORE, JOBS_STORE], "readwrite");
    const store = tx.objectStore(PIPELINE_RUNS_STORE);
    const current = await requestToPromise<PipelineRunRecord | undefined>(store.get(id));
    if (current) {
      const updated = {
        ...current,
        ...patch,
        id: current.id,
        updatedAt: patch.updatedAt ?? Date.now()
      };
      store.put(updated);
      if (updated.jobId) {
        const jobStore = tx.objectStore(JOBS_STORE);
        const job = await requestToPromise<JobRecord | undefined>(jobStore.get(updated.jobId));
        if (job) {
          jobStore.put({
            ...job,
            pipelineRun: updated,
            updatedAt: Date.now()
          });
        }
      }
    }
    await transactionDone(tx);
  }

  async getPipelineRun(id: string): Promise<PipelineRunRecord | undefined> {
    const db = await openCloneDb();
    return requestToPromise<PipelineRunRecord | undefined>(
      db.transaction(PIPELINE_RUNS_STORE, "readonly").objectStore(PIPELINE_RUNS_STORE).get(id)
    );
  }

  async getLatestPipelineRun(): Promise<PipelineRunRecord | undefined> {
    const db = await openCloneDb();
    return (await requestToPromise<PipelineRunRecord[]>(
      db.transaction(PIPELINE_RUNS_STORE, "readonly").objectStore(PIPELINE_RUNS_STORE).getAll()
    )).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async getPipelineRunByJob(jobId: string): Promise<PipelineRunRecord | undefined> {
    const db = await openCloneDb();
    const tx = db.transaction(PIPELINE_RUNS_STORE, "readonly");
    const records = await requestToPromise<PipelineRunRecord[]>(
      tx.objectStore(PIPELINE_RUNS_STORE).index(JOB_ID_INDEX).getAll(jobId)
    );
    return records.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }
}

export class BlobStore implements BlobStoreLike {
  async putBlob(params: {
    blob: Blob;
    sha256: string;
    contentType: string;
    originalUrl?: string;
    normalizedUrl?: string;
    derivedFromAssetId?: string;
    derivedKind?: BlobRecord["derivedKind"];
    filename?: string;
  }): Promise<BlobRecord> {
    const existing = await this.getBlobRecordByHash(params.sha256);
    if (existing) {
      return existing;
    }

    const db = await openCloneDb();
    const now = Date.now();
    const record: StoredBlobRecord = {
      blobId: `blob_${params.sha256}`,
      sha256: params.sha256,
      size: params.blob.size,
      contentType: params.contentType,
      originalUrl: params.originalUrl,
      normalizedUrl: params.normalizedUrl,
      derivedFromAssetId: params.derivedFromAssetId,
      derivedKind: params.derivedKind,
      filename: params.filename,
      createdAt: now,
      updatedAt: now,
      blob: params.blob
    };

    const tx = db.transaction(BLOBS_STORE, "readwrite");
    tx.objectStore(BLOBS_STORE).put(record);
    await transactionDone(tx);
    return stripBlob(record);
  }

  async getBlob(blobId: string): Promise<Blob | undefined> {
    const record = await this.getStoredBlobRecord(blobId);
    return record?.blob;
  }

  async getBlobRecord(blobId: string): Promise<BlobRecord | undefined> {
    const record = await this.getStoredBlobRecord(blobId);
    return record ? stripBlob(record) : undefined;
  }

  async getBlobRecordByHash(sha256: string): Promise<BlobRecord | undefined> {
    const db = await openCloneDb();
    const tx = db.transaction(BLOBS_STORE, "readonly");
    const index = tx.objectStore(BLOBS_STORE).index(SHA256_INDEX);
    const record = await requestToPromise<StoredBlobRecord | undefined>(index.get(sha256));
    return record ? stripBlob(record) : undefined;
  }

  async hasHash(sha256: string): Promise<boolean> {
    return Boolean(await this.getBlobRecordByHash(sha256));
  }

  async deleteBlob(blobId: string): Promise<void> {
    const db = await openCloneDb();
    const tx = db.transaction(BLOBS_STORE, "readwrite");
    tx.objectStore(BLOBS_STORE).delete(blobId);
    await transactionDone(tx);
  }

  private async getStoredBlobRecord(blobId: string): Promise<StoredBlobRecord | undefined> {
    const db = await openCloneDb();
    return requestToPromise<StoredBlobRecord | undefined>(
      db.transaction(BLOBS_STORE, "readonly").objectStore(BLOBS_STORE).get(blobId)
    );
  }
}

let dbPromise: Promise<IDBDatabase> | undefined;

export function createJobStore(): JobStore {
  if (typeof indexedDB === "undefined") {
    return new MemoryJobStore();
  }

  return new IndexedDbJobStore();
}

export function createBlobStore(): BlobStoreLike {
  if (typeof indexedDB === "undefined") {
    return new MemoryBlobStore();
  }

  return new BlobStore();
}

export function computeJobStats(assets: AssetRecord[]): JobStats {
  const stats: JobStats = {
    totalAssets: assets.length,
    queuedAssets: 0,
    downloadingAssets: 0,
    discoveredAssets: assets.length,
    downloadedAssets: 0,
    failedAssets: 0,
    skippedAssets: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    uploadedAssets: 0,
    totalUploadedBytes: 0
  };

  for (const asset of assets) {
    if (asset.status === "queued") {
      stats.queuedAssets += 1;
    }

    if (asset.status === "downloading") {
      stats.downloadingAssets += 1;
    }

    if (asset.status === "downloaded" || asset.status === "uploading" || asset.status === "uploaded" || asset.localBlobId) {
      stats.downloadedAssets += 1;
      stats.downloadedBytes += asset.size ?? 0;
    }

    if (asset.status === "failed") {
      stats.failedAssets += 1;
    }

    if (asset.status === "skipped") {
      stats.skippedAssets += 1;
    }

    if (asset.status === "uploaded") {
      stats.uploadedAssets += 1;
      stats.totalUploadedBytes += asset.size ?? 0;
    }

    stats.totalBytes += asset.size ?? 0;
  }

  return stats;
}

async function openCloneDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) {
        return;
      }

      let jobStore: IDBObjectStore;
      if (db.objectStoreNames.contains(JOBS_STORE)) {
        jobStore = tx.objectStore(JOBS_STORE);
      } else {
        jobStore = db.createObjectStore(JOBS_STORE, { keyPath: "id" });
      }

      void jobStore;

      let assetStore: IDBObjectStore;
      if (db.objectStoreNames.contains(ASSETS_STORE)) {
        assetStore = tx.objectStore(ASSETS_STORE);
      } else {
        assetStore = db.createObjectStore(ASSETS_STORE, { keyPath: "id" });
      }

      if (!assetStore.indexNames.contains(JOB_ID_INDEX)) {
        assetStore.createIndex(JOB_ID_INDEX, "jobId", { unique: false });
      }

      let blobStore: IDBObjectStore;
      if (db.objectStoreNames.contains(BLOBS_STORE)) {
        blobStore = tx.objectStore(BLOBS_STORE);
      } else {
        blobStore = db.createObjectStore(BLOBS_STORE, { keyPath: "blobId" });
      }

      if (!blobStore.indexNames.contains(SHA256_INDEX)) {
        blobStore.createIndex(SHA256_INDEX, "sha256", { unique: true });
      }

      if (!db.objectStoreNames.contains(HTML_SNAPSHOTS_STORE)) {
        db.createObjectStore(HTML_SNAPSHOTS_STORE, { keyPath: "jobId" });
      }

      let outputStore: IDBObjectStore;
      if (db.objectStoreNames.contains(OUTPUTS_STORE)) {
        outputStore = tx.objectStore(OUTPUTS_STORE);
      } else {
        outputStore = db.createObjectStore(OUTPUTS_STORE, { keyPath: "id" });
      }

      if (!outputStore.indexNames.contains(JOB_ID_INDEX)) {
        outputStore.createIndex(JOB_ID_INDEX, "jobId", { unique: false });
      }

      if (!db.objectStoreNames.contains(THREE_D_REPORTS_STORE)) {
        db.createObjectStore(THREE_D_REPORTS_STORE, { keyPath: "jobId" });
      }

      let apiSnapshotStore: IDBObjectStore;
      if (db.objectStoreNames.contains(API_SNAPSHOTS_STORE)) {
        apiSnapshotStore = tx.objectStore(API_SNAPSHOTS_STORE);
      } else {
        apiSnapshotStore = db.createObjectStore(API_SNAPSHOTS_STORE, { keyPath: "id" });
      }

      if (!apiSnapshotStore.indexNames.contains(JOB_ID_INDEX)) {
        apiSnapshotStore.createIndex(JOB_ID_INDEX, "jobId", { unique: false });
      }
      if (!apiSnapshotStore.indexNames.contains(NORMALIZED_URL_INDEX)) {
        apiSnapshotStore.createIndex(NORMALIZED_URL_INDEX, "normalizedUrl", { unique: false });
      }
      if (!apiSnapshotStore.indexNames.contains(METHOD_AND_URL_INDEX)) {
        apiSnapshotStore.createIndex(METHOD_AND_URL_INDEX, "methodAndUrl", { unique: false });
      }
      if (!apiSnapshotStore.indexNames.contains(REPLAYABLE_INDEX)) {
        apiSnapshotStore.createIndex(REPLAYABLE_INDEX, "replayable", { unique: false });
      }

      if (!db.objectStoreNames.contains(API_REPLAY_REPORTS_STORE)) {
        db.createObjectStore(API_REPLAY_REPORTS_STORE, { keyPath: "jobId" });
      }

      let pipelineStore: IDBObjectStore;
      if (db.objectStoreNames.contains(PIPELINE_RUNS_STORE)) {
        pipelineStore = tx.objectStore(PIPELINE_RUNS_STORE);
      } else {
        pipelineStore = db.createObjectStore(PIPELINE_RUNS_STORE, { keyPath: "id" });
      }

      if (!pipelineStore.indexNames.contains(JOB_ID_INDEX)) {
        pipelineStore.createIndex(JOB_ID_INDEX, "jobId", { unique: false });
      }
      if (!pipelineStore.indexNames.contains(STATUS_INDEX)) {
        pipelineStore.createIndex(STATUS_INDEX, "status", { unique: false });
      }
      if (!pipelineStore.indexNames.contains(UPDATED_AT_INDEX)) {
        pipelineStore.createIndex(UPDATED_AT_INDEX, "updatedAt", { unique: false });
      }
    };

    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function deleteAssetsForJob(store: IDBObjectStore, jobId: string): Promise<void> {
  await deleteRecordsForJob(store, jobId);
}

async function deleteRecordsForJob(store: IDBObjectStore, jobId: string): Promise<void> {
  const index = store.index(JOB_ID_INDEX);
  const keys = await requestToPromise<IDBValidKey[]>(index.getAllKeys(jobId));

  for (const key of keys) {
    store.delete(key);
  }
}

function cloneJob(job: JobRecord): JobRecord {
  return {
    ...job,
    frameIds: [...job.frameIds],
    stats: { ...job.stats },
    errors: job.errors.map((error) => ({ ...error })),
    output: job.output
      ? {
          ...job.output,
          rewriteReport: job.output.rewriteReport ? cloneRewriteReport(job.output.rewriteReport) : undefined,
          threeDPreparationReport: job.output.threeDPreparationReport
            ? cloneThreeDReport(job.output.threeDPreparationReport)
            : undefined,
          apiReplayReport: job.output.apiReplayReport ? cloneApiReplayReport(job.output.apiReplayReport) : undefined
        }
      : undefined,
    rewriteReport: job.rewriteReport ? cloneRewriteReport(job.rewriteReport) : undefined,
    threeDPreparationReport: job.threeDPreparationReport ? cloneThreeDReport(job.threeDPreparationReport) : undefined,
    apiReplayReport: job.apiReplayReport ? cloneApiReplayReport(job.apiReplayReport) : undefined,
    pipelineRun: job.pipelineRun ? clonePipelineRun(job.pipelineRun) : undefined,
    latestRewriteReport: job.latestRewriteReport ? cloneRewriteReport(job.latestRewriteReport) : undefined,
    latestThreeDPreparationReport: job.latestThreeDPreparationReport
      ? cloneThreeDReport(job.latestThreeDPreparationReport)
      : undefined
  };
}

function cloneAsset(asset: AssetRecord): AssetRecord {
  return {
    ...asset,
    source: [...asset.source],
    threeDPreparationWarnings: asset.threeDPreparationWarnings ? [...asset.threeDPreparationWarnings] : undefined
  };
}

function cloneHtmlSnapshot(snapshot: HtmlSnapshotRecord): HtmlSnapshotRecord {
  return { ...snapshot };
}

function cloneGeneratedOutput(output: GeneratedOutputRecord): GeneratedOutputRecord {
  return {
    ...output,
    rewriteReport: cloneRewriteReport(output.rewriteReport)
  };
}

function cloneRewriteReport<T extends { unresolvedUrls: string[]; warnings: string[] }>(report: T): T {
  return {
    ...report,
    unresolvedUrls: [...report.unresolvedUrls],
    warnings: [...report.warnings]
  };
}

function cloneThreeDReport(report: ThreeDPreparationReport): ThreeDPreparationReport {
  return {
    ...report,
    unresolvedGltfUris: [...report.unresolvedGltfUris],
    unresolvedDecoderUrls: [...report.unresolvedDecoderUrls],
    unresolvedWorkerUrls: [...report.unresolvedWorkerUrls],
    warnings: [...report.warnings],
    errors: [...report.errors]
  };
}

function cloneApiSnapshot(record: ApiSnapshotRecord): ApiSnapshotRecord {
  return { ...record };
}

function cloneApiReplayReport(report: ApiReplayReport): ApiReplayReport {
  return {
    ...report,
    warnings: [...report.warnings],
    errors: [...report.errors]
  };
}

function clonePipelineRun(record: PipelineRunRecord): PipelineRunRecord {
  return {
    ...record,
    errors: [...record.errors],
    warnings: [...record.warnings]
  };
}

function createEmptyApiReplayReport(jobId: string): ApiReplayReport {
  return {
    jobId,
    startedAt: Date.now(),
    capturedResponses: 0,
    storedResponses: 0,
    rewrittenResponses: 0,
    inlinedResponses: 0,
    skippedSensitive: 0,
    skippedTooLarge: 0,
    skippedUnsupportedContentType: 0,
    skippedUnsupportedMethod: 0,
    replayMapEntries: 0,
    warnings: [],
    errors: []
  };
}

function mergeApiReplayReport(current: ApiReplayReport, patch: Partial<ApiReplayReport>): ApiReplayReport {
  return cloneApiReplayReport({
    ...current,
    ...patch,
    jobId: current.jobId,
    warnings: patch.warnings ?? current.warnings,
    errors: patch.errors ?? current.errors
  });
}

function buildMethodAndUrl(method: string, normalizedUrl: string): string {
  return `${method.toUpperCase()} ${normalizedUrl}`;
}

function mergeThreeDReport(
  current: ThreeDPreparationReport,
  patch: Partial<Omit<ThreeDPreparationReport, "jobId">>
): ThreeDPreparationReport {
  return cloneThreeDReport({
    ...current,
    ...patch,
    jobId: current.jobId,
    unresolvedGltfUris: patch.unresolvedGltfUris ?? current.unresolvedGltfUris,
    unresolvedDecoderUrls: patch.unresolvedDecoderUrls ?? current.unresolvedDecoderUrls,
    unresolvedWorkerUrls: patch.unresolvedWorkerUrls ?? current.unresolvedWorkerUrls,
    warnings: patch.warnings ?? current.warnings,
    errors: patch.errors ?? current.errors
  });
}

function stripBlob(record: StoredBlobRecord): BlobRecord {
  const { blob: _blob, ...metadata } = record;
  return metadata;
}
