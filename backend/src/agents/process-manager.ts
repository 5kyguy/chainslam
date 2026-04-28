import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { RemoteAgentConnection } from "./remote-agent.js";

export interface ManagedAgent {
  agentId: string;
  process: ChildProcess;
  connection: RemoteAgentConnection;
}

export class AgentProcessManager {
  private readonly agents = new Map<string, ManagedAgent>();

  constructor(
    private readonly config: AppConfig,
    private readonly wsBaseUrl: string,
  ) {}

  spawn(agentId: string, strategy: string): ManagedAgent {
    const connection = new RemoteAgentConnection();
    const wsUrl = `${this.wsBaseUrl}/ws/agent/${agentId}`;

    const pythonBin = this.config.agents.pythonPath;
    const agentsPkg = this.config.agents.packageDir;

    const pythonpath = agentsPkg
      ? [agentsPkg, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)
      : process.env.PYTHONPATH;

    const proc = spawn(pythonBin, ["-m", "chain_slam_agents", "--agent-id", agentId, "--strategy", strategy, "--ws-url", wsUrl], {
      cwd: agentsPkg || undefined,
      env: {
        ...process.env,
        ...(pythonpath !== undefined ? { PYTHONPATH: pythonpath } : {}),
        LLM_API_KEY: this.config.llm.apiKey,
        LLM_MODEL: this.config.llm.model,
        LLM_BASE_URL: this.config.llm.baseUrl,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        if (line.trim()) console.log(`[agent:${agentId}] ${line}`);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        if (line.trim()) console.error(`[agent:${agentId}] ${line}`);
      }
    });

    proc.on("exit", (code) => {
      console.log(`[agent:${agentId}] process exited with code ${code}`);
    });

    const managed: ManagedAgent = { agentId, process: proc, connection };
    this.agents.set(agentId, managed);
    return managed;
  }

  kill(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.connection.sendEnd("match_ended");
    managed.process.kill("SIGTERM");
    this.agents.delete(agentId);
  }

  get(agentId: string): ManagedAgent | undefined {
    return this.agents.get(agentId);
  }

  killAll(): void {
    for (const id of this.agents.keys()) {
      this.kill(id);
    }
  }
}
