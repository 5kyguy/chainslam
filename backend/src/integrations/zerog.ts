import { Batcher, Indexer, KvClient, getFlowContract } from "@0gfoundation/0g-ts-sdk";
import { Wallet, JsonRpcProvider } from "ethers";
import type { AppConfig } from "../config.js";

export interface ZerogKvPutResult {
  txHash: string;
  rootHash: string;
}

/**
 * Thin adapter around @0gfoundation/0g-ts-sdk KV writes + reads.
 * Writes require a funded wallet on the configured 0G Storage flow.
 */
export class ZeroGKvClient {
  private indexer: Indexer | undefined;
  private kvClient: KvClient | undefined;
  private signer: Wallet | undefined;

  constructor(private readonly cfg: AppConfig["zerog"]) {}

  private async withSuppressedSyncLogs<T>(fn: () => Promise<T>): Promise<T> {
    const suppressedPatterns = [
      "Waiting for storage node to sync",
      "storage node to sync",
    ];

    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    const shouldSuppress = (chunk: unknown): boolean => {
      const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
      if (!text) return false;
      return suppressedPatterns.some((p) => text.includes(p));
    };

    process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
      if (shouldSuppress(chunk)) {
        return true;
      }
      return (originalStdoutWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
      if (shouldSuppress(chunk)) {
        return true;
      }
      return (originalStderrWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stderr.write;

    try {
      return await fn();
    } finally {
      process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
      process.stderr.write = originalStderrWrite as typeof process.stderr.write;
    }
  }

  isConfigured(): boolean {
    return (
      this.cfg.enabled &&
      !!this.cfg.evmRpc &&
      !!this.cfg.indexerRpc &&
      !!this.cfg.kvRpc &&
      !!this.cfg.privateKey?.trim() &&
      !!this.cfg.streamId?.trim()
    );
  }

  private getSigner(): Wallet {
    if (!this.signer) {
      this.signer = new Wallet(this.cfg.privateKey, new JsonRpcProvider(this.cfg.evmRpc));
    }
    return this.signer;
  }

  /**
   * Overwrite a UTF-8 key with a UTF-8 value in the configured KV stream.
   */
  async putText(keyUtf8: string, valueUtf8: string): Promise<ZerogKvPutResult | null> {
    if (!this.isConfigured()) return null;

    let lastErr: Error | null = null;
    const max = Math.max(0, this.cfg.maxRetries);
    for (let attempt = 0; attempt <= max; attempt++) {
      try {
        const putRes = await this.withSuppressedSyncLogs(async () => {
          if (!this.indexer) this.indexer = new Indexer(this.cfg.indexerRpc);
          const [nodes, selErr] = await this.indexer.selectNodes(1);
          if (selErr || !nodes?.length) {
            throw selErr ?? new Error("0G indexer.selectNodes returned no nodes");
          }
          const status = await nodes[0].getStatus();
          if (status == null) {
            throw new Error("0G storage node status unavailable");
          }
          // 0g-ts-sdk expects ethers Signer from its bundled package; app uses ESM ethers — cast via unknown.
          const flow = getFlowContract(
            status.networkIdentity.flowAddress,
            this.getSigner() as unknown as Parameters<typeof getFlowContract>[1],
          );
          const batcher = new Batcher(1, nodes, flow, this.cfg.evmRpc);
          const keyBytes = Uint8Array.from(Buffer.from(keyUtf8, "utf8"));
          const valBytes = Uint8Array.from(Buffer.from(valueUtf8, "utf8"));
          batcher.streamDataBuilder.set(this.cfg.streamId, keyBytes, valBytes);
          const [res, batchErr] = await batcher.exec();
          if (batchErr) throw batchErr;
          return { txHash: res.txHash, rootHash: res.rootHash };
        });
        return putRes;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < max) {
          await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
          continue;
        }
      }
    }
    console.error("[ZeroGKvClient] putText failed after retries:", lastErr);
    return null;
  }

  /**
   * Read a UTF-8 value for a UTF-8 key (KV node RPC, not indexer).
   */
  async getText(keyUtf8: string): Promise<string | null> {
    if (!this.cfg.enabled || !this.cfg.kvRpc || !this.cfg.streamId) return null;
    if (!this.kvClient) this.kvClient = new KvClient(this.cfg.kvRpc);
    const keyBytes = Uint8Array.from(Buffer.from(keyUtf8, "utf8"));
    const streamId = this.cfg.streamId;
    let lastErr: Error | null = null;
    const max = Math.max(0, this.cfg.maxRetries);
    for (let attempt = 0; attempt <= max; attempt++) {
      try {
        const val = await this.kvClient.getValue(streamId, keyBytes);
        if (!val?.data) return null;
        return Buffer.from(val.data, "base64").toString("utf8");
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < max) {
          await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        }
      }
    }
    console.error("[ZeroGKvClient] getText failed after retries:", lastErr);
    return null;
  }
}
