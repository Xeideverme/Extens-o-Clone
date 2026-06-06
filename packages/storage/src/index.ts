import type { AssetRecord, AssetStatus, BlobRecord, JobRecord, JobStats, JobStatus } from "@clone3d/shared";

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
}

export interface BlobStoreLike {
  putBlob(params: {
    blob: Blob;
    sha256: string;
    contentType: string;
    originalUrl?: string;
    normalizedUrl?: string;
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
const DB_VERSION = 2;
const JOBS_STORE = "jobs";
const ASSETS_STORE = "assets";
const BLOBS_STORE = "blobs";
const JOB_ID_INDEX = "jobId";
const SHA256_INDEX = "sha256";

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
    const tx = db.transaction([JOBS_STORE, ASSETS_STORE], "readwrite");
    tx.objectStore(JOBS_STORE).delete(jobId);
    await deleteAssetsForJob(tx.objectStore(ASSETS_STORE), jobId);
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
}

export class BlobStore implements BlobStoreLike {
  async putBlob(params: {
    blob: Blob;
    sha256: string;
    contentType: string;
    originalUrl?: string;
    normalizedUrl?: string;
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
    uploadedAssets: 0
  };

  for (const asset of assets) {
    if (asset.status === "queued") {
      stats.queuedAssets += 1;
    }

    if (asset.status === "downloading") {
      stats.downloadingAssets += 1;
    }

    if (asset.status === "downloaded") {
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
    output: job.output ? { ...job.output } : undefined
  };
}

function cloneAsset(asset: AssetRecord): AssetRecord {
  return {
    ...asset,
    source: [...asset.source]
  };
}

function stripBlob(record: StoredBlobRecord): BlobRecord {
  const { blob: _blob, ...metadata } = record;
  return metadata;
}
