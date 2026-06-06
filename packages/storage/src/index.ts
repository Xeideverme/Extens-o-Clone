import type { JobRecord } from "@clone3d/shared";

export interface JobStore {
  get(jobId: string): Promise<JobRecord | undefined>;
  put(job: JobRecord): Promise<void>;
  list(): Promise<JobRecord[]>;
  delete(jobId: string): Promise<void>;
}

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  async get(jobId: string): Promise<JobRecord | undefined> {
    return this.jobs.get(jobId);
  }

  async put(job: JobRecord): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  async list(): Promise<JobRecord[]> {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }

  async delete(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }
}

export function createJobStore(): JobStore {
  return new MemoryJobStore();
}
